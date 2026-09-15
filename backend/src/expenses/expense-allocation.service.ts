import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * ExpenseAllocationService (spec sections 54-56). Splits ONE claim line
 * across multiple cost objects — `targetType`/`targetId` is a soft
 * polymorphic reference (no generic `CostObject` master table in this
 * build, disclosed simplification, see docs/EXPENSES.md). Enforces
 * Σ allocated = eligible amount (spec section 56) with the LAST line
 * absorbing any rounding residual rather than leaving an unexplained gap.
 */
@Injectable()
export class ExpenseAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async allocate(tenantId: string, userId: string, claimLineId: string, splits: { targetType: string; targetId: string; percentage: number }[]) {
    const line = await this.prisma.expenseClaimLine.findFirst({ where: { id: claimLineId, tenantId } });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', claimLineId);
    const totalPercentage = splits.reduce((s, x) => s + x.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) throw new ValidationAppError(`Allocation percentages must sum to 100 (got ${totalPercentage})`);

    const eligible = new Decimal((line.approvedAmount ?? line.baseAmount).toString());
    return this.prisma.runInTransaction(async (tx) => {
      await tx.expenseAllocation.updateMany({ where: { tenantId, claimLineId, status: 'ACTIVE' }, data: { status: 'REVERSED' } });
      let allocatedSoFar = new Decimal(0);
      const rows = [];
      for (let i = 0; i < splits.length; i++) {
        const split = splits[i];
        const isLast = i === splits.length - 1;
        const amount = isLast ? eligible.minus(allocatedSoFar) : eligible.mul(split.percentage).dividedBy(100).toDecimalPlaces(2);
        allocatedSoFar = allocatedSoFar.plus(amount);
        rows.push(await tx.expenseAllocation.create({ data: { tenantId, claimLineId, targetType: split.targetType, targetId: split.targetId, allocationMethod: 'MANUAL_PERCENTAGE', allocationPercentage: split.percentage.toString(), allocatedAmount: amount.toString(), effectivePeriod: line.expenseDate } }));
      }
      await this.audit.record({ tenantId, eventType: 'EXPENSE_LINE_ALLOCATED', entityType: 'EXPENSE_CLAIM_LINE', entityId: claimLineId, action: 'CREATE', userId, newValues: { splits } }, tx);
      return rows;
    });
  }

  list(tenantId: string, claimLineId: string) {
    return this.prisma.expenseAllocation.findMany({ where: { tenantId, claimLineId, status: 'ACTIVE' } });
  }
}
