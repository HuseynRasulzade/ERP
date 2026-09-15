import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { InventoryCostRecalculationService } from './inventory-cost-recalculation.service';
import { CostingReconciliationService } from './costing-reconciliation.service';
import { InventoryCostAdjustmentService } from './inventory-cost-adjustment.service';

/**
 * CostingPeriodService (spec sections 57-60, 111, 133-134). Exposes the
 * `FinalizeInventoryCost(period)` callable operation spec section 57 asks
 * for — a real, working implementation now, wired up as the interface
 * Phase 22's full Month Close orchestration will call (spec section 137
 * boundary: full month-close ORCHESTRATION across every module is out of
 * this phase's scope, but the finalize/reopen primitives it needs are not).
 */
@Injectable()
export class CostingPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly recalculation: InventoryCostRecalculationService,
    private readonly reconciliation: CostingReconciliationService,
    private readonly adjustments: InventoryCostAdjustmentService,
  ) {}

  async getOrCreate(tenantId: string, organizationId: string, period: string) {
    const existing = await this.prisma.inventoryCostingPeriod.findUnique({ where: { tenantId_organizationId_period: { tenantId, organizationId, period } } });
    if (existing) return existing;
    return this.prisma.inventoryCostingPeriod.create({ data: { tenantId, organizationId, period, status: 'OPEN' } });
  }

  /**
   * Preview (spec section 116) — everything `finalize` would check,
   * without touching any state. Safe to call repeatedly.
   */
  async preview(tenantId: string, organizationId: string, period: string) {
    const pendingRecalc = await this.recalculation.listPending(tenantId, organizationId);
    const health = await this.reconciliation.health(tenantId, organizationId);
    const blocking = health.filter((h) => h.severity === 'BLOCKING' || h.severity === 'ERROR');
    const reconciliation = await this.reconciliation.reconcileAllCostingKeys(tenantId, organizationId);
    return {
      period,
      canFinalize: pendingRecalc.length === 0 && blocking.length === 0 && reconciliation.length === 0,
      pendingRecalculations: pendingRecalc,
      healthFindings: health,
      quantityValueMismatches: reconciliation,
    };
  }

  /**
   * FinalizeInventoryCost(period) (spec section 57). Blocks on: pending
   * recalculation, blocking/error-severity health findings, and any
   * quantity-vs-layer reconciliation mismatch (spec section 118's cost
   * flow equation must tie out within tolerance). On success, runs any
   * still-pending recalculation first (there should be none if the caller
   * ran `preview` first, but this makes `finalize` itself safe to call
   * directly too), then marks the period FINALIZED.
   */
  async finalize(tenantId: string, organizationId: string, period: string, userId: string) {
    const recalcResults = await this.recalculation.processQueue(tenantId, userId, organizationId);
    for (const { runId, deltas } of recalcResults) {
      await this.prisma.runInTransaction((tx) => this.adjustments.createFromRecalculationDeltas(tenantId, organizationId, runId, deltas, userId, tx));
    }

    const health = await this.reconciliation.health(tenantId, organizationId);
    const blocking = health.filter((h) => h.severity === 'BLOCKING' || h.severity === 'ERROR');
    if (blocking.length > 0) {
      throw new ValidationAppError(`Cannot finalize inventory costing for ${period}: ${blocking.length} blocking issue(s) — ${blocking.map((b) => b.code).join(', ')}`);
    }

    const mismatches = await this.reconciliation.reconcileAllCostingKeys(tenantId, organizationId);
    if (mismatches.length > 0) {
      throw new ValidationAppError(`Cannot finalize inventory costing for ${period}: quantity/cost-layer mismatch on ${mismatches.length} costing key(s)`);
    }

    const row = await this.getOrCreate(tenantId, organizationId, period);
    if (row.status === 'FINALIZED') throw new ValidationAppError(`Period ${period} is already finalized`);

    const run = await this.prisma.inventoryCostCalculationRun.create({ data: { tenantId, organizationId, period, calculationType: 'PERIOD_CLOSE', status: 'COMPLETED', initiatedBy: userId, completedAt: new Date() } });
    const updated = await this.prisma.inventoryCostingPeriod.update({
      where: { id: row.id },
      data: { status: 'FINALIZED', finalCalculatedAt: new Date(), finalizedBy: userId, calculationRunId: run.id },
    });

    await this.audit.record({ tenantId, eventType: 'INVENTORY_COSTING_PERIOD_FINALIZED', entityType: 'INVENTORY_COSTING_PERIOD', entityId: updated.id, action: 'UPDATE', userId, newValues: { period, status: 'FINALIZED' } });
    return updated;
  }

  /** Reopen (spec sections 59, 111) — always an explicit, audited action;
   * never implied by simply posting a backdated document into a finalized
   * period (that must fail with a clear error until this is called). */
  async reopen(tenantId: string, organizationId: string, period: string, userId: string, reason?: string) {
    const row = await this.prisma.inventoryCostingPeriod.findUnique({ where: { tenantId_organizationId_period: { tenantId, organizationId, period } } });
    if (!row || row.status !== 'FINALIZED') throw new ValidationAppError(`Period ${period} is not finalized`);

    const updated = await this.prisma.inventoryCostingPeriod.update({ where: { id: row.id }, data: { status: 'REOPENED', reopenedAt: new Date(), reopenedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COSTING_PERIOD_REOPENED', entityType: 'INVENTORY_COSTING_PERIOD', entityId: updated.id, action: 'UPDATE', userId, oldValues: { status: 'FINALIZED' }, newValues: { status: 'REOPENED', reason } });
    return updated;
  }

  /** Whether posting a cost-affecting document dated within `period`
   * should be blocked (spec sections 59, 111, 134) — checked by
   * posting handlers before they write a new layer/consumption against an
   * already-finalized period. */
  async assertPeriodOpenForCosting(tenantId: string, organizationId: string, businessDate: Date, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const period = `${businessDate.getUTCFullYear()}-${String(businessDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = await db.inventoryCostingPeriod.findUnique({ where: { tenantId_organizationId_period: { tenantId, organizationId, period } } });
    if (row?.status === 'FINALIZED') {
      throw new ValidationAppError(`Inventory costing period ${period} is finalized — reopen it first before posting a cost-affecting document dated in it`);
    }
  }
}
