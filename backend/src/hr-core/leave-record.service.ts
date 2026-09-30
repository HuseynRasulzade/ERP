import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { LeaveBalanceService } from './leave-balance.service';
import { LeavePolicyService } from './leave-policy.service';
import { ApproveLeaveRecordDto, CreateLeaveRecordDto } from './dto/hr-core.dto';

const LEAVE_TYPE = 'HR_LEAVE_RECORD';
/** Only ANNUAL leave consumes the accrued balance — SICK/UNPAID/MATERNITY/
 * PATERNITY/STUDY/OTHER never do (disclosed simplification, same posture
 * as LeaveBalanceMovement's own schema comment). */
const BALANCE_CONSUMING_TYPE = 'ANNUAL';

/**
 * LeaveRecord — request/approval lifecycle (docx spec Phase 17 section
 * 38). The worked-hours impact of an approved leave is Phase 18's job
 * (Work Time). ANNUAL leave is validated against `LeaveBalanceService`'s
 * running balance at CREATE time (calendar days inclusive of both
 * endpoints — disclosed simplification: no working-day/schedule-aware
 * calculation, that is Phase 18's own domain) and consumes it at APPROVE
 * time, never at create — a still-pending request should not lock days
 * out of the balance a rejection would simply return.
 *
 * The balance check is only enforced for an organization that has
 * actually configured a `LeavePolicy` — same "usually not enforced until
 * an org opts in" posture as the approval workflow's own DEPARTMENT_HEAD
 * step. Without a policy, ANNUAL leave behaves exactly as it did before
 * this engine existed (unlimited, no balance consequence) — this is what
 * keeps the many Phase 18 test fixtures that request annual leave purely
 * as setup, in organizations that never configure a policy, unaffected.
 */
@Injectable()
export class LeaveRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly leaveBalance: LeaveBalanceService,
    private readonly leavePolicies: LeavePolicyService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    employmentId?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employmentIds = employmentId
      ? [employmentId]
      : (
          await this.prisma.employment.findMany({
            where: { organizationId },
            select: { id: true },
          })
        ).map((e) => e.id);
    return this.prisma.leaveRecord.findMany({
      where: { employmentId: { in: employmentIds } },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateLeaveRecordDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, organizationId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this organization',
      );
    const startDate = this.parseDate(dto.startDate);
    const endDate = this.parseDate(dto.endDate);
    if (endDate < startDate)
      throw new ValidationAppError('endDate cannot be before startDate');

    if (dto.leaveType === BALANCE_CONSUMING_TYPE && (await this.leavePolicies.resolve(tenantId, organizationId, startDate))) {
      const requestedDays = this.calendarDays(startDate, endDate);
      const available = await this.leaveBalance.getBalance(tenantId, dto.employmentId, startDate);
      if (new Decimal(requestedDays).gt(available)) {
        throw new ValidationAppError(`Insufficient ANNUAL leave balance: requested ${requestedDays} day(s), ${available.toFixed(2)} available as of ${dto.startDate}`);
      }
    }

    const record = await this.prisma.leaveRecord.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        createdBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'HR_LEAVE_RECORD_CREATED',
      entityType: LEAVE_TYPE,
      entityId: record.id,
      action: 'CREATE',
      userId,
    });
    return record;
  }

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ApproveLeaveRecordDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const record = await this.prisma.leaveRecord.findFirst({
      where: { id, tenantId },
      include: { employment: true },
    });
    if (!record || record.employment.organizationId !== organizationId)
      throw new NotFoundAppError('LeaveRecord', id);
    if (record.status !== 'REQUESTED')
      throw new ValidationAppError(
        `Cannot approve a leave record in status ${record.status}`,
      );
    if (record.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    return this.prisma.runInTransaction(async (tx) => {
      const policy = record.leaveType === BALANCE_CONSUMING_TYPE ? await this.leavePolicies.resolve(tenantId, organizationId, record.startDate, tx) : null;
      if (policy) {
        // Re-checked here, inside the same transaction as the consumption
        // write below — two still-pending REQUESTED records for the same
        // employment can both pass the create-time check (neither has
        // consumed the balance yet); only the FIRST one approved may
        // actually spend it.
        const requestedDays = this.calendarDays(record.startDate, record.endDate);
        const available = await this.leaveBalance.getBalance(tenantId, record.employmentId, record.startDate, tx);
        if (new Decimal(requestedDays).gt(available)) {
          throw new ValidationAppError(`Insufficient ANNUAL leave balance: requested ${requestedDays} day(s), ${available.toFixed(2)} available as of ${record.startDate.toISOString().slice(0, 10)}`);
        }
        await this.leaveBalance.recordMovement(
          tenantId,
          {
            employmentId: record.employmentId,
            movementType: 'CONSUMPTION',
            quantityDays: new Decimal(requestedDays).neg(),
            effectiveDate: record.startDate,
            sourceDocumentType: LEAVE_TYPE,
            sourceDocumentId: record.id,
            userId,
          },
          tx,
        );
      }

      const result = await tx.leaveRecord.updateMany({
        where: { id, version: dto.expectedVersion },
        data: {
          status: 'APPROVED',
          approvedBy: userId,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_LEAVE_RECORD_APPROVED',
          entityType: LEAVE_TYPE,
          entityId: id,
          action: 'UPDATE',
          userId,
        },
        tx,
      );
      return tx.leaveRecord.findFirst({ where: { id } });
    });
  }

  /** Inclusive of both endpoints — calendar days, not working days (see
   * class docstring). */
  private calendarDays(startDate: Date, endDate: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
