import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, RequirementAllocationExceedsRemainingError, ValidationAppError } from '../common/errors/app-error';
import { PurchaseRequirementService, PURCHASE_REQUIREMENT_TYPE } from './purchase-requirement.service';
import { PurchaseOrderService } from './purchase-order.service';
import { PURCHASE_ORDER_TYPE } from './purchase-order.repository';
import { CreatePurchaseOrderFromRequirementDto } from './dto/procurement.dto';
import { PurchaseLineItemDto } from './dto/procurement.dto';

const REQUIREMENT_TO_PO = 'REQUIREMENT_TO_PURCHASE_ORDER';

export interface RequirementLineCoverage {
  lineId: string;
  productId: string;
  required: Decimal;
  cancelled: Decimal;
  ordered: Decimal;
  remaining: Decimal;
}

/**
 * ProcurementPlanningService (spec sections 12-19, 71-76, 87-90, 106,
 * 114). Owns three related capabilities that sit on top of
 * PurchaseRequirement + DocumentLineLink:
 *
 *  1. Requirement -> PurchaseOrder allocation ("create-order", spec
 *     section 98). This is deliberately a BESPOKE command, not the
 *     generic CreateBasedOnMapper (Phase 0, section 27) every other
 *     document-to-document conversion in this codebase uses: creating a
 *     PurchaseOrder from a requirement needs an explicit supplier and
 *     explicit per-line quantities (multi-supplier partial ordering,
 *     spec sections 53, 122) — inputs the mapper's `mapHeader(source,
 *     tx)` signature has no room to accept. The allocation is still
 *     recorded through the same generic `DocumentLineLink` table (spec
 *     section 71) every other execution link in this codebase uses
 *     (ORDER_TO_SHIPMENT, SHIPMENT_TO_INVOICE, ...): `REQUIREMENT_TO_
 *     PURCHASE_ORDER`.
 *  2. Requirement status recomputation (mirrors
 *     OrderFulfillmentService.recomputeOrderStatuses) — OPEN /
 *     PARTIALLY_ORDERED / FULLY_ORDERED are always derived live from
 *     `DocumentLineLink`, never a manually-editable field.
 *  3. Read-only demand aggregation / coverage queries (spec sections 87,
 *     90, 106) — a query capability, not an auto-merge of requirement
 *     rows: "30 + 50 + 20 -> aggregate 100" means the query sums
 *     compatible open lines, it never rewrites them into one row.
 */
@Injectable()
export class ProcurementPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly requirements: PurchaseRequirementService,
    private readonly purchaseOrders: PurchaseOrderService,
  ) {}

  async remainingForRequirementLine(tenantId: string, requirementLineId: string): Promise<Decimal> {
    const line = await this.prisma.purchaseRequirementLine.findFirst({ where: { id: requirementLineId, tenantId } });
    if (!line) throw new NotFoundAppError('PurchaseRequirementLine', requirementLineId);
    const ordered = await this.prisma.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType: PURCHASE_REQUIREMENT_TYPE, sourceLineId: line.id, relationType: REQUIREMENT_TO_PO },
      _sum: { quantity: true },
    });
    const required = new Decimal(line.quantity.toString());
    const cancelled = new Decimal(line.cancelledQuantity.toString());
    const orderedQty = new Decimal((ordered._sum.quantity ?? 0).toString());
    return required.minus(cancelled).minus(orderedQty);
  }

  async coverageForRequirement(tenantId: string, requirementId: string): Promise<RequirementLineCoverage[]> {
    const requirement = await this.prisma.purchaseRequirement.findFirst({ where: { id: requirementId, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!requirement) throw new NotFoundAppError('PurchaseRequirement', requirementId);

    const results: RequirementLineCoverage[] = [];
    for (const line of requirement.lines) {
      const ordered = await this.prisma.documentLineLink.aggregate({
        where: { tenantId, sourceDocumentType: PURCHASE_REQUIREMENT_TYPE, sourceLineId: line.id, relationType: REQUIREMENT_TO_PO },
        _sum: { quantity: true },
      });
      const required = new Decimal(line.quantity.toString());
      const cancelled = new Decimal(line.cancelledQuantity.toString());
      const orderedQty = new Decimal((ordered._sum.quantity ?? 0).toString());
      results.push({ lineId: line.id, productId: line.productId, required, cancelled, ordered: orderedQty, remaining: required.minus(cancelled).minus(orderedQty) });
    }
    return results;
  }

  /** Recomputes OPEN/PARTIALLY_ORDERED/FULLY_ORDERED live from
   * DocumentLineLink (spec section 12) — never touches CANCELLED/CLOSED. */
  async recomputeRequirementStatus(tenantId: string, requirementId: string): Promise<void> {
    const requirement = await this.prisma.purchaseRequirement.findFirst({ where: { id: requirementId, tenantId } });
    if (!requirement || requirement.status === 'CANCELLED' || requirement.status === 'CLOSED') return;

    const coverage = await this.coverageForRequirement(tenantId, requirementId);
    const activeLines = coverage.filter((l) => l.required.minus(l.cancelled).gt(0));
    let status: string;
    if (activeLines.length === 0) {
      status = 'FULLY_ORDERED'; // every line fully cancelled counts as no longer open
    } else if (activeLines.every((l) => l.remaining.lte(0))) {
      status = 'FULLY_ORDERED';
    } else if (activeLines.some((l) => l.ordered.gt(0))) {
      status = 'PARTIALLY_ORDERED';
    } else {
      status = 'OPEN';
    }

    await this.prisma.purchaseRequirement.update({ where: { id: requirementId }, data: { status } });
  }

  /**
   * Allocates one or more requirement lines to a new PurchaseOrder for one
   * supplier (spec sections 20, 53, 122 — multi-supplier sourcing is
   * simply calling this again with a different supplier and the remaining
   * quantity). Delegates line resolution/price/tax to PurchaseOrderService
   * so a requirement-based PO gets exactly the same price/tax preview
   * snapshot behavior as a manually-created one.
   */
  async createPurchaseOrderFromRequirement(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    requirementId: string,
    userId: string,
    dto: CreatePurchaseOrderFromRequirementDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const requirement = await this.requirements.get(tenantId, membershipId, organizationId, requirementId);
    if (requirement.status === 'CANCELLED' || requirement.status === 'CLOSED') {
      throw new ValidationAppError(`Requirement is ${requirement.status} and cannot be allocated`);
    }

    const poLines: PurchaseLineItemDto[] = [];
    for (const alloc of dto.lines) {
      const reqLine = requirement.lines.find((l: any) => l.id === alloc.requirementLineId);
      if (!reqLine) throw new NotFoundAppError('PurchaseRequirementLine', alloc.requirementLineId);

      const remaining = await this.remainingForRequirementLine(tenantId, reqLine.id);
      const qty = new Decimal(alloc.quantity.toString());
      if (!qty.isFinite() || qty.lte(0)) throw new ValidationAppError('Allocation quantity must be positive');
      if (qty.gt(remaining)) throw new RequirementAllocationExceedsRemainingError(remaining.toString(), qty.toString());

      poLines.push({
        productId: reqLine.productId,
        unitId: reqLine.unitId,
        quantity: alloc.quantity,
        price: alloc.price,
        warehouseId: reqLine.warehouseId ?? requirement.warehouseId ?? undefined,
        expectedDeliveryDate: reqLine.requiredByDate ? new Date(reqLine.requiredByDate).toISOString().slice(0, 10) : undefined,
        requirementLineId: reqLine.id,
      });
    }

    const order = await this.purchaseOrders.create(tenantId, membershipId, organizationId, userId, {
      counterpartyId: dto.counterpartyId,
      documentDate: dto.documentDate ?? new Date().toISOString().slice(0, 10),
      currencyId: dto.currencyId,
      priceIncludesTax: dto.priceIncludesTax,
      warehouseId: requirement.warehouseId ?? undefined,
      description: `Based on requirement ${requirement.number ?? requirement.id}`,
      lines: poLines,
    });

    await this.prisma.runInTransaction(async (tx) => {
      for (const line of (order as any).lines) {
        if (!line.requirementLineId) continue;
        await tx.documentLineLink.create({
          data: {
            tenantId,
            sourceDocumentType: PURCHASE_REQUIREMENT_TYPE,
            sourceDocumentId: requirementId,
            sourceLineId: line.requirementLineId,
            targetDocumentType: PURCHASE_ORDER_TYPE,
            targetDocumentId: (order as any).id,
            targetLineId: line.id,
            quantity: line.quantity,
            relationType: REQUIREMENT_TO_PO,
            createdBy: userId,
          },
        });
      }
    });

    await this.recomputeRequirementStatus(tenantId, requirementId);
    await this.audit.record({
      tenantId,
      eventType: 'PURCHASE_REQUIREMENT_ALLOCATED',
      entityType: PURCHASE_REQUIREMENT_TYPE,
      entityId: requirementId,
      action: 'UPDATE',
      userId,
      newValues: { purchaseOrderId: (order as any).id, lineCount: poLines.length },
    });

    return order;
  }

  // -- read-only planning queries ---------------------------------------------

  /** Open Purchase Requirements (spec section 87): OPEN or
   * PARTIALLY_ORDERED, optionally filtered by product/warehouse. */
  async openRequirements(tenantId: string, membershipId: string, organizationId: string, productId?: string, warehouseId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.purchaseRequirement.findMany({
      where: {
        organizationId,
        status: { in: ['OPEN', 'PARTIALLY_ORDERED'] },
        ...(warehouseId ? { warehouseId } : {}),
        ...(productId ? { lines: { some: { productId } } } : {}),
      },
      include: { lines: productId ? { where: { productId } } : true },
      orderBy: { requiredByDate: 'asc' },
    });
  }

  /** Demand aggregation (spec section 106): sums remaining quantity across
   * every OPEN/PARTIALLY_ORDERED line for one product — optionally scoped
   * to one warehouse, since lines at different warehouses/required-dates
   * should not silently aggregate when the caller cares about that split. */
  async aggregateDemand(tenantId: string, membershipId: string, organizationId: string, productId: string, warehouseId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const lines = await this.prisma.purchaseRequirementLine.findMany({
      where: {
        tenantId,
        productId,
        purchaseRequirement: { organizationId, status: { in: ['OPEN', 'PARTIALLY_ORDERED'] } },
      },
      include: { purchaseRequirement: true },
    });

    let total = new Decimal(0);
    const detail: { lineId: string; requirementId: string; remaining: string }[] = [];
    for (const line of lines) {
      // Effective warehouse: line-level override, else the requirement
      // header's warehouse — a line rarely sets its own when the whole
      // requirement already targets one warehouse.
      const effectiveWarehouseId = line.warehouseId ?? line.purchaseRequirement.warehouseId;
      if (warehouseId && effectiveWarehouseId !== warehouseId) continue;

      const remaining = await this.remainingForRequirementLine(tenantId, line.id);
      if (remaining.gt(0)) {
        total = total.plus(remaining);
        detail.push({ lineId: line.id, requirementId: line.purchaseRequirementId, remaining: remaining.toString() });
      }
    }
    return { productId, warehouseId: warehouseId ?? null, totalRemaining: total.toString(), lines: detail };
  }
}
