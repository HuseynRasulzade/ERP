import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CreateExpenseBudgetDto } from './dto/expenses.dto';
import { EXPENSE_MOVEMENT_REGISTER } from './expense-movement-register.service';

/**
 * ExpenseBudgetService (docx spec Phase 20 sections 76-82) — a basic
 * foundation only: no commitment engine (spec section 79's fuller ask —
 * live purchase-order/expense-request commitments — is future work),
 * `committedAmount` is a manually-entered field. `Actual` always comes
 * from the posted `EXPENSE_MOVEMENT_REGISTER` (spec section 78: "Actual
 * expense should come from posted expense/accounting subledger. Not
 * from approved claim only"), never from claim totals directly.
 */
@Injectable()
export class ExpenseBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, periodYear?: number, periodMonth?: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.expenseBudget.findMany({
      where: { organizationId, ...(periodYear ? { periodYear } : {}), ...(periodMonth ? { periodMonth } : {}) },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, dto: CreateExpenseBudgetDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.expenseBudget.create({
      data: {
        tenantId,
        organizationId,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        costCenterId: dto.costCenterId,
        expenseCategoryId: dto.expenseCategoryId,
        projectId: dto.projectId,
        currencyId: dto.currencyId,
        budgetAmount: dto.budgetAmount,
        committedAmount: dto.committedAmount ?? 0,
        notes: dto.notes,
      },
    });
  }

  /** Budget vs Actual (spec sections 76-80, 144): `available = revised
   * (or original) budget - committed - actual`. */
  async budgetVsActual(tenantId: string, membershipId: string, organizationId: string, periodYear: number, periodMonth: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const budgets = await this.prisma.expenseBudget.findMany({ where: { organizationId, periodYear, periodMonth } });
    const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
    const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 0));

    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: EXPENSE_MOVEMENT_REGISTER,
        movementType: { in: ['CURRENT_EXPENSE', 'COST_ALLOCATION_IN', 'COST_ALLOCATION_OUT'] },
        businessDate: { gte: periodStart, lte: periodEnd },
      },
    });

    return budgets.map((b) => {
      const actual = movements.reduce((sum, m) => {
        const dims = m.dimensions as { costCenterId?: string | null; expenseCategoryId?: string | null } | null;
        if (b.costCenterId && dims?.costCenterId !== b.costCenterId) return sum;
        if (b.expenseCategoryId && dims?.expenseCategoryId !== b.expenseCategoryId) return sum;
        const resources = m.resources as { expenseAmount?: string } | null;
        return sum.plus(new Decimal(resources?.expenseAmount ?? '0'));
      }, new Decimal(0));
      const budgetAmount = new Decimal((b.revisedBudgetAmount ?? b.budgetAmount).toString());
      const committed = new Decimal(b.committedAmount.toString());
      const available = budgetAmount.minus(committed).minus(actual);
      return {
        costCenterId: b.costCenterId,
        expenseCategoryId: b.expenseCategoryId,
        projectId: b.projectId,
        budget: budgetAmount.toFixed(2),
        committed: committed.toFixed(2),
        actual: actual.toFixed(2),
        available: available.toFixed(2),
        variance: budgetAmount.minus(actual).toFixed(2),
        variancePercent: budgetAmount.gt(0) ? budgetAmount.minus(actual).div(budgetAmount).mul(100).toFixed(2) : '0.00',
      };
    });
  }
}
