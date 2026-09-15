import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const TIMESHEET_SEQUENCE = 'HR_TIMESHEET';
const SEQUENCE_PREFIX = 'TS';

/**
 * TimesheetService (spec sections 26-31, 60, 84-91). A Timesheet is a
 * PERIOD SUMMARY/CONTROL document (spec section 30), never a replacement
 * for the individual source events it combines — `generate` re-derives
 * every `TimesheetLine` from `EmployeeDailyWorkPlan` + `TimeEntry` +
 * Phase 17's own `LeaveRecord`/`AbsenceRecord`, and is safe to call again
 * on a still-open timesheet (idempotent upsert by
 * `[timesheetId, employmentId, workDate]`, spec section 102).
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async generate(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { departmentId?: string; periodStart: string; periodEnd: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);

    let timesheet = await this.prisma.timesheet.findFirst({ where: { tenantId, organizationId, departmentId: dto.departmentId ?? null, periodStart, periodEnd, status: { notIn: ['LOCKED', 'CANCELLED'] } } });
    if (timesheet && ['APPROVED'].includes(timesheet.status)) throw new ValidationAppError('Timesheet is already APPROVED — reopen it before regenerating.');

    if (!timesheet) {
      await this.ensureSequence(tenantId);
      const allocated = await this.numbering.allocateNumber(tenantId, TIMESHEET_SEQUENCE, periodStart);
      timesheet = await this.prisma.timesheet.create({ data: { tenantId, organizationId, departmentId: dto.departmentId, periodStart, periodEnd, number: allocated.formatted, status: 'GENERATED', generatedAt: new Date(), responsibleUserId: userId, createdBy: userId } });
    }

    const employments = await this.prisma.employment.findMany({ where: { tenantId, organizationId, ...(dto.departmentId ? { departmentId: dto.departmentId } : {}), employmentStatus: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'PLANNED'] } } });

    let lineCount = 0;
    for (const employment of employments) {
      for (let d = new Date(periodStart); d <= periodEnd; d = new Date(d.getTime() + 86_400_000)) {
        const line = await this.buildLine(tenantId, employment.id, d);
        if (!line) continue;
        await this.prisma.timesheetLine.upsert({
          where: { timesheetId_employmentId_workDate: { timesheetId: timesheet.id, employmentId: employment.id, workDate: d } },
          create: { tenantId, timesheetId: timesheet.id, employmentId: employment.id, workDate: d, ...line },
          update: line,
        });
        lineCount += 1;
      }
    }

    await this.prisma.timesheet.update({ where: { id: timesheet.id }, data: { status: 'GENERATED', generatedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'WT_TIMESHEET_GENERATED', entityType: 'TIMESHEET', entityId: timesheet.id, action: 'CREATE', userId, newValues: { periodStart: dto.periodStart, periodEnd: dto.periodEnd, lineCount } });
    return this.prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id }, include: { lines: true } });
  }

  private async buildLine(tenantId: string, employmentId: string, date: Date) {
    const plan = await this.prisma.employeeDailyWorkPlan.findUnique({ where: { employmentId_date: { employmentId, date } } });
    const plannedHours = plan ? new Decimal(plan.plannedHours.toString()) : new Decimal(0);

    const entries = await this.prisma.timeEntry.findMany({ where: { tenantId, employmentId, workDate: date, status: 'ACTIVE' }, include: { timeCode: true } });
    const sumFor = (code: string) => entries.filter((e) => e.timeCode.code === code).reduce((s, e) => s.plus(e.hours.toString()), new Decimal(0));
    const regularHours = sumFor('REGULAR_WORK');
    const overtimeHours = sumFor('OVERTIME');
    const businessTripHours = sumFor('BUSINESS_TRIP');
    const nightHours = entries.reduce((s, e) => s.plus(e.nightHours.toString()), new Decimal(0));
    const holidayHours = entries.reduce((s, e) => s.plus(e.holidayHours.toString()), new Decimal(0));
    const weekendHours = entries.reduce((s, e) => s.plus(e.weekendHours.toString()), new Decimal(0));

    const leave = await this.prisma.leaveRecord.findFirst({ where: { tenantId, employmentId, status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date } } });
    const leaveHours = leave && plannedHours.gt(0) ? plannedHours : new Decimal(0); // spec section 32-33: derived from plan, none on a non-workday
    const worked = regularHours.plus(overtimeHours);

    const absence = await this.prisma.absenceRecord.findFirst({ where: { tenantId, employmentId, startDate: { lte: date }, endDate: { gte: date }, status: { not: 'REJECTED' } } });
    const absenceHours = absence ? Decimal.max(plannedHours.minus(worked).minus(leaveHours), 0) : new Decimal(0); // spec section 35: partial-absence formula

    const paidHours = worked.plus(businessTripHours).plus(leave?.leaveType !== 'UNPAID' ? leaveHours : new Decimal(0));
    const unpaidHours = leave?.leaveType === 'UNPAID' ? leaveHours.plus(absenceHours) : absenceHours;
    const totalAccounted = worked.plus(leaveHours).plus(absenceHours).plus(businessTripHours);
    const workedDayFraction = plannedHours.gt(0) ? Decimal.min(worked.dividedBy(plannedHours), 1) : worked.gt(0) ? new Decimal(1) : new Decimal(0);

    const hasException = await this.prisma.attendanceInterval.findFirst({ where: { tenantId, employmentId, workDate: date, status: { in: ['MISSING_CLOCK_OUT', 'DUPLICATE'] } } });
    const validationStatus = hasException ? 'EXCEPTION' : plannedHours.gt(0) && totalAccounted.minus(plannedHours).abs().gt('0.1') ? 'UNEXPLAINED_DIFFERENCE' : 'OK'; // spec section 31

    const timeCodeSummary = entries.map((e) => `${e.timeCode.code}:${e.hours.toString()}`).join(', ') || null;

    return {
      departmentId: (await this.prisma.employeeAssignment.findFirst({ where: { tenantId, employmentId, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' } }))?.departmentId ?? null,
      plannedHours: plannedHours.toString(),
      regularHours: regularHours.toString(),
      overtimeHours: overtimeHours.toString(),
      nightHours: nightHours.toString(),
      holidayHours: holidayHours.toString(),
      weekendHours: weekendHours.toString(),
      leaveHours: leaveHours.toString(),
      absenceHours: absenceHours.toString(),
      businessTripHours: businessTripHours.toString(),
      paidHours: paidHours.toString(),
      unpaidHours: unpaidHours.toString(),
      workedDayFraction: workedDayFraction.toString(),
      timeCodeSummary,
      validationStatus,
    };
  }

  async submit(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.prisma.timesheet.findFirst({ where: { id, tenantId, organizationId } });
    if (!timesheet) throw new NotFoundAppError('Timesheet', id);
    if (!['GENERATED', 'IN_PROGRESS'].includes(timesheet.status)) throw new ValidationAppError(`Cannot submit from status ${timesheet.status}`);
    const row = await this.prisma.timesheet.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'WT_TIMESHEET_SUBMITTED', entityType: 'TIMESHEET', entityId: id, action: 'UPDATE', userId, newValues: {} });
    return row;
  }

  /** Blocked while any line has an unresolved EXCEPTION (spec section 84
   * — "no missing punches requiring review"). UNEXPLAINED_DIFFERENCE
   * lines are a warning, not a block, in this build. */
  async approve(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.prisma.timesheet.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
    if (!timesheet) throw new NotFoundAppError('Timesheet', id);
    if (timesheet.status !== 'PENDING_APPROVAL') throw new ValidationAppError(`Cannot approve from status ${timesheet.status}`);
    const exceptions = timesheet.lines.filter((l) => l.validationStatus === 'EXCEPTION');
    if (exceptions.length > 0) throw new ValidationAppError(`Cannot approve — ${exceptions.length} line(s) have unresolved attendance exceptions.`);

    const row = await this.prisma.timesheet.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'WT_TIMESHEET_APPROVED', entityType: 'TIMESHEET', entityId: id, action: 'UPDATE', userId, newValues: {} });
    return row;
  }

  async lock(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.prisma.timesheet.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
    if (!timesheet) throw new NotFoundAppError('Timesheet', id);
    if (timesheet.status !== 'APPROVED') throw new ValidationAppError(`Cannot lock from status ${timesheet.status}`);

    return this.prisma.runInTransaction(async (tx) => {
      const employmentIds = [...new Set(timesheet.lines.map((l) => l.employmentId))];
      await tx.employeeDailyWorkPlan.updateMany({ where: { tenantId, employmentId: { in: employmentIds }, date: { gte: timesheet.periodStart, lte: timesheet.periodEnd } }, data: { generationStatus: 'LOCKED' } });
      const row = await tx.timesheet.update({ where: { id }, data: { status: 'LOCKED', lockedAt: new Date() } });
      await this.audit.record({ tenantId, eventType: 'WT_TIMESHEET_LOCKED', entityType: 'TIMESHEET', entityId: id, action: 'UPDATE', userId, newValues: {} }, tx);
      return row;
    });
  }

  /** Requires a mandatory reason (spec section 60). Downstream
   * PayrollTimeInput rows sourced from this timesheet are marked
   * REPLACED rather than deleted (spec section 97) — see
   * `PayrollTimeInputService.reopen`. */
  async reopen(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, reason: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!reason) throw new ValidationAppError('A reason is required to reopen a locked timesheet (spec section 60)');
    const timesheet = await this.prisma.timesheet.findFirst({ where: { id, tenantId, organizationId } });
    if (!timesheet) throw new NotFoundAppError('Timesheet', id);
    if (timesheet.status !== 'LOCKED') throw new ValidationAppError(`Cannot reopen from status ${timesheet.status}`);

    return this.prisma.runInTransaction(async (tx) => {
      const lines = await tx.timesheetLine.findMany({ where: { timesheetId: id } });
      const employmentIds = [...new Set(lines.map((l) => l.employmentId))];
      await tx.employeeDailyWorkPlan.updateMany({ where: { tenantId, employmentId: { in: employmentIds }, date: { gte: timesheet.periodStart, lte: timesheet.periodEnd } }, data: { generationStatus: 'GENERATED' } });
      const row = await tx.timesheet.update({ where: { id }, data: { status: 'REOPENED', reopenedAt: new Date(), reopenReason: reason } });
      await this.audit.record({ tenantId, eventType: 'WT_TIMESHEET_REOPENED', entityType: 'TIMESHEET', entityId: id, action: 'UPDATE', userId, newValues: { reason } }, tx);
      return row;
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.timesheet.findFirst({ where: { id, tenantId, organizationId }, include: { lines: { include: { employment: { include: { employee: { include: { physicalPerson: true } } } } } } } });
    if (!row) throw new NotFoundAppError('Timesheet', id);
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.timesheet.findMany({ where: { tenantId, organizationId }, orderBy: { periodStart: 'desc' } }));
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: TIMESHEET_SEQUENCE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: TIMESHEET_SEQUENCE, documentType: TIMESHEET_SEQUENCE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
