import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CostingFinalizationBlockedError, CostingPeriodFinalizedError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * CostingPeriodService (spec sections 57-60) — the costing-specific period
 * gate alongside `AccountingPeriod` (Phase 0). `finalize` is the callable
 * `FinalizeInventoryCost(period)` operation spec section 57 asks for: it
 * blocks while any cost recalculation for the period (or earlier) is still
 * pending, or an unresolved BLOCKING costing error exists, and never
 * finalizes silently over either.
 */
@Injectable()
export class CostingPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, organizationId: string) {
    return this.prisma.inventoryCostingPeriod.findMany({ where: { tenantId, organizationId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  async getOrCreate(tenantId: string, organizationId: string, year: number, month: number, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const existing = await client.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, year, month } });
    if (existing) return existing;
    return client.inventoryCostingPeriod.create({ data: { tenantId, organizationId, year, month, status: 'OPEN' } });
  }

  /** Blocks a cost-affecting posting into an already-FINALIZED period —
   * called from `InventoryCostingService.receiveCost`/`consumeCost`. A
   * period that doesn't exist yet (never finalized) is treated as open. */
  async assertPeriodOpen(tenantId: string, organizationId: string, businessDate: Date, tx: PrismaTransactionClient): Promise<void> {
    const year = businessDate.getUTCFullYear();
    const month = businessDate.getUTCMonth() + 1;
    const period = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, year, month } });
    if (period && period.status === 'FINALIZED') {
      throw new CostingPeriodFinalizedError(year, month);
    }
  }

  async finalize(tenantId: string, organizationId: string, year: number, month: number, userId: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const period = await this.getOrCreate(tenantId, organizationId, year, month, tx);
      if (period.status === 'FINALIZED') throw new ValidationAppError('This inventory costing period is already finalized');

      const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const pendingRecalc = await tx.inventoryCostRecalculationQueue.findFirst({
        where: { tenantId, organizationId, status: { in: ['PENDING', 'PROCESSING'] }, earliestAffectedDate: { lte: periodEnd } },
      });
      if (pendingRecalc) {
        throw new CostingFinalizationBlockedError('Pending inventory cost recalculation must complete before this period can be finalized');
      }

      const blockingErrors = await tx.inventoryCostingError.count({ where: { tenantId, organizationId, resolved: false, blocking: true } });
      if (blockingErrors > 0) {
        throw new CostingFinalizationBlockedError(`${blockingErrors} unresolved blocking costing error(s) must be resolved before this period can be finalized`);
      }

      const updated = await tx.inventoryCostingPeriod.update({
        where: { id: period.id },
        data: { status: 'FINALIZED', finalCalculatedAt: new Date(), finalizedBy: userId, version: { increment: 1 } },
      });

      await this.audit.record(
        { tenantId, eventType: 'INVENTORY_COSTING_PERIOD_FINALIZED', entityType: 'InventoryCostingPeriod', entityId: updated.id, action: 'UPDATE', userId, newValues: { year, month } },
        tx,
      );

      return updated;
    });
  }

  async reopen(tenantId: string, organizationId: string, year: number, month: number, userId: string, reason?: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const period = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, year, month } });
      if (!period) throw new NotFoundAppError('InventoryCostingPeriod', `${year}-${month}`);
      if (period.status !== 'FINALIZED') throw new ValidationAppError('Only a finalized inventory costing period can be reopened');

      const updated = await tx.inventoryCostingPeriod.update({
        where: { id: period.id },
        data: { status: 'REOPENED', reopenedAt: new Date(), reopenedBy: userId, version: { increment: 1 } },
      });

      await this.audit.record(
        { tenantId, eventType: 'INVENTORY_COSTING_PERIOD_REOPENED', entityType: 'InventoryCostingPeriod', entityId: updated.id, action: 'UPDATE', userId, reason, newValues: { year, month } },
        tx,
      );

      return updated;
    });
  }
}
