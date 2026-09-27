import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountRecountPendingError, CountReconciliationStaleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventoryAdjustmentService } from '../warehouse-inventory/inventory-adjustment.service';
import { WarehouseTransferService } from '../warehouse-inventory/warehouse-transfer.service';
import { InventoryStatusTransferService } from '../warehouse-inventory/inventory-status-transfer.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';

const REASON_MAP: Record<string, string> = { damage: 'DAMAGE', expiry: 'EXPIRY', theft: 'THEFT' };
const EPSILON = new Decimal('0.000001');

export interface CreateAdjustmentTarget {
  varianceId: string;
  targetLocationId?: string;
  targetQualityStatus?: string;
}

/**
 * InventoryCountAdjustmentService (spec sections 50-57) — turns an
 * APPROVED `InventoryVarianceDecision` into the REAL correction document
 * (spec section 51: reuse Phase 10's existing InventoryAdjustment/
 * WarehouseTransfer/InventoryStatusTransfer document types — never a
 * fourth, duplicate posting mechanism), linked back to the session via
 * `InventoryCountAdjustmentLink` so `InventoryFreezeService` can recognize
 * the session's own correction as exempt from its own freeze.
 *
 * `LOCATION_TRANSFER`/`BATCH_CORRECTION`/`SERIAL_CORRECTION` are disclosed
 * simplifications (documented in docs/INVENTORY_COUNT.md): a batch or
 * serial correction posts as an ordinary WRITE_OFF/SURPLUS pair against
 * the InventoryAdjustment document (the batch/serial dimension is already
 * part of that document's own line), rather than a bespoke "re-batch"
 * document this codebase has no other use for. A location transfer is
 * auto-paired against the one other LOCATION_MISMATCH row for the same
 * product when exactly one candidate exists; otherwise the caller must
 * supply `targetLocationId` explicitly.
 */
@Injectable()
export class InventoryCountAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly adjustments: InventoryAdjustmentService,
    private readonly transfers: WarehouseTransferService,
    private readonly statusTransfers: InventoryStatusTransferService,
    private readonly documentPosting: DocumentPostingService,
  ) {}

  async createAdjustments(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, targets: CreateAdjustmentTarget[] = []) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const targetByVariance = new Map(targets.map((t) => [t.varianceId, t]));

    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);

    const variances = await this.prisma.inventoryVariance.findMany({
      where: { tenantId, sessionId, decision: { status: 'APPROVED' } },
      include: { decision: true },
    });

    const created: { varianceId: string; documentType: string; documentId: string }[] = [];
    const documentDate = new Date().toISOString().slice(0, 10);

    for (const variance of variances) {
      const existingLink = await this.prisma.inventoryCountAdjustmentLink.findFirst({ where: { tenantId, sessionId, varianceId: variance.id } });
      if (existingLink) continue;

      const decision = variance.decision!;
      const target = targetByVariance.get(variance.id);

      if (decision.resolutionType === 'NO_ADJUSTMENT' || decision.resolutionType === 'SOURCE_DOCUMENT_CORRECTION') {
        await this.prisma.inventoryVariance.update({ where: { id: variance.id }, data: { resolutionStatus: 'POSTED' } });
        await this.prisma.inventoryVarianceDecision.update({ where: { varianceId: variance.id }, data: { status: 'POSTED' } });
        continue;
      }

      if (decision.resolutionType === 'STATUS_TRANSFER') {
        if (!target?.targetQualityStatus) throw new ValidationAppError(`A target quality status is required to create a status-transfer adjustment for variance ${variance.id}`);
        const product = await this.prisma.product.findFirst({ where: { id: variance.productId, tenantId } });
        const doc = await this.statusTransfers.create(tenantId, membershipId, organizationId, userId, {
          warehouseId: variance.warehouseId,
          documentDate,
          lines: [{ productId: variance.productId, unitId: product!.baseUnitId, quantity: decision.finalPhysicalQuantity.abs().toNumber(), batchId: variance.batchId ?? undefined, fromStockStatus: variance.qualityStatus, toStockStatus: target.targetQualityStatus }],
        });
        await this.linkAndFlag(tenantId, sessionId, variance.id, 'INVENTORY_STATUS_TRANSFER', doc!.id, userId);
        created.push({ varianceId: variance.id, documentType: 'INVENTORY_STATUS_TRANSFER', documentId: doc!.id });
        continue;
      }

      if (decision.resolutionType === 'LOCATION_TRANSFER') {
        const destinationLocationId = target?.targetLocationId ?? (await this.autoPairLocation(tenantId, sessionId, variance));
        if (!destinationLocationId) throw new ValidationAppError(`A target location is required to create a location-transfer adjustment for variance ${variance.id}`);
        const product = await this.prisma.product.findFirst({ where: { id: variance.productId, tenantId } });
        const qty = new Decimal(decision.acceptedDifference.toString()).abs();
        const isSource = new Decimal(decision.acceptedDifference.toString()).lt(0);
        const doc = await this.transfers.create(tenantId, membershipId, organizationId, userId, {
          sourceWarehouseId: variance.warehouseId,
          destinationWarehouseId: variance.warehouseId,
          transferType: 'INTERNAL_LOCATION_TRANSFER',
          documentDate,
          lines: [{ productId: variance.productId, unitId: product!.baseUnitId, quantity: qty.toNumber(), batchId: variance.batchId ?? undefined, sourceLocationId: isSource ? (variance.locationId ?? undefined) : destinationLocationId, destinationLocationId: isSource ? destinationLocationId : (variance.locationId ?? undefined) }],
        });
        await this.linkAndFlag(tenantId, sessionId, variance.id, 'WAREHOUSE_TRANSFER', doc!.id, userId);
        created.push({ varianceId: variance.id, documentType: 'WAREHOUSE_TRANSFER', documentId: doc!.id });
        continue;
      }

      // ADJUST_STOCK | BATCH_CORRECTION | SERIAL_CORRECTION | WRITE_OFF | SURPLUS_RECOGNITION
      const acceptedDifference = new Decimal(decision.acceptedDifference.toString());
      if (acceptedDifference.abs().lte(EPSILON)) {
        await this.prisma.inventoryVariance.update({ where: { id: variance.id }, data: { resolutionStatus: 'POSTED' } });
        await this.prisma.inventoryVarianceDecision.update({ where: { varianceId: variance.id }, data: { status: 'POSTED' } });
        continue;
      }
      const isShortage = acceptedDifference.lt(0) || decision.resolutionType === 'WRITE_OFF';
      const product = await this.prisma.product.findFirst({ where: { id: variance.productId, tenantId } });
      const doc = await this.adjustments.create(tenantId, membershipId, organizationId, userId, {
        warehouseId: variance.warehouseId,
        adjustmentType: isShortage ? 'WRITE_OFF' : 'SURPLUS',
        reasonCode: (decision.reasonCode && REASON_MAP[decision.reasonCode]) ?? 'OTHER',
        documentDate,
        description: `Inventory count session ${session.sessionNumber ?? session.id} — variance ${variance.id}`,
        lines: [{ productId: variance.productId, unitId: product!.baseUnitId, quantity: acceptedDifference.abs().toNumber(), batchId: variance.batchId ?? undefined, stockStatus: variance.qualityStatus, costReference: decision.approvedCost ? decision.approvedCost.toNumber() : undefined }],
      });
      await this.linkAndFlag(tenantId, sessionId, variance.id, 'INVENTORY_ADJUSTMENT', doc!.id, userId);
      created.push({ varianceId: variance.id, documentType: 'INVENTORY_ADJUSTMENT', documentId: doc!.id });
    }

    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_ADJUSTMENTS_CREATED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'CREATE', userId, newValues: { count: created.length } });
    return created;
  }

  async postAdjustments(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);

    const pendingRecounts = await this.prisma.inventoryVariance.count({ where: { tenantId, sessionId, resolutionStatus: 'RECOUNT_REQUIRED' } });
    if (pendingRecounts > 0) throw new CountRecountPendingError(pendingRecounts);

    await this.assertNotStale(tenantId, organizationId, session);

    const links = await this.prisma.inventoryCountAdjustmentLink.findMany({ where: { tenantId, sessionId } });
    const posted: string[] = [];
    let anyStillUnposted = false;

    for (const link of links) {
      const doc = await this.findDocument(link.adjustmentDocumentType, link.adjustmentDocumentId, tenantId);
      if (!doc || doc.postingStatus === 'POSTED') continue;
      await this.documentPosting.post(tenantId, link.adjustmentDocumentType, link.adjustmentDocumentId, doc.version, userId);
      if (link.varianceId) {
        await this.prisma.inventoryVariance.update({ where: { id: link.varianceId }, data: { resolutionStatus: 'POSTED' } });
        await this.prisma.inventoryVarianceDecision.update({ where: { varianceId: link.varianceId }, data: { status: 'POSTED' } }).catch(() => undefined);
      }
      posted.push(link.adjustmentDocumentId);
    }

    for (const link of links) {
      const doc = await this.findDocument(link.adjustmentDocumentType, link.adjustmentDocumentId, tenantId);
      if (doc?.postingStatus !== 'POSTED') anyStillUnposted = true;
    }
    if (!anyStillUnposted) {
      await this.prisma.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'POSTED', version: { increment: 1 } } });
    }

    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_ADJUSTMENTS_POSTED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'POST', userId, newValues: { postedCount: posted.length } });
    return { postedDocumentIds: posted };
  }

  private async findDocument(documentType: string, documentId: string, tenantId: string): Promise<{ version: number; postingStatus: string } | null> {
    switch (documentType) {
      case 'INVENTORY_ADJUSTMENT':
        return this.prisma.inventoryAdjustment.findFirst({ where: { id: documentId, tenantId } });
      case 'WAREHOUSE_TRANSFER':
        return this.prisma.warehouseTransfer.findFirst({ where: { id: documentId, tenantId } });
      case 'INVENTORY_STATUS_TRANSFER':
        return this.prisma.inventoryStatusTransfer.findFirst({ where: { id: documentId, tenantId } });
      default:
        return null;
    }
  }

  private async linkAndFlag(tenantId: string, sessionId: string, varianceId: string, documentType: string, documentId: string, userId: string) {
    await this.prisma.inventoryCountAdjustmentLink.create({ data: { tenantId, sessionId, varianceId, adjustmentDocumentType: documentType, adjustmentDocumentId: documentId } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_ADJUSTMENT_CREATED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'CREATE', userId, newValues: { documentType, documentId } });
  }

  private async autoPairLocation(tenantId: string, sessionId: string, variance: { id: string; productId: string; warehouseId: string; batchId: string | null; quantityDifference: Decimal }): Promise<string | undefined> {
    const candidates = await this.prisma.inventoryVariance.findMany({
      where: { tenantId, sessionId, productId: variance.productId, warehouseId: variance.warehouseId, varianceType: 'LOCATION_MISMATCH', id: { not: variance.id } },
    });
    const opposite = candidates.filter((c) => new Decimal(c.quantityDifference.toString()).isNegative() !== new Decimal(variance.quantityDifference.toString()).isNegative());
    if (opposite.length !== 1) return undefined;
    return opposite[0].locationId ?? undefined;
  }

  /**
   * Pre-post refresh (spec section 60, test 130): under NO_FREEZE, new
   * movements can land in the count's own scope right up until the
   * moment of posting. Recomputes each APPROVED variance's
   * adjusted-accounting-quantity fresh and compares it against the value
   * the decision was approved against — a drift beyond the plan's own
   * tolerance means the approval was granted against a now-stale picture.
   */
  private async assertNotStale(tenantId: string, organizationId: string, session: { id: string; snapshotAt: Date | null; freezePolicy: string }): Promise<void> {
    if (session.freezePolicy === 'HARD_FREEZE') return; // movements were physically blocked — cannot have drifted
    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: session.id, resolutionStatus: 'APPROVED' } });
    for (const variance of variances) {
      const movements = await this.prisma.inventoryMovement.groupBy({
        by: ['productId'],
        where: { tenantId, organizationId, warehouseId: variance.warehouseId, locationId: variance.locationId, productId: variance.productId, batchId: variance.batchId, stockStatus: { in: PHYSICAL_STOCK_STATUSES }, effectiveDate: { gt: session.snapshotAt ?? new Date(0) } },
        _sum: { baseQuantity: true },
      });
      const currentAdjusted = new Decimal((variance.accountingQuantity ?? 0).toString()).plus((movements[0]?._sum.baseQuantity ?? 0).toString());
      const approvedAdjusted = new Decimal(variance.adjustedAccountingQuantity.toString());
      if (currentAdjusted.minus(approvedAdjusted).abs().gt(EPSILON)) {
        throw new CountReconciliationStaleError();
      }
    }
  }
}
