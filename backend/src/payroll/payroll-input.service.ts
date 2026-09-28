import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PayrollTimeInputService } from '../work-time/payroll-time-input.service';

export interface PayrollInputSummary {
  normHours: Decimal;
  normDays: Decimal;
  workedDays: Decimal;
  regularHours: Decimal;
  overtimeHours: Decimal;
  nightHours: Decimal;
  holidayHours: Decimal;
  weekendHours: Decimal;
  leaveHours: Decimal;
  businessTripHours: Decimal;
  absenceHours: Decimal;
  raw: { timeCode: string; hours: Decimal; days: Decimal }[];
}

const LEAVE_CODES = new Set(['ANNUAL_LEAVE', 'SICK_LEAVE', 'UNPAID_LEAVE']);

/**
 * PayrollInputService — the ONLY door between Payroll and Phase 18 (docx
 * spec Phase 19 sections 19-20: "Payroll raw attendance hesablamır").
 * Reads exclusively Phase 18's own APPROVED/LOCKED PayrollTimeInput rows,
 * never a Timesheet or attendance record directly.
 */
@Injectable()
export class PayrollInputService {
  constructor(private readonly workTimeInputs: PayrollTimeInputService) {}

  async getInputs(
    tenantId: string,
    employmentId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<PayrollInputSummary> {
    const rows = await this.workTimeInputs.getPayrollTimeInputs(
      tenantId,
      employmentId,
      periodStart,
      periodEnd,
    );

    const sum = (codes: string[]) =>
      rows
        .filter((r) => codes.includes(r.timeCode))
        .reduce((acc, r) => acc.plus(r.hours.toString()), new Decimal(0));
    const sumDays = (codes: string[]) =>
      rows
        .filter((r) => codes.includes(r.timeCode))
        .reduce((acc, r) => acc.plus(r.days.toString()), new Decimal(0));

    return {
      normHours: sum(['NORM_HOURS']),
      normDays: sumDays(['NORM_DAYS']),
      workedDays: sumDays(['WORKED_DAYS']),
      regularHours: sum(['REGULAR_WORK']),
      overtimeHours: sum(['OVERTIME']),
      nightHours: sum(['NIGHT_WORK']),
      holidayHours: sum(['HOLIDAY_WORK']),
      weekendHours: sum(['WEEKEND_WORK']),
      leaveHours: sum(Array.from(LEAVE_CODES)),
      businessTripHours: sum(['BUSINESS_TRIP']),
      absenceHours: sum(['ABSENCE']),
      raw: rows.map((r) => ({ timeCode: r.timeCode, hours: new Decimal(r.hours.toString()), days: new Decimal(r.days.toString()) })),
    };
  }
}
