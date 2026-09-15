import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * PayrollTimeInputService (spec sections 54-56, 97). The ONLY source
 * Phase 19 Payroll may read — never raw attendance, never an unlocked
 * timesheet (spec section 56). `generate` requires the source
 * `Timesheet` to be `LOCKED`; a re-generation (after a correction +
 * reopen + relock cycle) marks the prior rows `REPLACED` and inserts a
 * new `calculationVersion` rather than deleting history (spec section 97).
 */
@Injectable()
export class PayrollTimeInputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async generate(tenantId: string, membershipId: string, organizationId: string, userId: string, timesheetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const timesheet = await this.prisma.timesheet.findFirst({ where: { id: timesheetId, tenantId, organizationId }, include: { lines: true } });
    if (!timesheet) throw new NotFoundAppError('Timesheet', timesheetId);
    if (timesheet.status !== 'LOCKED') throw new ValidationAppError('Payroll time input can only be generated from a LOCKED timesheet (spec section 56)');

    const payrollPeriod = new Date(Date.UTC(timesheet.periodStart.getUTCFullYear(), timesheet.periodStart.getUTCMonth(), 1));
    const byEmployment = new Map<string, { regular: Decimal; overtime: Decimal; businessTrip: Decimal; leave: Decimal; absence: Decimal; night: Decimal; holiday: Decimal; weekend: Decimal; workedDays: Decimal }>();
    for (const line of timesheet.lines) {
      const agg = byEmployment.get(line.employmentId) ?? { regular: new Decimal(0), overtime: new Decimal(0), businessTrip: new Decimal(0), leave: new Decimal(0), absence: new Decimal(0), night: new Decimal(0), holiday: new Decimal(0), weekend: new Decimal(0), workedDays: new Decimal(0) };
      agg.regular = agg.regular.plus(line.regularHours.toString());
      agg.overtime = agg.overtime.plus(line.overtimeHours.toString());
      agg.businessTrip = agg.businessTrip.plus(line.businessTripHours.toString());
      agg.leave = agg.leave.plus(line.leaveHours.toString());
      agg.absence = agg.absence.plus(line.absenceHours.toString());
      agg.night = agg.night.plus(line.nightHours.toString());
      agg.holiday = agg.holiday.plus(line.holidayHours.toString());
      agg.weekend = agg.weekend.plus(line.weekendHours.toString());
      if (new Decimal(line.workedDayFraction.toString()).gt(0)) agg.workedDays = agg.workedDays.plus(line.workedDayFraction.toString());
      byEmployment.set(line.employmentId, agg);
    }

    return this.prisma.runInTransaction(async (tx) => {
      const employmentIds = [...byEmployment.keys()];
      const previousVersion = await tx.payrollTimeInput.findFirst({ where: { tenantId, organizationId, employmentId: { in: employmentIds }, payrollPeriod, status: { not: 'REPLACED' } }, orderBy: { calculationVersion: 'desc' } });
      const nextVersion = (previousVersion?.calculationVersion ?? 0) + 1;
      if (previousVersion) await tx.payrollTimeInput.updateMany({ where: { tenantId, organizationId, employmentId: { in: employmentIds }, payrollPeriod, status: { not: 'REPLACED' } }, data: { status: 'REPLACED' } });

      const rows = [];
      for (const [employmentId, agg] of byEmployment) {
        const entries: { timeCode: string; premiumType: string | null; hours: Decimal; days: Decimal }[] = [
          { timeCode: 'REGULAR_WORK', premiumType: null, hours: agg.regular, days: agg.workedDays },
          { timeCode: 'OVERTIME', premiumType: null, hours: agg.overtime, days: new Decimal(0) },
          { timeCode: 'BUSINESS_TRIP', premiumType: null, hours: agg.businessTrip, days: new Decimal(0) },
          { timeCode: 'LEAVE', premiumType: null, hours: agg.leave, days: new Decimal(0) },
          { timeCode: 'ABSENCE', premiumType: null, hours: agg.absence, days: new Decimal(0) },
          { timeCode: 'PREMIUM', premiumType: 'NIGHT', hours: agg.night, days: new Decimal(0) },
          { timeCode: 'PREMIUM', premiumType: 'HOLIDAY', hours: agg.holiday, days: new Decimal(0) },
          { timeCode: 'PREMIUM', premiumType: 'WEEKEND', hours: agg.weekend, days: new Decimal(0) },
        ];
        for (const e of entries) {
          if (e.hours.lte(0) && e.days.lte(0)) continue;
          rows.push(await tx.payrollTimeInput.create({ data: { tenantId, organizationId, employmentId, payrollPeriod, timeCode: e.timeCode, premiumType: e.premiumType, hours: e.hours.toString(), days: e.days.toString(), sourceTimesheetId: timesheet.id, calculationVersion: nextVersion, status: 'DRAFT', effectiveDate: timesheet.periodStart } }));
        }
      }
      await tx.workTimePeriod.upsert({ where: { tenantId_organizationId_periodStart: { tenantId, organizationId, periodStart: payrollPeriod } }, create: { tenantId, organizationId, periodStart: payrollPeriod, periodEnd: timesheet.periodEnd, timesheetStatus: 'LOCKED', payrollInputStatus: 'DRAFT' }, update: { timesheetStatus: 'LOCKED', payrollInputStatus: 'DRAFT' } });
      await this.audit.record({ tenantId, eventType: 'WT_PAYROLL_INPUT_GENERATED', entityType: 'PAYROLL_TIME_INPUT', entityId: timesheet.id, action: 'CREATE', userId, newValues: { rowCount: rows.length, calculationVersion: nextVersion } }, tx);
      return rows;
    });
  }

  async validate(tenantId: string, membershipId: string, organizationId: string, userId: string, payrollPeriod: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = new Date(payrollPeriod);
    const result = await this.prisma.payrollTimeInput.updateMany({ where: { tenantId, organizationId, payrollPeriod: period, status: 'DRAFT' }, data: { status: 'VALIDATED' } });
    await this.audit.record({ tenantId, eventType: 'WT_PAYROLL_INPUT_VALIDATED', entityType: 'PAYROLL_TIME_INPUT', entityId: organizationId, action: 'UPDATE', userId, newValues: { payrollPeriod, count: result.count } });
    return result;
  }

  async approve(tenantId: string, membershipId: string, organizationId: string, userId: string, payrollPeriod: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = new Date(payrollPeriod);
    const result = await this.prisma.payrollTimeInput.updateMany({ where: { tenantId, organizationId, payrollPeriod: period, status: 'VALIDATED' }, data: { status: 'APPROVED' } });
    await this.audit.record({ tenantId, eventType: 'WT_PAYROLL_INPUT_APPROVED', entityType: 'PAYROLL_TIME_INPUT', entityId: organizationId, action: 'UPDATE', userId, newValues: { payrollPeriod, count: result.count } });
    return result;
  }

  async lock(tenantId: string, membershipId: string, organizationId: string, userId: string, payrollPeriod: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = new Date(payrollPeriod);
    const result = await this.prisma.payrollTimeInput.updateMany({ where: { tenantId, organizationId, payrollPeriod: period, status: 'APPROVED' }, data: { status: 'LOCKED' } });
    await this.prisma.workTimePeriod.updateMany({ where: { tenantId, organizationId, periodStart: period }, data: { payrollInputStatus: 'LOCKED', status: 'LOCKED', lockedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'WT_PAYROLL_INPUT_LOCKED', entityType: 'PAYROLL_TIME_INPUT', entityId: organizationId, action: 'UPDATE', userId, newValues: { payrollPeriod, count: result.count } });
    return result;
  }

  /** What Phase 19 Payroll actually reads — APPROVED/LOCKED only (spec
   * section 55). */
  forPayroll(tenantId: string, organizationId: string, payrollPeriod: Date) {
    return this.prisma.payrollTimeInput.findMany({ where: { tenantId, organizationId, payrollPeriod, status: { in: ['APPROVED', 'LOCKED'] } } });
  }

  list(tenantId: string, membershipId: string, organizationId: string, payrollPeriod?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.payrollTimeInput.findMany({ where: { tenantId, organizationId, payrollPeriod: payrollPeriod ? new Date(payrollPeriod) : undefined }, orderBy: { payrollPeriod: 'desc' } }));
  }
}
