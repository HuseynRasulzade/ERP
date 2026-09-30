import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveBalanceService } from './leave-balance.service';

/**
 * LeaveAccrualRunService — idempotent monthly ANNUAL-leave accrual (docx
 * spec Phase 17 continuation, closes the "no accrual engine" gap disclosed
 * on LeaveRecordService). One run per organization+period (the
 * `LeaveAccrualRun.@@unique` is the idempotency guard — re-running an
 * already-run period is rejected outright, never a silent no-op or a
 * double-credit).
 *
 * Credits every `Employment.status === 'ACTIVE'` employment (current-state
 * projection, same convention `HrReportingService`'s own reports already
 * use — not a historical as-of-period-end query) whose
 * `employmentStartDate` falls on or before the period's last day, with
 * `LeavePolicy.annualEntitlementDays / 12` for that month. Disclosed
 * simplification: no pro-ration for a hire mid-period — a January hire
 * gets the SAME full month's credit for January as anyone hired years
 * earlier, and a January termination still gets January's credit even if
 * `lastWorkingDate` was the 2nd (accrual runs are always for a CLOSED,
 * already-elapsed month in practice, so this is a minor edge case, not a
 * systemic one). No policy resolvable for the organization on the
 * period's last day is a deliberate "accrual is not active here yet"
 * skip, never a fabricated default.
 */
@Injectable()
export class LeaveAccrualRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly policies: LeavePolicyService,
    private readonly balances: LeaveBalanceService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.leaveAccrualRun.findMany({
          where: { tenantId, organizationId },
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
        }),
      );
  }

  async run(tenantId: string, membershipId: string, organizationId: string, userId: string, periodYear: number, periodMonth: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (periodMonth < 1 || periodMonth > 12) throw new ValidationAppError('periodMonth must be between 1 and 12');

    const existing = await this.prisma.leaveAccrualRun.findUnique({
      where: { organizationId_periodYear_periodMonth: { organizationId, periodYear, periodMonth } },
    });
    if (existing) throw new ValidationAppError(`Leave accrual for ${periodYear}-${String(periodMonth).padStart(2, '0')} has already run for this organization`);

    const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 0)); // last day of the month

    const policy = await this.policies.resolve(tenantId, organizationId, periodEnd);
    if (!policy) throw new ValidationAppError('No leave policy configured for this organization as of the requested period');

    const monthlyDays = new Decimal(policy.annualEntitlementDays.toString()).div(12);

    return this.prisma.runInTransaction(async (tx) => {
      const employments = await tx.employment.findMany({
        where: { organizationId, status: 'ACTIVE', employmentStartDate: { lte: periodEnd } },
        select: { id: true },
      });

      for (const employment of employments) {
        await this.balances.recordMovement(
          tenantId,
          {
            employmentId: employment.id,
            movementType: 'ACCRUAL',
            quantityDays: monthlyDays,
            effectiveDate: periodEnd,
            sourceDocumentType: 'HR_LEAVE_ACCRUAL_RUN',
            userId,
          },
          tx,
        );
      }

      const run = await tx.leaveAccrualRun.create({
        data: {
          tenantId,
          organizationId,
          periodYear,
          periodMonth,
          employmentsAccrued: employments.length,
          totalDaysAccrued: monthlyDays.mul(employments.length),
          runBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_LEAVE_ACCRUAL_RUN',
          entityType: 'LeaveAccrualRun',
          entityId: run.id,
          action: 'CREATE',
          userId,
          newValues: { periodYear, periodMonth, employmentsAccrued: employments.length, totalDaysAccrued: run.totalDaysAccrued.toString() },
        },
        tx,
      );

      return run;
    });
  }
}
