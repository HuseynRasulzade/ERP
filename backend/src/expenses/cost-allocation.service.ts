import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

const ALLOCATION_SOURCE_TYPE = 'COST_ALLOCATION_RUN';

/**
 * AllocationRuleService + CostAllocationRunService combined (spec
 * sections 64-74). Only `DIRECT` (a claim line already carries its own
 * cost center/allocation, so no run is needed — spec section 66) and
 * `DRIVER_BASED` are fully calculated in this build (spec section 65's
 * own "At minimum DIRECT və DRIVER_BASED tam işləməlidir"); `STEP_DOWN`/
 * `RECIPROCAL_FUTURE` are valid `allocationType` values with a
 * `sequence` field ready for a future multi-pass engine, but this pass
 * only ever does one direct driver-weighted split per rule (disclosed
 * simplification, see docs/EXPENSES.md). Posting is a pure analytical
 * reclassification (spec section 71's own alternative to a real
 * Dr/Cr expense swap) — Dr a generic expense account dimensioned to the
 * TARGET cost center, Cr `EXPENSE_ALLOCATION_CLEARING` dimensioned to the
 * SOURCE — so total organization expense never changes (spec section 72).
 */
@Injectable()
export class CostAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
  ) {}

  async createRule(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { code: string; name: string; sourceCostCenterId: string; expenseCategoryFilter?: string; allocationType?: string; driverId?: string; targetCostCenterIds: string[]; allocationFrequency?: string; sequence?: number; effectiveFrom: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.allocationRule.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        sourceCostCenterId: dto.sourceCostCenterId,
        expenseCategoryFilter: dto.expenseCategoryFilter,
        allocationType: dto.allocationType ?? 'DRIVER_BASED',
        driverId: dto.driverId,
        targetCostCenterIds: dto.targetCostCenterIds.join(','),
        allocationFrequency: dto.allocationFrequency ?? 'MONTHLY',
        sequence: dto.sequence ?? 1,
        effectiveFrom: new Date(dto.effectiveFrom),
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'ALLOCATION_RULE_CREATED', entityType: 'ALLOCATION_RULE', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return row;
  }

  listRules(tenantId: string, organizationId: string) {
    return this.prisma.allocationRule.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' } });
  }

  /** Calculates a PREVIEW or CALCULATED run — no GL movement until
   * `.post` (spec section 70). Source amount is the sum of posted
   * `ExpenseClaimLine.approvedAmount` for the rule's own source cost
   * center + category filter within the period. */
  async calculate(tenantId: string, membershipId: string, organizationId: string, userId: string, ruleId: string, period: string, preview = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rule = await this.prisma.allocationRule.findFirst({ where: { id: ruleId, tenantId, organizationId } });
    if (!rule) throw new NotFoundAppError('AllocationRule', ruleId);
    const periodStart = new Date(period);
    const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
    const categoryCodes = rule.expenseCategoryFilter?.split(',').map((c) => c.trim());

    const sourceLines = await this.prisma.expenseClaimLine.findMany({ where: { tenantId, costCenterId: rule.sourceCostCenterId, expenseDate: { gte: periodStart, lte: periodEnd }, approvedAmount: { not: null }, ...(categoryCodes ? { category: { code: { in: categoryCodes } } } : {}) } });
    const sourceAmount = sourceLines.reduce((s, l) => s.plus((l.approvedAmount ?? 0).toString()), new Decimal(0));

    const targetIds = rule.targetCostCenterIds.split(',').filter(Boolean);
    let weights: { costCenterId: string; weight: Decimal }[];
    if (rule.allocationType === 'DIRECT') {
      weights = targetIds.map((id) => ({ costCenterId: id, weight: new Decimal(1).dividedBy(targetIds.length) }));
    } else {
      if (!rule.driverId) throw new ValidationAppError('DRIVER_BASED allocation requires a driverId');
      const driverValues = await this.prisma.allocationDriverValue.findMany({ where: { tenantId, driverId: rule.driverId, period: periodStart, costCenterId: { in: targetIds }, status: 'ACTIVE' } });
      const totalDriver = driverValues.reduce((s, v) => s.plus(v.value.toString()), new Decimal(0));
      if (totalDriver.lte(0)) throw new ValidationAppError(`No driver values found for period ${period} — seed AllocationDriverValue rows first (spec section 128 MISSING_LEGAL_RULE-equivalent for allocation).`);
      weights = targetIds.map((id) => {
        const v = driverValues.find((dv) => dv.costCenterId === id);
        return { costCenterId: id, weight: v ? new Decimal(v.value.toString()).dividedBy(totalDriver) : new Decimal(0) };
      });
    }

    return this.prisma.runInTransaction(async (tx) => {
      const run = await tx.costAllocationRun.create({ data: { tenantId, organizationId, ruleId, period: periodStart, status: preview ? 'PREVIEW' : 'CALCULATED', sourceAmount: sourceAmount.toString(), initiatedBy: userId } });
      let allocatedSoFar = new Decimal(0);
      for (let i = 0; i < weights.length; i++) {
        const isLast = i === weights.length - 1;
        const amount = isLast ? sourceAmount.minus(allocatedSoFar) : sourceAmount.mul(weights[i].weight).toDecimalPlaces(2);
        allocatedSoFar = allocatedSoFar.plus(amount);
        await tx.costAllocationRunLine.create({ data: { tenantId, runId: run.id, targetCostCenterId: weights[i].costCenterId, percentage: weights[i].weight.mul(100).toString(), amount: amount.toString() } });
      }
      const updated = await tx.costAllocationRun.update({ where: { id: run.id }, data: { allocatedAmount: allocatedSoFar.toString(), residual: sourceAmount.minus(allocatedSoFar).toString(), completedAt: new Date() } });
      await this.audit.record({ tenantId, eventType: 'COST_ALLOCATION_CALCULATED', entityType: 'COST_ALLOCATION_RUN', entityId: run.id, action: 'CREATE', userId, newValues: { sourceAmount: sourceAmount.toString(), preview } }, tx);
      return tx.costAllocationRun.findUniqueOrThrow({ where: { id: updated.id }, include: { lines: true } });
    });
  }

  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, runId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = await this.prisma.costAllocationRun.findFirst({ where: { id: runId, tenantId, organizationId }, include: { lines: true } });
    if (!run) throw new NotFoundAppError('CostAllocationRun', runId);
    if (run.status !== 'CALCULATED') throw new ValidationAppError(`Run must be CALCULATED before posting (currently ${run.status})`);
    const rule = await this.prisma.allocationRule.findFirstOrThrow({ where: { id: run.ruleId } });
    const businessDate = new Date(run.period.getFullYear(), run.period.getMonth() + 1, 0);

    const expenseAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate).catch(() => null);
    const clearingAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.EXPENSE_ALLOCATION_CLEARING, businessDate).catch(() => null);
    if (!expenseAccount || !clearingAccount) throw new ValidationAppError('Missing OTHER_OPERATING_EXPENSE or EXPENSE_ALLOCATION_CLEARING account mapping — resolve before posting.');

    return this.prisma.runInTransaction(async (tx: PrismaTransactionClient) => {
      const lines: { accountId: string; side: 'DEBIT' | 'CREDIT'; amountBase: Decimal; description: string; dimensions: { dimensionCode: string; referenceId: string }[] }[] = run.lines.filter((l) => new Decimal(l.amount.toString()).gt(0)).map((l) => ({ accountId: expenseAccount.id, side: 'DEBIT', amountBase: new Decimal(l.amount.toString()), description: `Cost allocation from ${rule.code}`, dimensions: [{ dimensionCode: 'COST_CENTER', referenceId: l.targetCostCenterId }] }));
      lines.push({ accountId: clearingAccount.id, side: 'CREDIT' as const, amountBase: new Decimal(run.allocatedAmount.toString()), description: `Cost allocation clearing for ${rule.code}`, dimensions: [{ dimensionCode: 'COST_CENTER', referenceId: rule.sourceCostCenterId }] });

      const batch = await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate, description: `Cost allocation ${rule.code} — ${run.period.toISOString().slice(0, 7)}`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: ALLOCATION_SOURCE_TYPE, sourceDocumentId: run.id, lines }, tx);
      const posted = await tx.costAllocationRun.update({ where: { id: runId }, data: { status: 'POSTED', postingBatchId: batch.id } });
      await this.audit.record({ tenantId, eventType: 'COST_ALLOCATION_POSTED', entityType: 'COST_ALLOCATION_RUN', entityId: runId, action: 'UPDATE', userId, newValues: { allocatedAmount: run.allocatedAmount.toString() } }, tx);
      return posted;
    });
  }

  get(tenantId: string, runId: string) {
    return this.prisma.costAllocationRun.findFirst({ where: { id: runId, tenantId }, include: { lines: true } });
  }
}
