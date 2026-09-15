import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * ExpenseBudgetService (spec sections 76-79) — a basic foundation only.
 * `actual` always comes from POSTED `ExpenseClaimLine.approvedAmount`
 * (spec section 78's own "not from approved claim only" — meaning not
 * merely APPROVED-but-unposted; this build reads posted claims), never
 * from the GL. Committed cost (open purchase orders, spec section 79) is
 * not wired into this build's `available` figure (disclosed
 * simplification, see docs/EXPENSES.md).
 */
@Injectable()
export class ExpenseBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async setBudget(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { period: string; costCenterId?: string; expenseCategoryId?: string; projectId?: string; currencyId: string; budgetAmount: number }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.expenseBudget.create({ data: { tenantId, organizationId, period: new Date(dto.period), costCenterId: dto.costCenterId, expenseCategoryId: dto.expenseCategoryId, projectId: dto.projectId, currencyId: dto.currencyId, budgetAmount: dto.budgetAmount.toString(), createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_BUDGET_SET', entityType: 'EXPENSE_BUDGET', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async budgetVsActual(tenantId: string, membershipId: string, organizationId: string, period: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = new Date(period);
    const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
    const budgets = await this.prisma.expenseBudget.findMany({ where: { tenantId, organizationId, period: periodStart } });

    const results = [];
    for (const b of budgets) {
      const actualLines = await this.prisma.expenseClaimLine.findMany({ where: { tenantId, costCenterId: b.costCenterId ?? undefined, expenseCategoryId: b.expenseCategoryId ?? undefined, projectId: b.projectId ?? undefined, expenseDate: { gte: periodStart, lte: periodEnd }, claim: { organizationId, postingStatus: 'POSTED' } } });
      const actual = actualLines.reduce((s, l) => s.plus((l.approvedAmount ?? 0).toString()), new Decimal(0));
      const budgetAmount = new Decimal((b.revisedBudgetAmount ?? b.budgetAmount).toString());
      results.push({ costCenterId: b.costCenterId, expenseCategoryId: b.expenseCategoryId, projectId: b.projectId, budget: budgetAmount.toString(), actual: actual.toString(), available: budgetAmount.minus(actual).toString() });
    }
    return results;
  }
}
