import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface ExpenseHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  claimId?: string;
  message: string;
}

/** ExpenseHealthService — computed live, same convention as every other
 * health service in this codebase. */
@Injectable()
export class ExpenseHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<ExpenseHealthIssue[]> {
    const issues: ExpenseHealthIssue[] = [];

    const staleDrafts = await this.prisma.expenseClaim.count({ where: { tenantId, organizationId, status: 'DRAFT', createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
    if (staleDrafts > 0) issues.push({ code: 'STALE_DRAFT_CLAIM', severity: 'WARNING', message: `${staleDrafts} expense claim(s) still DRAFT after 30 days.` });

    const unresolvedPolicy = await this.prisma.expenseClaimLine.count({ where: { tenantId, policyStatus: { in: ['MISSING_RECEIPT', 'MISSING_BUSINESS_PURPOSE'] }, claim: { organizationId, status: { notIn: ['CANCELLED'] } } } });
    if (unresolvedPolicy > 0) issues.push({ code: 'UNRESOLVED_POLICY_EXCEPTION', severity: 'WARNING', message: `${unresolvedPolicy} claim line(s) have an unresolved policy exception.` });

    const duplicateReceipts = await this.prisma.expenseReceipt.count({ where: { tenantId, validationStatus: 'DUPLICATE_SUSPECTED', line: { claim: { organizationId } } } });
    if (duplicateReceipts > 0) issues.push({ code: 'SUSPECTED_DUPLICATE_RECEIPT', severity: 'ERROR', message: `${duplicateReceipts} receipt(s) flagged as a suspected duplicate.` });

    const staleRuns = await this.prisma.costAllocationRun.count({ where: { tenantId, organizationId, status: 'CALCULATED', completedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
    if (staleRuns > 0) issues.push({ code: 'ALLOCATION_RUN_NOT_POSTED', severity: 'WARNING', message: `${staleRuns} cost allocation run(s) calculated but not posted for over 14 days.` });

    const prepaidActive = await this.prisma.prepaidExpense.findMany({ where: { tenantId, organizationId, status: 'ACTIVE' } });
    for (const p of prepaidActive) {
      const overdue = await this.prisma.prepaidExpenseSchedule.count({ where: { tenantId, prepaidExpenseId: p.id, status: 'PENDING', period: { lt: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1) } } });
      if (overdue > 0) issues.push({ code: 'PREPAID_RECOGNITION_OVERDUE', severity: 'ERROR', message: `Prepaid expense ${p.id} has ${overdue} overdue unrecognized period(s).` });
    }

    const allocationResiduals = await this.prisma.costAllocationRun.findMany({ where: { tenantId, organizationId, status: { in: ['CALCULATED', 'POSTED'] }, residual: { not: 0 } } });
    for (const r of allocationResiduals) if (new Decimal(r.residual.toString()).abs().gt('0.05')) issues.push({ code: 'ALLOCATION_RESIDUAL', severity: 'WARNING', message: `Cost allocation run ${r.id} has an unexplained residual of ${r.residual.toString()}.` });

    return issues;
  }
}
