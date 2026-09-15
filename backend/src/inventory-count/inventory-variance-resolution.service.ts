import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventoryCountAdjustmentService } from './inventory-count-adjustment.service';
import { VarianceDecisionDto } from './dto/inventory-count.dto';

/**
 * InventoryVarianceResolutionService (spec sections 48-56). Records an
 * `InventoryVarianceDecision` (the approval act itself —
 * `InventoryCountApprovalService` decides WHO may call this for a given
 * value/severity) and, unless the resolution type is a pure
 * investigation-only outcome, posts the resulting stock/accounting
 * consequence via `InventoryCountAdjustmentService`.
 */
@Injectable()
export class InventoryVarianceResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly adjustments: InventoryCountAdjustmentService,
  ) {}

  async decide(tenantId: string, membershipId: string, organizationId: string, varianceId: string, userId: string, dto: VarianceDecisionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const variance = await this.prisma.inventoryVariance.findFirst({ where: { id: varianceId, tenantId }, include: { decision: true } });
    if (!variance) throw new NotFoundAppError('InventoryVariance', varianceId);
    if (variance.decision) throw new ValidationAppError('This variance already has a decision recorded');
    if (variance.resolutionStatus === 'RECOUNT_REQUIRED') {
      const pendingRecount = await this.prisma.inventoryRecount.findFirst({ where: { tenantId, varianceId, resultStatus: 'PENDING' } });
      if (pendingRecount) throw new ValidationAppError('Inventory adjustment cannot be posted because recount is still pending for this variance line.');
    }

    const session = await this.prisma.inventoryCountSession.findFirstOrThrow({ where: { id: variance.sessionId, tenantId } });
    const acceptedDifference = new Decimal(dto.finalPhysicalQty).minus(variance.adjustedAccountingQuantity.toString());

    // Need a product's base unit to post the resulting InventoryAdjustment.
    const product = await this.prisma.product.findFirst({ where: { id: variance.productId, tenantId } });
    if (!product) throw new ValidationAppError('Variance references an unknown product');

    return this.prisma.runInTransaction(async (tx) => {
      const decision = await tx.inventoryVarianceDecision.create({
        data: {
          tenantId,
          varianceId,
          finalPhysicalQty: dto.finalPhysicalQty.toString(),
          acceptedDifference: acceptedDifference.toString(),
          resolutionType: dto.resolutionType,
          reasonCode: dto.reasonCode,
          approvedCost: dto.approvedCost?.toString(),
          responsibleEmployeeId: dto.responsibleEmployeeId,
          recoverableAmount: dto.recoverableAmount?.toString(),
          approver: userId,
          approvedAt: new Date(),
          comment: dto.comment,
        },
      });
      await tx.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'APPROVED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_APPROVED', entityType: 'INVENTORY_VARIANCE', entityId: varianceId, action: 'UPDATE', userId, newValues: { resolutionType: dto.resolutionType, finalPhysicalQty: dto.finalPhysicalQty } }, tx);
      return decision;
    }).then(async (decision) => {
      const adjustment = await this.adjustments.postFromDecision(tenantId, userId, {
        organizationId,
        sessionId: variance.sessionId,
        warehouseId: variance.warehouseId,
        productId: variance.productId,
        unitId: product.baseUnitId,
        batchId: variance.batchId,
        acceptedDifference,
        resolutionType: dto.resolutionType,
        reasonCode: dto.reasonCode ?? variance.varianceType,
        approvedCost: dto.approvedCost != null ? new Decimal(dto.approvedCost) : null,
      });
      if (adjustment) {
        await this.prisma.inventoryVarianceDecision.update({ where: { id: decision.id }, data: { adjustmentDocumentId: adjustment.id } });
        await this.prisma.inventoryVariance.update({ where: { id: varianceId }, data: { resolutionStatus: 'POSTED' } });
      }
      return { decision, adjustment };
    });
  }

  /** Auto-accept small variances within tolerance (spec section 43) — a
   * system-initiated action (no membership/permission check, unlike
   * `decide`, since nothing here is a human approval) that still records
   * a real `InventoryVarianceDecision` + audit trail, never a silent
   * write. Only NORMAL-severity variances qualify; no `InventoryAdjustment`
   * is posted (`NO_ADJUSTMENT` — the count simply confirms the accounting
   * quantity was correct within tolerance). */
  async autoAcceptWithinTolerance(tenantId: string, sessionId: string, userId: string) {
    const openVariances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId, resolutionStatus: 'OPEN', severity: 'NORMAL', decision: null } });
    const accepted: string[] = [];
    for (const v of openVariances) {
      const finalQty = v.physicalQuantity ?? v.adjustedAccountingQuantity;
      await this.prisma.runInTransaction(async (tx) => {
        await tx.inventoryVarianceDecision.create({
          data: { tenantId, varianceId: v.id, finalPhysicalQty: finalQty.toString(), acceptedDifference: '0', resolutionType: 'NO_ADJUSTMENT', reasonCode: 'AUTO_ACCEPTED_WITHIN_TOLERANCE', approver: userId, approvedAt: new Date() },
        });
        await tx.inventoryVariance.update({ where: { id: v.id }, data: { resolutionStatus: 'APPROVED' } });
        await this.audit.record({ tenantId, eventType: 'INVENTORY_VARIANCE_APPROVED', entityType: 'INVENTORY_VARIANCE', entityId: v.id, action: 'UPDATE', userId, newValues: { resolutionType: 'NO_ADJUSTMENT', autoAccepted: true } }, tx);
      });
      accepted.push(v.id);
    }
    return accepted;
  }
}
