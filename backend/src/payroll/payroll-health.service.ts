import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface PayrollHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  payrollPeriodId: string | null;
  employmentId: string | null;
  message: string;
}

/**
 * PayrollHealthService (docx spec Phase 19) — a practical subset of the
 * spec's own health checklist, computed live like every other
 * *HealthService in this codebase.
 */
@Injectable()
export class PayrollHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async check(tenantId: string, membershipId: string, organizationId: string): Promise<PayrollHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: PayrollHealthIssue[] = [];

    const unresolvedErrors = await this.prisma.payrollError.findMany({
      where: { tenantId, blocking: true, resolved: false, calculationRun: { organizationId } },
    });
    for (const e of unresolvedErrors) {
      issues.push({
        severity: 'ERROR',
        code: `UNRESOLVED_${e.errorCode}`,
        payrollPeriodId: null,
        employmentId: e.employmentId,
        message: e.message,
      });
    }

    const approvedWithoutPosting = await this.prisma.payrollPeriod.findMany({
      where: { organizationId, status: 'APPROVED' },
    });
    for (const p of approvedWithoutPosting) {
      const posting = await this.prisma.payrollPosting.findUnique({ where: { payrollPeriodId: p.id } });
      if (!posting) {
        issues.push({
          severity: 'WARNING',
          code: 'APPROVED_PERIOD_NOT_POSTED',
          payrollPeriodId: p.id,
          employmentId: null,
          message: `Payroll period ${p.year}-${String(p.month).padStart(2, '0')} is APPROVED but has no GL posting yet`,
        });
      }
    }

    const staleErrorPeriods = await this.prisma.payrollPeriod.findMany({ where: { organizationId, status: 'ERROR' } });
    for (const p of staleErrorPeriods) {
      issues.push({
        severity: 'ERROR',
        code: 'PERIOD_IN_ERROR_STATUS',
        payrollPeriodId: p.id,
        employmentId: null,
        message: `Payroll period ${p.year}-${String(p.month).padStart(2, '0')} is in status ERROR`,
      });
    }

    const postedPeriods = await this.prisma.payrollPeriod.findMany({
      where: { organizationId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
    });
    for (const p of postedPeriods) {
      const results = await this.prisma.payrollCalculationResult.findMany({
        where: { tenantId, payrollPeriodId: p.id, status: 'CALCULATED' },
      });
      const totalNet = results.reduce((sum, r) => sum.plus(r.net.toString()), new Decimal(0));
      const paidAgg = await this.prisma.payrollPaymentAllocation.aggregate({
        where: { tenantId, payrollPeriodId: p.id, status: 'PAID' },
        _sum: { amount: true },
      });
      const paidTotal = new Decimal(paidAgg._sum.amount?.toString() ?? '0');
      if (paidTotal.gt(totalNet)) {
        issues.push({
          severity: 'ERROR',
          code: 'OVERPAID_PERIOD',
          payrollPeriodId: p.id,
          employmentId: null,
          message: `Payroll period ${p.year}-${String(p.month).padStart(2, '0')} has paid ${paidTotal.toFixed(2)} against a net liability of ${totalNet.toFixed(2)}`,
        });
      }
    }

    return issues;
  }
}
