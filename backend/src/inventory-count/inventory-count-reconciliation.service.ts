import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountSessionInvalidStateError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const MISMATCH_TYPES = ['LOCATION_MISMATCH', 'BATCH_MISMATCH'];

/**
 * InventoryCountReconciliationService (spec sections 67-70, 95-97) —
 * aggregates the session's own variance rows and adjustment links into
 * one `InventoryCountReconciliation` row, then gates `close` behind it
 * (spec section 69: a session is only CLOSED once every blocking
 * condition is actually clear — never just "the user clicked close").
 */
@Injectable()
export class InventoryCountReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async get(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCountReconciliation.findFirst({ where: { tenantId, sessionId } });
  }

  async reconcile(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (!['APPROVED', 'POSTED', 'RECONCILED'].includes(session.status)) {
        throw new CountSessionInvalidStateError('Reconciliation can only run once variances have been approved (and, where applicable, posted)');
      }

      const [snapshotLines, variances, links] = await Promise.all([
        tx.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId } }),
        tx.inventoryVariance.findMany({ where: { tenantId, sessionId } }),
        tx.inventoryCountAdjustmentLink.findMany({ where: { tenantId, sessionId } }),
      ]);

      const snapshotTotalQuantity = snapshotLines.reduce((s, l) => s.plus(l.accountingQuantity.toString()), new Decimal(0));
      let adjustedAccountingQuantity = new Decimal(0);
      let physicalQuantity = new Decimal(0);
      let surplusQuantity = new Decimal(0);
      let shortageQuantity = new Decimal(0);
      let locationMismatchQuantity = new Decimal(0);
      let totalSurplusValue = new Decimal(0);
      let totalShortageValue = new Decimal(0);
      let unresolvedVarianceCount = 0;

      for (const v of variances) {
        adjustedAccountingQuantity = adjustedAccountingQuantity.plus(v.adjustedAccountingQuantity.toString());
        if (v.physicalQuantity) physicalQuantity = physicalQuantity.plus(v.physicalQuantity.toString());
        const diff = new Decimal(v.quantityDifference.toString());
        const value = v.valueDifference ? new Decimal(v.valueDifference.toString()) : null;

        if (v.varianceType === 'SURPLUS') {
          surplusQuantity = surplusQuantity.plus(diff.abs());
          if (value) totalSurplusValue = totalSurplusValue.plus(value.abs());
        } else if (v.varianceType === 'SHORTAGE') {
          shortageQuantity = shortageQuantity.plus(diff.abs());
          if (value) totalShortageValue = totalShortageValue.plus(value.abs());
        } else if (MISMATCH_TYPES.includes(v.varianceType)) {
          locationMismatchQuantity = locationMismatchQuantity.plus(diff.abs());
        }

        if (v.varianceType !== 'MATCH' && ['OPEN', 'RECOUNT_REQUIRED', 'UNDER_INVESTIGATION'].includes(v.resolutionStatus)) {
          unresolvedVarianceCount += 1;
        }
      }

      let postedLinks = 0;
      for (const link of links) {
        const doc = await this.findDocument(tx, link.adjustmentDocumentType, link.adjustmentDocumentId, tenantId);
        if (doc?.postingStatus === 'POSTED') postedLinks += 1;
      }

      const status = unresolvedVarianceCount > 0 ? 'DIFFERENCES_FOUND' : links.length > postedLinks ? 'ADJUSTMENTS_PENDING' : 'BALANCED';

      const reconciliation = await tx.inventoryCountReconciliation.upsert({
        where: { sessionId },
        create: {
          tenantId,
          sessionId,
          snapshotTotalQuantity: snapshotTotalQuantity.toString(),
          adjustedAccountingQuantity: adjustedAccountingQuantity.toString(),
          physicalQuantity: physicalQuantity.toString(),
          surplusQuantity: surplusQuantity.toString(),
          shortageQuantity: shortageQuantity.toString(),
          locationMismatchQuantity: locationMismatchQuantity.toString(),
          totalSurplusValue: totalSurplusValue.toString(),
          totalShortageValue: totalShortageValue.toString(),
          netValueDifference: totalSurplusValue.minus(totalShortageValue).toString(),
          adjustmentDocumentCount: links.length,
          unresolvedVarianceCount,
          status,
          reconciledAt: status === 'BALANCED' ? new Date() : undefined,
          reconciledBy: status === 'BALANCED' ? userId : undefined,
        },
        update: {
          snapshotTotalQuantity: snapshotTotalQuantity.toString(),
          adjustedAccountingQuantity: adjustedAccountingQuantity.toString(),
          physicalQuantity: physicalQuantity.toString(),
          surplusQuantity: surplusQuantity.toString(),
          shortageQuantity: shortageQuantity.toString(),
          locationMismatchQuantity: locationMismatchQuantity.toString(),
          totalSurplusValue: totalSurplusValue.toString(),
          totalShortageValue: totalShortageValue.toString(),
          netValueDifference: totalSurplusValue.minus(totalShortageValue).toString(),
          adjustmentDocumentCount: links.length,
          unresolvedVarianceCount,
          status,
          reconciledAt: status === 'BALANCED' ? new Date() : undefined,
          reconciledBy: status === 'BALANCED' ? userId : undefined,
        },
      });

      await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { reconciliationStatus: status, status: status === 'BALANCED' ? 'RECONCILED' : session.status, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_RECONCILED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId, newValues: { status } }, tx);
      return reconciliation;
    });
  }

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId }, include: { reconciliation: true, sheets: true } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (session.status === 'CLOSED') return session;
      if (session.status !== 'RECONCILED') throw new CountSessionInvalidStateError('A count session can only be closed once it has reconciled with no unresolved variances');
      if (!session.reconciliation || session.reconciliation.status !== 'BALANCED') throw new ValidationAppError('Cannot close — reconciliation is not BALANCED');
      if (session.sheets.some((s) => s.status !== 'COMPLETED')) throw new ValidationAppError('Cannot close — not every count sheet is complete');

      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'CLOSED', version: { increment: 1 } } });
      await tx.inventoryCountPlan.update({ where: { id: session.inventoryCountPlanId }, data: { status: 'CLOSED', updatedBy: userId, version: { increment: 1 } } }).catch(() => undefined);
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SESSION_CLOSED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  async cancel(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, reason?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (['CLOSED', 'CANCELLED'].includes(session.status)) throw new ValidationAppError(`Cannot cancel a session that is already ${session.status}`);

      const links = await tx.inventoryCountAdjustmentLink.findMany({ where: { tenantId, sessionId } });
      for (const link of links) {
        const doc = await this.findDocument(tx, link.adjustmentDocumentType, link.adjustmentDocumentId, tenantId);
        if (doc?.postingStatus === 'POSTED') throw new ValidationAppError('Cannot cancel — this session already has posted adjustments; unpost them first');
      }

      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SESSION_CANCELLED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'UPDATE', userId, newValues: { reason } }, tx);
      return updated;
    });
  }

  private async findDocument(tx: PrismaTransactionClient, documentType: string, documentId: string, tenantId: string): Promise<{ postingStatus: string } | null> {
    switch (documentType) {
      case 'INVENTORY_ADJUSTMENT':
        return tx.inventoryAdjustment.findFirst({ where: { id: documentId, tenantId } });
      case 'WAREHOUSE_TRANSFER':
        return tx.warehouseTransfer.findFirst({ where: { id: documentId, tenantId } });
      case 'INVENTORY_STATUS_TRANSFER':
        return tx.inventoryStatusTransfer.findFirst({ where: { id: documentId, tenantId } });
      default:
        return null;
    }
  }
}
