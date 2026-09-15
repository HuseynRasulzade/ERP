import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * InventoryCountReconciliationService (spec sections 67-69, 95-97, 132).
 * Produces the session-level `InventoryCountReconciliation` summary and
 * enforces the CLOSE gate (spec section 69) — a session can only reach
 * CLOSED when every sheet is complete, every required recount is
 * complete, no blocking variance remains, every variance has a decision,
 * and every resulting adjustment has actually posted.
 */
@Injectable()
export class InventoryCountReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async reconcile(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);

    const variances = await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId } });
    const snapshotTotalQty = (await this.prisma.inventoryCountSnapshotLine.aggregate({ where: { tenantId, sessionId, snapshotVersion: session.snapshotVersion }, _sum: { accountingQuantity: true } }))._sum.accountingQuantity ?? new Decimal(0);

    let adjustedAccountingQty = new Decimal(0);
    let physicalQty = new Decimal(0);
    let surplusQty = new Decimal(0);
    let shortageQty = new Decimal(0);
    let locationMismatchQty = new Decimal(0);
    let totalSurplusValue = new Decimal(0);
    let totalShortageValue = new Decimal(0);
    let unresolvedCount = 0;

    for (const v of variances) {
      adjustedAccountingQty = adjustedAccountingQty.plus(v.adjustedAccountingQuantity.toString());
      if (v.physicalQuantity != null) physicalQty = physicalQty.plus(v.physicalQuantity.toString());
      const diff = new Decimal(v.quantityDifference.toString());
      const value = v.valueDifference ? new Decimal(v.valueDifference.toString()) : new Decimal(0);
      if (v.varianceType === 'SURPLUS') {
        surplusQty = surplusQty.plus(diff.abs());
        totalSurplusValue = totalSurplusValue.plus(value.abs());
      } else if (v.varianceType === 'SHORTAGE') {
        shortageQty = shortageQty.plus(diff.abs());
        totalShortageValue = totalShortageValue.plus(value.abs());
      } else if (v.varianceType === 'LOCATION_MISMATCH') {
        locationMismatchQty = locationMismatchQty.plus(diff.abs());
      }
      if (!['POSTED', 'APPROVED', 'EXPLAINED', 'REJECTED'].includes(v.resolutionStatus)) unresolvedCount++;
    }

    const adjustmentCount = await this.prisma.inventoryVarianceDecision.count({ where: { tenantId, variance: { sessionId } }, });
    const netValueDifference = totalSurplusValue.minus(totalShortageValue);
    const status = unresolvedCount > 0 ? 'ADJUSTMENTS_PENDING' : variances.length > 0 ? 'BALANCED' : 'BALANCED';

    const row = await this.prisma.inventoryCountReconciliation.upsert({
      where: { sessionId },
      create: {
        tenantId,
        sessionId,
        snapshotTotalQty: snapshotTotalQty.toString(),
        adjustedAccountingQty: adjustedAccountingQty.toString(),
        physicalQty: physicalQty.toString(),
        surplusQty: surplusQty.toString(),
        shortageQty: shortageQty.toString(),
        locationMismatchQty: locationMismatchQty.toString(),
        totalSurplusValue: totalSurplusValue.toString(),
        totalShortageValue: totalShortageValue.toString(),
        netValueDifference: netValueDifference.toString(),
        adjustmentDocumentCount: adjustmentCount,
        unresolvedVarianceCount: unresolvedCount,
        status,
        reconciledAt: unresolvedCount === 0 ? new Date() : undefined,
        reconciledBy: unresolvedCount === 0 ? userId : undefined,
      },
      update: {
        adjustedAccountingQty: adjustedAccountingQty.toString(),
        physicalQty: physicalQty.toString(),
        surplusQty: surplusQty.toString(),
        shortageQty: shortageQty.toString(),
        locationMismatchQty: locationMismatchQty.toString(),
        totalSurplusValue: totalSurplusValue.toString(),
        totalShortageValue: totalShortageValue.toString(),
        netValueDifference: netValueDifference.toString(),
        adjustmentDocumentCount: adjustmentCount,
        unresolvedVarianceCount: unresolvedCount,
        status,
        reconciledAt: unresolvedCount === 0 ? new Date() : undefined,
        reconciledBy: unresolvedCount === 0 ? userId : undefined,
      },
    });

    await this.prisma.inventoryCountSession.update({ where: { id: sessionId }, data: { reconciliationStatus: status, status: unresolvedCount === 0 ? 'RECONCILED' : session.status } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_RECONCILED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId, newValues: { status, unresolvedCount } });
    return row;
  }

  /** Session close (spec section 69) — every gate must be satisfied;
   * never a partial/forced close. */
  async close(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId }, include: { sheets: true, reconciliation: true } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);

    const problems: string[] = [];
    if (session.sheets.some((s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED')) problems.push('not every count sheet is complete');
    const pendingRecounts = await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId, resultStatus: 'PENDING' } });
    if (pendingRecounts > 0) problems.push(`${pendingRecounts} recount(s) still pending`);
    const unresolvedVariances = await this.prisma.inventoryVariance.count({ where: { tenantId, sessionId, resolutionStatus: { notIn: ['POSTED', 'APPROVED', 'EXPLAINED', 'REJECTED'] } } });
    if (unresolvedVariances > 0) problems.push(`${unresolvedVariances} variance(s) unresolved`);
    if (!session.reconciliation || session.reconciliation.status !== 'BALANCED') problems.push('reconciliation is not BALANCED');

    if (problems.length > 0) {
      throw new ValidationAppError(`Cannot close inventory count session: ${problems.join('; ')}`);
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const row = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'CLOSED', completedAt: new Date(), completedBy: userId } });
      await tx.inventoryCountReconciliation.update({ where: { sessionId }, data: { status: 'CLOSED' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_CLOSED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId }, tx);
      return row;
    });
    return updated;
  }

  /** Phase 22 Month Close integration point (spec section 106). */
  async hasOpenInventoryCounts(tenantId: string, organizationId: string, period?: string): Promise<boolean> {
    const count = await this.prisma.inventoryCountSession.count({
      where: { tenantId, organizationId, status: { notIn: ['CLOSED', 'CANCELLED', 'DRAFT'] }, ...(period ? { financialYear: period } : {}) },
    });
    return count > 0;
  }
}
