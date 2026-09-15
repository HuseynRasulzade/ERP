import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface PayrollCloseCheck {
  code: string;
  passed: boolean;
  message: string;
}

/**
 * PayrollCloseService (spec section 123). Payment is explicitly NOT
 * required for close (spec section 124) — accrued-but-unpaid salary is a
 * valid liability; this checklist never checks payment status.
 */
@Injectable()
export class PayrollCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async runChecks(tenantId: string, membershipId: string, organizationId: string, payrollPeriodId: string): Promise<PayrollCloseCheck[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: payrollPeriodId, tenantId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', payrollPeriodId);
    const checks: PayrollCloseCheck[] = [];

    const workTimePeriod = await this.prisma.workTimePeriod.findFirst({ where: { tenantId, organizationId, periodStart: period.periodStart } });
    checks.push({ code: 'WORK_TIME_PERIOD_LOCKED', passed: !!workTimePeriod && workTimePeriod.status === 'LOCKED', message: workTimePeriod?.status === 'LOCKED' ? 'Work time period is locked.' : 'Work time period is not yet locked.' });

    const latestRun = await this.prisma.payrollCalculationRun.findFirst({ where: { tenantId, payrollPeriodId }, orderBy: { startedAt: 'desc' } });
    checks.push({ code: 'CALCULATION_COMPLETE', passed: !!latestRun && latestRun.status !== 'ERROR' && latestRun.employeesFailed === 0, message: latestRun ? `${latestRun.employeesProcessed} processed, ${latestRun.employeesFailed} failed.` : 'No calculation run found.' });

    const unresolvedErrors = latestRun ? await this.prisma.payrollCalculationError.count({ where: { tenantId, calculationRunId: latestRun.id, resolved: false, blocking: true } }) : 0;
    checks.push({ code: 'ERRORS_RESOLVED', passed: unresolvedErrors === 0, message: unresolvedErrors === 0 ? 'No unresolved blocking errors.' : `${unresolvedErrors} unresolved blocking error(s).` });

    const pendingRecalc = await this.prisma.payrollRecalculationRequest.count({ where: { tenantId, status: 'PENDING', earliestAffectedPeriod: { lte: period.periodEnd }, employment: { organizationId } } });
    checks.push({ code: 'RECALCULATION_QUEUE_CLEAR', passed: pendingRecalc === 0, message: pendingRecalc === 0 ? 'No pending recalculation requests affect this period.' : `${pendingRecalc} pending recalculation request(s) affect this period.` });

    checks.push({ code: 'LIABILITIES_GENERATED', passed: (await this.prisma.payrollLiability.count({ where: { tenantId, organizationId, payrollPeriodId } })) > 0, message: 'Payroll liabilities generated from the posted run.' });
    checks.push({ code: 'ACCOUNTING_POSTED', passed: !!latestRun && latestRun.status === 'POSTED', message: latestRun?.status === 'POSTED' ? 'Payroll accounting is posted.' : 'Payroll has not been posted to the ledger yet.' });

    return checks;
  }

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, payrollPeriodId: string) {
    const checks = await this.runChecks(tenantId, membershipId, organizationId, payrollPeriodId);
    const failed = checks.filter((c) => !c.passed);
    if (failed.length > 0) throw new ValidationAppError(`Cannot close payroll period — ${failed.length} check(s) failed: ${failed.map((c) => c.code).join(', ')}`);
    const row = await this.prisma.payrollPeriod.update({ where: { id: payrollPeriodId }, data: { status: 'CLOSED', closedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_PERIOD_CLOSED', entityType: 'PAYROLL_PERIOD', entityId: payrollPeriodId, action: 'UPDATE', userId, newValues: {} });
    return row;
  }
}
