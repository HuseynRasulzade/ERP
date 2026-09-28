import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  WORK_TIME_REGISTER,
  WorkTimeRegisterService,
} from './work-time-register.service';
import { TimeCodes } from './time-codes';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { GeneratePayrollTimeInputDto } from './dto/work-time.dto';

const PAID_TIME_CODES: string[] = [
  TimeCodes.REGULAR_WORK,
  TimeCodes.OVERTIME,
  TimeCodes.BUSINESS_TRIP,
  TimeCodes.ANNUAL_LEAVE,
  TimeCodes.SICK_LEAVE,
];
const WORKED_TIME_CODES: string[] = [
  TimeCodes.REGULAR_WORK,
  TimeCodes.OVERTIME,
];

/**
 * PayrollTimeInputService (docx spec Phase 18 sections 54-56, 132-133) —
 * the stable, money-free interface Phase 19 reads. Aggregates
 * WorkTimeRegister (never raw attendance) into PayrollTimeInput rows per
 * payroll period. Re-generating after a correction never mutates an
 * existing row in place — the old one is marked REPLACED and a new DRAFT
 * row takes over (spec section 97), unless it was already APPROVED/LOCKED
 * (payroll has already consumed it — regeneration leaves it alone and the
 * discrepancy surfaces via `validateWorkTimePeriod`, not a silent change).
 */
@Injectable()
export class PayrollTimeInputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly register: WorkTimeRegisterService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    payrollPeriodStart: string,
    payrollPeriodEnd: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.payrollTimeInput.findMany({
      where: {
        organizationId,
        payrollPeriodStart: this.parseDate(payrollPeriodStart),
        payrollPeriodEnd: this.parseDate(payrollPeriodEnd),
      },
      orderBy: [{ employmentId: 'asc' }, { timeCode: 'asc' }],
    });
  }

  async generate(
    tenantId: string,
    membershipId: string,
    dto: GeneratePayrollTimeInputDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    const periodStart = this.parseDate(dto.payrollPeriodStart);
    const periodEnd = this.parseDate(dto.payrollPeriodEnd);

    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: WORK_TIME_REGISTER,
        businessDate: { gte: periodStart, lte: periodEnd },
      },
    });

    const byEmploymentAndCode = new Map<string, Decimal>();
    const employmentIds = new Set<string>();
    for (const m of movements) {
      const dims = m.dimensions as { employmentId?: string } | null;
      const employmentId = dims?.employmentId;
      if (!employmentId || m.movementType === null) continue;
      employmentIds.add(employmentId);
      const key = `${employmentId}::${m.movementType}`;
      const resources = m.resources as { hours?: string } | null;
      const hours = new Decimal(resources?.hours ?? '0');
      byEmploymentAndCode.set(
        key,
        (byEmploymentAndCode.get(key) ?? new Decimal(0)).plus(hours),
      );
    }

    const created = [];
    for (const employmentId of employmentIds) {
      const plannedHours = await this.getPlannedHours(
        tenantId,
        employmentId,
        periodStart,
        periodEnd,
      );
      const plannedDays = await this.prisma.employeeDailyWorkPlan.count({
        where: {
          tenantId,
          employmentId,
          date: { gte: periodStart, lte: periodEnd },
          plannedHours: { gt: 0 },
        },
      });
      const workedDays = await this.prisma.timesheetLine.aggregate({
        where: {
          tenantId,
          employmentId,
          workDate: { gte: periodStart, lte: periodEnd },
        },
        _sum: { workedDayFraction: true },
      });

      const rows: { timeCode: string; hours: Decimal; days: Decimal }[] = [
        { timeCode: 'NORM_HOURS', hours: plannedHours, days: new Decimal(0) },
        {
          timeCode: 'NORM_DAYS',
          hours: new Decimal(0),
          days: new Decimal(plannedDays),
        },
        {
          timeCode: 'WORKED_DAYS',
          hours: new Decimal(0),
          days: new Decimal(
            workedDays._sum.workedDayFraction?.toString() ?? '0',
          ),
        },
      ];
      for (const [key, hours] of byEmploymentAndCode) {
        const [empId, timeCode] = key.split('::');
        if (empId !== employmentId || hours.lte(0)) continue;
        rows.push({ timeCode, hours, days: new Decimal(0) });
      }

      for (const row of rows) {
        const existing = await this.prisma.payrollTimeInput.findFirst({
          where: {
            tenantId,
            organizationId: dto.organizationId,
            employmentId,
            payrollPeriodStart: periodStart,
            payrollPeriodEnd: periodEnd,
            timeCode: row.timeCode,
            status: { in: ['DRAFT', 'VALIDATED'] },
          },
        });
        let calculationVersion = 1;
        if (existing) {
          await this.prisma.payrollTimeInput.update({
            where: { id: existing.id },
            data: { status: 'REPLACED' },
          });
          calculationVersion = existing.calculationVersion + 1;
        }
        created.push(
          await this.prisma.payrollTimeInput.create({
            data: {
              tenantId,
              organizationId: dto.organizationId,
              employmentId,
              payrollPeriodStart: periodStart,
              payrollPeriodEnd: periodEnd,
              timeCode: row.timeCode,
              hours: row.hours,
              days: row.days,
              calculationVersion,
            },
          }),
        );
      }
    }
    return created;
  }

  // -------------------------------------------------------------------
  // Internal API for Phase 19/22 (spec section 132)
  // -------------------------------------------------------------------

  async getPlannedHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Decimal> {
    const result = await this.prisma.employeeDailyWorkPlan.aggregate({
      where: { tenantId, employmentId, date: { gte: fromDate, lte: toDate } },
      _sum: { plannedHours: true },
    });
    return new Decimal(result._sum.plannedHours?.toString() ?? '0');
  }

  getWorkedHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Decimal> {
    return this.register.getHours(
      tenantId,
      employmentId,
      fromDate,
      toDate,
      WORKED_TIME_CODES,
    );
  }

  getPaidHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Decimal> {
    return this.register.getHours(
      tenantId,
      employmentId,
      fromDate,
      toDate,
      PAID_TIME_CODES,
    );
  }

  getOvertimeHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Decimal> {
    return this.register.getHours(tenantId, employmentId, fromDate, toDate, [
      TimeCodes.OVERTIME,
    ]);
  }

  getNightHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Decimal> {
    return this.register.getHours(tenantId, employmentId, fromDate, toDate, [
      TimeCodes.NIGHT_WORK,
    ]);
  }

  getHolidayHours(
    tenantId: string,
    employmentId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<Decimal> {
    return this.register.getHours(tenantId, employmentId, fromDate, toDate, [
      TimeCodes.HOLIDAY_WORK,
    ]);
  }

  async getPayrollTimeInputs(
    tenantId: string,
    employmentId: string,
    payrollPeriodStart: Date,
    payrollPeriodEnd: Date,
  ) {
    return this.prisma.payrollTimeInput.findMany({
      where: {
        tenantId,
        employmentId,
        payrollPeriodStart,
        payrollPeriodEnd,
        status: { in: ['APPROVED', 'LOCKED'] },
      },
    });
  }

  /** Blocking-issue check Phase 22's Month Close calls before finalizing
   * payroll for a period (spec section 136). */
  async validateWorkTimePeriod(
    tenantId: string,
    organizationId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const timesheets = await this.prisma.timesheet.findMany({
      where: {
        tenantId,
        organizationId,
        periodStart: { lte: periodEnd },
        periodEnd: { gte: periodStart },
      },
    });
    const issues: string[] = [];
    if (timesheets.length === 0)
      issues.push('No timesheets generated for this period');
    const notLocked = timesheets.filter((t) => t.status !== 'LOCKED');
    if (notLocked.length > 0)
      issues.push(`${notLocked.length} timesheet(s) not yet LOCKED`);

    const pendingCorrections = await this.prisma.timeCorrection.findMany({
      where: {
        tenantId,
        workDate: { gte: periodStart, lte: periodEnd },
        requiresRecalculation: true,
      },
    });
    if (pendingCorrections.length > 0)
      issues.push(
        `${pendingCorrections.length} correction(s) require recalculation`,
      );

    return { blocking: issues.length > 0, issues };
  }

  async approve(tenantId: string, id: string) {
    const row = await this.prisma.payrollTimeInput.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundAppError('PayrollTimeInput', id);
    if (!['DRAFT', 'VALIDATED'].includes(row.status))
      throw new ValidationAppError(
        `Cannot approve a payroll time input in status ${row.status}`,
      );
    return this.prisma.payrollTimeInput.update({
      where: { id },
      data: { status: 'APPROVED' },
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
