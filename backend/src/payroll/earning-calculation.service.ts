import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CompensationSegment } from './compensation.service';
import { PayrollInputSummary } from './payroll-input.service';
import { EarningCodes } from './payroll-codes';
import {
  AZ_HOLIDAY_PREMIUM_STATUTORY_MULTIPLIER,
  AZ_NIGHT_PREMIUM_STATUTORY_RATE,
  AZ_OVERTIME_STATUTORY_MULTIPLIER,
} from './az-payroll-localization.data';
import { ResultLineDraft } from './payroll-result-line.types';

const STANDARD_DAILY_HOURS = 8;

/**
 * EarningCalculationService (docx spec Phase 19 sections 21-30) — monthly
 * salary proration, and overtime/night/holiday monetary premiums.
 *
 * Design decisions, disclosed:
 *  - Holiday/weekend hours worked are compensated ENTIRELY through their
 *    own HOLIDAY_PREMIUM/WEEKEND_PREMIUM earning (hours x tariff x
 *    statutory multiplier) and are EXCLUDED from the base-salary norm-
 *    completion ratio, so a monthly-salary employee is never paid twice
 *    for the same hour (once via a fixed month salary that doesn't change,
 *    once via a full-value premium).
 *  - Night hours are a pure ADD-ON premium on top of hours already paid
 *    via base/overtime pay (they overlap with an ordinary scheduled shift,
 *    spec sections 46-48's "no double counting" rule), so they are NOT
 *    excluded from the base-salary ratio.
 *  - Overtime/night/holiday tariffs use the compensation rate in effect at
 *    the period's LAST segment — Phase 18 does not sub-divide these
 *    premium-hour measures by compensation-change boundary, only base
 *    salary is period-segmented (disclosed simplification).
 *  - The statutory overtime multiplier / night premium rate / holiday
 *    multiplier are read from az-payroll-localization.data.ts (config,
 *    not hardcoded in this file's logic) via
 *    `resolveOvertimeMultiplier()` etc. — a per-contract override is a
 *    natural extension point (e.g. a PayrollVariableInput) not wired in
 *    yet (disclosed simplification: only the statutory floor is applied).
 */
@Injectable()
export class EarningCalculationService {
  calculateBaseSalary(segments: CompensationSegment[], input: PayrollInputSummary): ResultLineDraft[] {
    if (segments.length === 0 || input.normHours.lte(0)) return [];

    const totalCalendarDays = segments.reduce(
      (sum, s) => sum + this.daysBetween(s.from, s.to),
      0,
    );
    if (totalCalendarDays === 0) return [];

    const eligibleHours = input.regularHours
      .minus(input.holidayHours)
      .minus(input.weekendHours)
      .plus(input.leaveHours)
      .plus(input.businessTripHours);

    const lines: ResultLineDraft[] = [];
    for (const segment of segments) {
      const segmentDays = this.daysBetween(segment.from, segment.to);
      const weight = new Decimal(segmentDays).div(totalCalendarDays);
      const segmentNormHours = input.normHours.times(weight);
      const segmentEligibleHours = eligibleHours.times(weight);
      const ratio = segmentNormHours.gt(0)
        ? Decimal.min(1, segmentEligibleHours.div(segmentNormHours))
        : new Decimal(0);

      let amount = new Decimal(0);
      let baseAmount: Decimal | undefined;
      if (segment.assignment.payBasis === 'MONTHLY_SALARY' && segment.assignment.baseSalary) {
        baseAmount = new Decimal(segment.assignment.baseSalary.toString());
        amount = baseAmount.times(ratio);
      } else if (segment.assignment.payBasis === 'HOURLY' && segment.assignment.hourlyRate) {
        baseAmount = new Decimal(segment.assignment.hourlyRate.toString());
        amount = baseAmount.times(segmentEligibleHours);
      } else if (segment.assignment.payBasis === 'DAILY' && segment.assignment.dailyRate) {
        baseAmount = new Decimal(segment.assignment.dailyRate.toString());
        amount = baseAmount.times(input.workedDays.times(weight));
      }

      lines.push({
        calculationCode: EarningCodes.BASE_SALARY,
        lineType: 'EARNING',
        quantity: segmentEligibleHours,
        baseAmount,
        rate: ratio,
        amount: this.round(amount),
        sourceInput: 'PayrollTimeInput',
        explanation: `${segment.assignment.payBasis} basis, ${segment.from.toISOString().slice(0, 10)}..${segment.to.toISOString().slice(0, 10)}, norm ratio ${ratio.toFixed(4)}`,
      });
    }
    return lines;
  }

  calculateOvertimePay(segments: CompensationSegment[], input: PayrollInputSummary): ResultLineDraft | null {
    if (input.overtimeHours.lte(0) || segments.length === 0) return null;
    const tariff = this.resolveHourlyTariff(segments[segments.length - 1], input.normHours);
    const multiplier = this.resolveOvertimeMultiplier();
    const amount = input.overtimeHours.times(tariff).times(multiplier);
    return {
      calculationCode: EarningCodes.OVERTIME_PAY,
      lineType: 'EARNING',
      quantity: input.overtimeHours,
      rate: tariff,
      multiplier,
      amount: this.round(amount),
      sourceInput: 'PayrollTimeInput',
      sourceRule: 'AZ_OVERTIME_MIN_RATE',
      explanation: `${input.overtimeHours}h x ${tariff.toFixed(4)} tariff x ${multiplier} multiplier`,
    };
  }

  calculateNightPremium(segments: CompensationSegment[], input: PayrollInputSummary): ResultLineDraft | null {
    if (input.nightHours.lte(0) || segments.length === 0) return null;
    const tariff = this.resolveHourlyTariff(segments[segments.length - 1], input.normHours);
    const rate = this.resolveNightPremiumRate();
    const amount = input.nightHours.times(tariff).times(rate);
    return {
      calculationCode: EarningCodes.NIGHT_PREMIUM,
      lineType: 'EARNING',
      quantity: input.nightHours,
      rate: tariff,
      multiplier: rate,
      amount: this.round(amount),
      sourceInput: 'PayrollTimeInput',
      sourceRule: 'AZ_NIGHT_PREMIUM_MIN_RATE',
      explanation: `${input.nightHours}h night premium x ${tariff.toFixed(4)} tariff x ${rate} rate (add-on)`,
    };
  }

  calculateHolidayPremium(segments: CompensationSegment[], input: PayrollInputSummary): ResultLineDraft[] {
    if (segments.length === 0) return [];
    const tariff = this.resolveHourlyTariff(segments[segments.length - 1], input.normHours);
    const multiplier = this.resolveHolidayMultiplier();
    const lines: ResultLineDraft[] = [];
    if (input.holidayHours.gt(0)) {
      lines.push({
        calculationCode: EarningCodes.HOLIDAY_PREMIUM,
        lineType: 'EARNING',
        quantity: input.holidayHours,
        rate: tariff,
        multiplier,
        amount: this.round(input.holidayHours.times(tariff).times(multiplier)),
        sourceInput: 'PayrollTimeInput',
        sourceRule: 'AZ_HOLIDAY_REST_DAY_PAY',
        explanation: `${input.holidayHours}h holiday work x ${tariff.toFixed(4)} tariff x ${multiplier} multiplier`,
      });
    }
    if (input.weekendHours.gt(0)) {
      lines.push({
        calculationCode: EarningCodes.WEEKEND_PREMIUM,
        lineType: 'EARNING',
        quantity: input.weekendHours,
        rate: tariff,
        multiplier,
        amount: this.round(input.weekendHours.times(tariff).times(multiplier)),
        sourceInput: 'PayrollTimeInput',
        sourceRule: 'AZ_HOLIDAY_REST_DAY_PAY',
        explanation: `${input.weekendHours}h weekend work x ${tariff.toFixed(4)} tariff x ${multiplier} multiplier`,
      });
    }
    return lines;
  }

  resolveHourlyTariff(segment: CompensationSegment, normHours: Decimal): Decimal {
    const a = segment.assignment;
    if (a.payBasis === 'HOURLY' && a.hourlyRate) return new Decimal(a.hourlyRate.toString());
    if (a.payBasis === 'MONTHLY_SALARY' && a.baseSalary && normHours.gt(0))
      return new Decimal(a.baseSalary.toString()).div(normHours);
    if (a.payBasis === 'DAILY' && a.dailyRate)
      return new Decimal(a.dailyRate.toString()).div(STANDARD_DAILY_HOURS);
    return new Decimal(0);
  }

  /** max(statutory_minimum, contract_multiplier) resolution (spec section
   * 27) — only the statutory floor is wired in (disclosed simplification). */
  resolveOvertimeMultiplier(): Decimal {
    return new Decimal(AZ_OVERTIME_STATUTORY_MULTIPLIER);
  }

  resolveNightPremiumRate(): Decimal {
    return new Decimal(AZ_NIGHT_PREMIUM_STATUTORY_RATE);
  }

  resolveHolidayMultiplier(): Decimal {
    return new Decimal(AZ_HOLIDAY_PREMIUM_STATUTORY_MULTIPLIER);
  }

  private daysBetween(from: Date, to: Date): number {
    return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  }

  private round(amount: Decimal): Decimal {
    return amount.toDecimalPlaces(2);
  }
}
