import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const ENTITY_TYPE = 'PAYROLL_PERIOD';

/**
 * PayrollCloseService — a practical subset of the spec's own payroll-close
 * checklist (docx spec Phase 19, close-period sections): before CLOSED can
 * be set, the period must be fully PAID, its GL posting must be POSTED,
 * and no unresolved blocking PayrollError may remain. Reopening a CLOSED
 * period is already covered by PayrollPeriodService.reopen() (spec: a
 * close is never permanent — see docs/PAYROLL.md for what a reopen does
 * and does NOT cascade-undo).
 */
@Injectable()
export class PayrollCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, periodId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', periodId);
    if (period.status !== 'PAID')
      throw new ValidationAppError(`Cannot close a payroll period in status ${period.status} — it must be fully PAID first`);

    const posting = await this.prisma.payrollPosting.findUnique({ where: { payrollPeriodId: periodId } });
    if (!posting || posting.postingStatus !== 'POSTED')
      throw new ValidationAppError('Cannot close a payroll period whose GL posting is not POSTED');

    const blockingError = await this.prisma.payrollError.findFirst({
      where: { calculationRun: { payrollPeriodId: periodId }, blocking: true, resolved: false },
    });
    if (blockingError) throw new ValidationAppError('Cannot close: unresolved blocking payroll errors exist');

    const updated = await this.prisma.payrollPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_PERIOD_CLOSED',
      entityType: ENTITY_TYPE,
      entityId: periodId,
      action: 'UPDATE',
      userId,
    });
    return updated;
  }
}
