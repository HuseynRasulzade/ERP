import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine, AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AllocationRuleService } from './allocation-rule.service';
import { RunCostAllocationDto } from './dto/expenses.dto';
import { EXPENSE_MOVEMENT_REGISTER } from './expense-movement-register.service';

export const COST_ALLOCATION_RUN_TYPE = 'COST_ALLOCATION_RUN';

interface ComputedLine {
  allocationRuleId: string;
  sourceCostCenterId: string;
  targetType: string;
  targetId: string;
  driverValue: Decimal | null;
  percentage: Decimal | null;
  allocatedAmount: Decimal;
}

/**
 * CostAllocationRunService (docx spec Phase 20 sections 68-74) — one run
 * covers every ACTIVE AllocationRule for the organization/period.
 * `preview()` is a pure read: it NEVER writes anything, not even a run
 * row (spec section 70). `calculate()` persists the run + lines;
 * `post()` builds the GL reclassification (Dr target cost center / Cr
 * source cost center, SAME account — spec section 72: allocation must
 * never increase total company expense) and writes
 * `EXPENSE_MOVEMENT_REGISTER` COST_ALLOCATION_OUT/IN movements.
 *
 * Disclosed simplification: the reclassification GL entry assumes the
 * shared-cost source posted through a single account (`ADMIN_EXPENSE`)
 * — a cost pool spanning multiple GL accounts is not split per-account
 * in this build; scope `expenseCategoryFilter` to same-account
 * categories for correctness. See docs/EXPENSES.md.
 */
@Injectable()
export class CostAllocationRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly rules: AllocationRuleService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
  ) {}

  async preview(tenantId: string, membershipId: string, organizationId: string, dto: RunCostAllocationDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const { lines, sourceAmountTotal, allocatedAmountTotal } = await this.computeAllocations(tenantId, organizationId, dto);
    return {
      periodYear: dto.periodYear,
      periodMonth: dto.periodMonth,
      sourceAmount: sourceAmountTotal.toFixed(2),
      allocatedAmount: allocatedAmountTotal.toFixed(2),
      residual: sourceAmountTotal.minus(allocatedAmountTotal).toFixed(4),
      lines: lines.map((l) => ({ ...l, driverValue: l.driverValue?.toFixed(4) ?? null, percentage: l.percentage?.toFixed(4) ?? null, allocatedAmount: l.allocatedAmount.toFixed(2) })),
    };
  }

  async calculate(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: RunCostAllocationDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const { lines, sourceAmountTotal, allocatedAmountTotal } = await this.computeAllocations(tenantId, organizationId, dto);

    const run = await this.prisma.runInTransaction(async (tx) => {
      const created = await tx.costAllocationRun.create({
        data: {
          tenantId,
          organizationId,
          periodYear: dto.periodYear,
          periodMonth: dto.periodMonth,
          status: 'CALCULATED',
          sourceAmount: sourceAmountTotal,
          allocatedAmount: allocatedAmountTotal,
          residual: sourceAmountTotal.minus(allocatedAmountTotal),
          lines: {
            create: lines.map((l) => ({
              tenantId,
              allocationRuleId: l.allocationRuleId,
              sourceCostCenterId: l.sourceCostCenterId,
              targetType: l.targetType,
              targetId: l.targetId,
              driverValue: l.driverValue,
              percentage: l.percentage,
              allocatedAmount: l.allocatedAmount,
            })),
          },
        },
        include: { lines: true },
      });
      return created;
    });

    await this.audit.record({
      tenantId,
      eventType: 'COST_ALLOCATION_CALCULATED',
      entityType: COST_ALLOCATION_RUN_TYPE,
      entityId: run.id,
      action: 'CREATE',
      userId,
      newValues: { sourceAmount: sourceAmountTotal.toFixed(2), lineCount: run.lines.length },
    });
    return run;
  }

  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = await this.prisma.costAllocationRun.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
    if (!run) throw new NotFoundAppError('CostAllocationRun', id);
    if (run.status !== 'CALCULATED') throw new ValidationAppError(`Cannot post a cost allocation run in status ${run.status}`);
    if (run.lines.length === 0) throw new ValidationAppError('Nothing to post — no allocation lines');

    const businessDate = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));

    const result = await this.prisma.runInTransaction(async (tx) => {
      const account = await this.mappings.resolve(tenantId, organizationId, 'ADMIN_EXPENSE', businessDate, tx);
      const glLines: AccountingPostingLineInput[] = [];
      let sequenceCounter = 0;

      const bySourceCostCenter = new Map<string, Decimal>();
      for (const line of run.lines) {
        const amount = new Decimal(line.allocatedAmount.toString());
        if (amount.lte(0)) continue;
        bySourceCostCenter.set(line.sourceCostCenterId, (bySourceCostCenter.get(line.sourceCostCenterId) ?? new Decimal(0)).plus(amount));

        glLines.push({
          accountId: account.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Cost allocation ${run.periodYear}-${String(run.periodMonth).padStart(2, '0')} — into ${line.targetId}`,
          dimensions: line.targetType === 'COST_CENTER' ? [{ dimensionCode: 'COST_CENTER', referenceId: line.targetId }] : [],
        });

        sequenceCounter += 1;
        await tx.registerMovement.create({
          data: {
            tenantId,
            registerCode: EXPENSE_MOVEMENT_REGISTER,
            recorderDocumentType: COST_ALLOCATION_RUN_TYPE,
            recorderDocumentId: run.id,
            recorderLineId: line.id,
            businessDate,
            sequence: BigInt(sequenceCounter),
            movementType: 'COST_ALLOCATION_IN',
            dimensions: { organizationId, costCenterId: line.targetId },
            resources: { expenseAmount: amount.toString() },
          },
        });
      }

      for (const [sourceCostCenterId, amount] of bySourceCostCenter) {
        glLines.push({
          accountId: account.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Cost allocation ${run.periodYear}-${String(run.periodMonth).padStart(2, '0')} — out of ${sourceCostCenterId}`,
          dimensions: [{ dimensionCode: 'COST_CENTER', referenceId: sourceCostCenterId }],
        });
        sequenceCounter += 1;
        await tx.registerMovement.create({
          data: {
            tenantId,
            registerCode: EXPENSE_MOVEMENT_REGISTER,
            recorderDocumentType: COST_ALLOCATION_RUN_TYPE,
            recorderDocumentId: run.id,
            businessDate,
            sequence: BigInt(sequenceCounter),
            movementType: 'COST_ALLOCATION_OUT',
            dimensions: { organizationId, costCenterId: sourceCostCenterId },
            resources: { expenseAmount: amount.negated().toString() },
          },
        });
      }

      await this.accountingEngine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate,
          postingDate: businessDate,
          description: `Cost allocation ${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`,
          operationType: 'SYSTEM_DOCUMENT',
          sourceDocumentType: COST_ALLOCATION_RUN_TYPE,
          sourceDocumentId: run.id,
          lines: glLines,
        },
        tx,
      );

      const updateResult = await tx.costAllocationRun.updateMany({
        where: { id, organizationId, calculationVersion: expectedVersion },
        data: { status: 'POSTED', calculationVersion: { increment: 1 } },
      });
      if (updateResult.count === 0) throw new ValidationAppError('Concurrent modification — reload and retry');
      return tx.costAllocationRun.findUnique({ where: { id }, include: { lines: true } });
    });

    await this.audit.record({
      tenantId,
      eventType: 'COST_ALLOCATION_POSTED',
      entityType: COST_ALLOCATION_RUN_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return result;
  }

  private async computeAllocations(
    tenantId: string,
    organizationId: string,
    dto: RunCostAllocationDto,
  ): Promise<{ lines: ComputedLine[]; sourceAmountTotal: Decimal; allocatedAmountTotal: Decimal }> {
    const periodStart = new Date(Date.UTC(dto.periodYear, dto.periodMonth - 1, 1));
    const periodEnd = new Date(Date.UTC(dto.periodYear, dto.periodMonth, 0));
    const activeRules = await this.rules.listActiveForPeriod(tenantId, organizationId, periodEnd);

    const lines: ComputedLine[] = [];
    let sourceAmountTotal = new Decimal(0);
    let allocatedAmountTotal = new Decimal(0);

    for (const rule of activeRules) {
      const movements = await this.prisma.registerMovement.findMany({
        where: {
          tenantId,
          registerCode: EXPENSE_MOVEMENT_REGISTER,
          movementType: 'CURRENT_EXPENSE',
          businessDate: { gte: periodStart, lte: periodEnd },
        },
      });
      const categoryFilter = rule.expenseCategoryFilter as string[] | null;
      let sourceAmount = new Decimal(0);
      for (const m of movements) {
        const dims = m.dimensions as { costCenterId?: string | null; expenseCategoryId?: string | null } | null;
        if (dims?.costCenterId !== rule.sourceCostCenterId) continue;
        if (categoryFilter && categoryFilter.length > 0 && (!dims?.expenseCategoryId || !categoryFilter.includes(dims.expenseCategoryId))) continue;
        const resources = m.resources as { expenseAmount?: string } | null;
        sourceAmount = sourceAmount.plus(new Decimal(resources?.expenseAmount ?? '0'));
      }
      if (sourceAmount.lte(0)) continue;
      sourceAmountTotal = sourceAmountTotal.plus(sourceAmount);

      const targets = rule.targets as Array<{ targetType: string; targetId: string; fixedWeight?: number }>;
      const ruleLines = await this.allocateForRule(tenantId, rule, targets, sourceAmount, dto);
      for (const l of ruleLines) allocatedAmountTotal = allocatedAmountTotal.plus(l.allocatedAmount);
      lines.push(...ruleLines);
    }

    return { lines, sourceAmountTotal, allocatedAmountTotal };
  }

  private async allocateForRule(
    tenantId: string,
    rule: { id: string; sourceCostCenterId: string; allocationType: string; allocationDriverId: string | null },
    targets: Array<{ targetType: string; targetId: string; fixedWeight?: number }>,
    sourceAmount: Decimal,
    dto: RunCostAllocationDto,
  ): Promise<ComputedLine[]> {
    if (rule.allocationType === 'DIRECT') {
      return [
        {
          allocationRuleId: rule.id,
          sourceCostCenterId: rule.sourceCostCenterId,
          targetType: targets[0].targetType,
          targetId: targets[0].targetId,
          driverValue: null,
          percentage: new Decimal(100),
          allocatedAmount: sourceAmount,
        },
      ];
    }

    let weights: Array<{ targetType: string; targetId: string; weight: Decimal }>;
    if (rule.allocationType === 'DRIVER_BASED' && rule.allocationDriverId) {
      const driverValues = await this.prisma.allocationDriverValue.findMany({
        where: {
          allocationDriverId: rule.allocationDriverId,
          periodYear: dto.periodYear,
          periodMonth: dto.periodMonth,
          status: 'ACTIVE',
          targetId: { in: targets.map((t) => t.targetId) },
        },
      });
      const valueByTarget = new Map(driverValues.map((v) => [v.targetId, new Decimal(v.value.toString())]));
      weights = targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId, weight: valueByTarget.get(t.targetId) ?? new Decimal(0) }));
    } else {
      // MANUAL: fixedWeight per target (assumed to sum to 100).
      weights = targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId, weight: new Decimal(t.fixedWeight ?? 0) }));
    }

    const totalWeight = weights.reduce((sum, w) => sum.plus(w.weight), new Decimal(0));
    if (totalWeight.lte(0)) return [];

    const lines: ComputedLine[] = [];
    let allocatedSoFar = new Decimal(0);
    weights.forEach((w, i) => {
      const isLast = i === weights.length - 1;
      const percentage = w.weight.div(totalWeight).mul(100);
      const amount = isLast ? sourceAmount.minus(allocatedSoFar) : sourceAmount.mul(w.weight).div(totalWeight).toDecimalPlaces(2);
      allocatedSoFar = allocatedSoFar.plus(amount);
      lines.push({
        allocationRuleId: rule.id,
        sourceCostCenterId: rule.sourceCostCenterId,
        targetType: w.targetType,
        targetId: w.targetId,
        driverValue: w.weight,
        percentage,
        allocatedAmount: amount,
      });
    });
    return lines;
  }
}
