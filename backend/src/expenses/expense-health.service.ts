import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountablePersonService } from '../cash-desk/accountable-person.service';

export interface ExpenseHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  code: string;
  employmentId: string | null;
  claimId: string | null;
  message: string;
}

const OVERDUE_ADVANCE_DAYS = 30;

/**
 * ExpenseHealthService (docx spec Phase 20 sections 126-127) — a
 * practical subset of the spec's own checklist, computed live like
 * every other *HealthService in this codebase.
 */
@Injectable()
export class ExpenseHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  async check(tenantId: string, membershipId: string, organizationId: string): Promise<ExpenseHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: ExpenseHealthIssue[] = [];

    const ageing = await this.accountablePersons.ageing(tenantId, membershipId, organizationId);
    for (const row of ageing) {
      if (row.daysOutstanding > OVERDUE_ADVANCE_DAYS) {
        issues.push({
          severity: 'WARNING',
          code: 'OVERDUE_EMPLOYEE_ADVANCE',
          employmentId: null,
          claimId: null,
          message: `Accountable person ${row.personId} has an advance outstanding ${row.outstanding} for ${row.daysOutstanding} days`,
        });
      }
    }

    const approvedNotPosted = await this.prisma.expenseClaim.findMany({
      where: { tenantId, organizationId, claimStatus: 'APPROVED', postingStatus: { not: 'POSTED' } },
    });
    for (const c of approvedNotPosted) {
      issues.push({
        severity: 'WARNING',
        code: 'APPROVED_CLAIM_NOT_POSTED',
        employmentId: c.employmentId,
        claimId: c.id,
        message: `Expense claim ${c.number ?? c.id} is approved but not yet posted to the GL`,
      });
    }

    const missingReceipts = await this.prisma.expenseClaimLine.findMany({
      where: { tenantId, taxStatus: 'MISSING', claim: { organizationId } },
      include: { claim: true },
    });
    for (const l of missingReceipts) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_MANDATORY_RECEIPT',
        employmentId: l.claim.employmentId,
        claimId: l.claimId,
        message: `Claim line ${l.id} on claim ${l.claim.number ?? l.claimId} has a taxable amount but no receipt on file`,
      });
    }

    const prepaids = await this.prisma.prepaidExpense.findMany({
      where: { organizationId, status: { in: ['ACTIVE', 'FULLY_RECOGNIZED'] } },
      include: { schedule: true },
    });
    for (const p of prepaids) {
      const remaining = Number(p.remainingAmount.toString());
      const hasFutureSchedule = p.schedule.some((s) => s.status === 'PLANNED');
      if (remaining <= 0.005 && hasFutureSchedule) {
        issues.push({
          severity: 'ERROR',
          code: 'ZERO_BALANCE_WITH_RESIDUAL_SCHEDULE',
          employmentId: null,
          claimId: null,
          message: `Prepaid expense ${p.id} has zero remaining balance but still has PLANNED schedule rows`,
        });
      }
      if (remaining > 0.005 && p.schedule.length === 0) {
        issues.push({
          severity: 'WARNING',
          code: 'NONZERO_PREPAID_WITHOUT_SCHEDULE',
          employmentId: null,
          claimId: null,
          message: `Prepaid expense ${p.id} has a remaining balance of ${p.remainingAmount.toString()} but no recognition schedule`,
        });
      }
    }

    return issues;
  }
}
