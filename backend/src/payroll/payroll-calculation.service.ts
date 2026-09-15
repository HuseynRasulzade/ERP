import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError, NotFoundAppError } from '../common/errors/app-error';
import { PayrollTimeInputService } from '../work-time/payroll-time-input.service';
import { DailyWorkPlanService } from '../work-time/daily-work-plan.service';
import { PayrollRateBracketService } from './payroll-rate-bracket.service';
import { PayrollDefinitionsService } from './payroll-definitions.service';
import { EmployeeCompensationService } from './employee-compensation.service';
import { EmployeeTaxProfileService } from './employee-tax-profile.service';
import { PayrollVariableInputService } from './payroll-variable-input.service';
import { PayrollExecutionOrderService } from './payroll-execution-order.service';
import { AverageEarningsService } from './average-earnings.service';
import { PayrollPeriodService } from './payroll-period.service';

interface EarningLine { code: string; quantity?: Decimal; rate?: Decimal; baseAmount?: Decimal; multiplier?: Decimal; amount: Decimal; taxable: boolean; socialBase: boolean; unemploymentBase: boolean; medicalBase: boolean; sourceInput?: string; sourceRule?: string; explanation: string }
interface DeductionLine { code: string; baseAmount?: Decimal; rate?: Decimal; amount: Decimal; sourceRule?: string; explanation: string }

/**
 * PayrollCalculationService — the gross-to-net engine (spec sections
 * 17-27, 35, 47, 54, 59-62, 91-92). Never reads raw attendance (spec
 * section 20) — the ONLY Phase 18 input is
 * `PayrollTimeInputService.forPayroll` (APPROVED/LOCKED rows). Every
 * rate/divisor/multiplier is resolved through `PayrollRateBracketService`
 * — nothing here is a hardcoded law. A prior result for the same
 * employment+period is never deleted on recalculation — it's marked
 * SUPERSEDED and the new row's `supersedesResultId` links back (spec
 * section 91).
 */
@Injectable()
export class PayrollCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly timeInputs: PayrollTimeInputService,
    private readonly dailyPlans: DailyWorkPlanService,
    private readonly brackets: PayrollRateBracketService,
    private readonly definitions: PayrollDefinitionsService,
    private readonly compensation: EmployeeCompensationService,
    private readonly taxProfiles: EmployeeTaxProfileService,
    private readonly variableInputs: PayrollVariableInputService,
    private readonly executionOrders: PayrollExecutionOrderService,
    private readonly averageEarnings: AverageEarningsService,
    private readonly periods: PayrollPeriodService,
  ) {}

  /** Payroll Eligibility (spec section 8) — active, hired mid-period,
   * terminated mid-period, on leave, or suspended-with-payable-entitlement
   * employments whose own window overlaps the payroll period at all. */
  private async eligibleEmployments(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    return this.prisma.employment.findMany({ where: { tenantId, organizationId, employmentStatus: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] }, employmentStartDate: { lte: periodEnd }, OR: [{ employmentEndDate: null }, { employmentEndDate: { gte: periodStart } }] } });
  }

  async calculate(tenantId: string, membershipId: string, organizationId: string, userId: string, payrollPeriodId: string, runType: 'PREVIEW' | 'REGULAR' | 'RECALCULATION' | 'RETROACTIVE' | 'TERMINATION' | 'OFF_CYCLE' | 'FINAL' = 'REGULAR', regime = 'AZ_NON_OIL_PRIVATE_2026') {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.periods.getOrThrow(tenantId, payrollPeriodId);
    const employments = await this.eligibleEmployments(tenantId, organizationId, period.periodStart, period.periodEnd);

    const priorRuns = await this.prisma.payrollCalculationRun.count({ where: { tenantId, payrollPeriodId, runType } });
    const run = await this.prisma.payrollCalculationRun.create({ data: { tenantId, organizationId, payrollPeriodId, runType, version: priorRuns + 1, status: 'CALCULATING', initiatedBy: userId } });

    let processed = 0;
    let failed = 0;
    let totalGross = new Decimal(0);
    let totalNet = new Decimal(0);
    let totalTaxes = new Decimal(0);
    let totalEmployerCost = new Decimal(0);

    for (const employment of employments) {
      try {
        const result = await this.calculateEmployment(tenantId, employment, period, run.id, regime, userId);
        processed += 1;
        totalGross = totalGross.plus(result.gross.toString());
        totalNet = totalNet.plus(result.net.toString());
        totalTaxes = totalTaxes.plus(result.employeeDeductions.toString());
        totalEmployerCost = totalEmployerCost.plus(result.employerTotalCost.toString());
      } catch (err) {
        failed += 1;
        await this.prisma.payrollCalculationError.create({ data: { tenantId, calculationRunId: run.id, employmentId: employment.id, errorCode: this.classifyError(err), message: err instanceof Error ? err.message : String(err), severity: 'ERROR', blocking: true } });
      }
    }

    const updatedRun = await this.prisma.payrollCalculationRun.update({ where: { id: run.id }, data: { status: processed > 0 ? 'CALCULATED' : 'ERROR', completedAt: new Date(), employeesProcessed: processed, employeesFailed: failed, totalGross: totalGross.toString(), totalNet: totalNet.toString(), totalTaxes: totalTaxes.toString(), totalEmployerCost: totalEmployerCost.toString() } });
    if (runType !== 'PREVIEW') await this.prisma.payrollPeriod.update({ where: { id: payrollPeriodId }, data: { status: 'CALCULATED', calculatedAt: new Date(), calculationVersion: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_CALCULATED', entityType: 'PAYROLL_CALCULATION_RUN', entityId: run.id, action: 'CREATE', userId, newValues: { processed, failed, totalGross: totalGross.toString(), totalNet: totalNet.toString() } });
    return updatedRun;
  }

  private classifyError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('compensation')) return 'MISSING_COMPENSATION';
    if (message.includes('time input')) return 'MISSING_TIME_INPUT';
    if (message.includes('tax profile')) return 'MISSING_TAX_PROFILE';
    if (message.includes('rate bracket') || message.includes('legal rule')) return 'MISSING_LEGAL_RULE';
    if (message.includes('Negative net')) return 'NEGATIVE_NET_PAY';
    return 'OTHER';
  }

  private async calculateEmployment(tenantId: string, employment: { id: string; organizationId: string; employmentStartDate: Date; employmentEndDate: Date | null; currencyId?: string }, period: { id: string; periodStart: Date; periodEnd: Date; year: number; month: number }, runId: string, regime: string, userId: string) {
    const compensationSegments = await this.compensation.getOverlapping(tenantId, employment.id, period.periodStart, period.periodEnd);
    if (compensationSegments.length === 0) throw new ValidationAppError('No compensation assignment covers this payroll period (missing compensation)');

    const taxProfile = await this.taxProfiles.getAsOf(tenantId, employment.id, period.periodEnd);
    if (!taxProfile) throw new ValidationAppError('No effective tax profile for this employment (missing tax profile)');

    const inputRows = await this.timeInputs.forPayroll(tenantId, employment.organizationId, period.periodStart);
    const sum = (timeCode: string, premiumType?: string, field: 'hours' | 'days' = 'hours') => inputRows.filter((r) => r.timeCode === timeCode && (premiumType === undefined || r.premiumType === premiumType)).reduce((s, r) => s.plus(r[field].toString()), new Decimal(0));
    const regularHours = sum('REGULAR_WORK');
    const regularDays = sum('REGULAR_WORK', undefined, 'days');
    const overtimeHours = sum('OVERTIME');
    const nightHours = sum('PREMIUM', 'NIGHT');
    const holidayHours = sum('PREMIUM', 'HOLIDAY');
    const weekendHours = sum('PREMIUM', 'WEEKEND');
    const leaveHours = sum('LEAVE');
    const businessTripHours = sum('BUSINESS_TRIP');

    const { plannedHours, plannedDays } = await this.dailyPlans.monthlyNorm(tenantId, employment.id, period.periodStart);
    const normHours = new Decimal(plannedHours);
    const accountedHours = regularHours.plus(leaveHours).plus(businessTripHours);
    const eligibilityRatio = normHours.gt(0) ? Decimal.min(accountedHours.dividedBy(normHours), 1) : accountedHours.gt(0) ? new Decimal(1) : new Decimal(0);

    const earningLines: EarningLine[] = [];
    let hourlyRateForPremiums = new Decimal(0);

    for (const segment of compensationSegments) {
      const segStart = segment.effectiveFrom > period.periodStart ? segment.effectiveFrom : period.periodStart;
      const segEnd = segment.effectiveTo && segment.effectiveTo < period.periodEnd ? segment.effectiveTo : period.periodEnd;
      const segDays = Math.floor((segEnd.getTime() - segStart.getTime()) / 86_400_000) + 1;
      const totalPeriodDays = Math.floor((period.periodEnd.getTime() - period.periodStart.getTime()) / 86_400_000) + 1;
      const segShare = new Decimal(segDays).dividedBy(totalPeriodDays);

      if (segment.payBasis === 'MONTHLY_SALARY' && segment.baseSalary) {
        const segBase = new Decimal(segment.baseSalary.toString());
        const amount = segBase.mul(segShare).mul(eligibilityRatio).toDecimalPlaces(2);
        earningLines.push({ code: 'BASE_SALARY', baseAmount: segBase, quantity: new Decimal(segShare.toDecimalPlaces(4)), amount, taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, explanation: `${segBase.toString()} × ${segShare.toDecimalPlaces(4).toString()} (period share) × ${eligibilityRatio.toDecimalPlaces(4).toString()} (eligibility ratio) = ${amount.toString()}` });
        if (normHours.gt(0)) hourlyRateForPremiums = segBase.dividedBy(normHours);
      } else if (segment.payBasis === 'HOURLY' && segment.hourlyRate) {
        const rate = new Decimal(segment.hourlyRate.toString());
        const amount = rate.mul(regularHours).toDecimalPlaces(2);
        earningLines.push({ code: 'HOURLY_PAY', rate, quantity: regularHours, amount, taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, explanation: `${regularHours.toString()}h × ${rate.toString()} = ${amount.toString()}` });
        hourlyRateForPremiums = rate;
      } else if (segment.payBasis === 'DAILY' && segment.dailyRate) {
        const rate = new Decimal(segment.dailyRate.toString());
        const amount = rate.mul(regularDays).toDecimalPlaces(2);
        earningLines.push({ code: 'DAILY_PAY', rate, quantity: regularDays, amount, taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, explanation: `${regularDays.toString()} days × ${rate.toString()} = ${amount.toString()}` });
      }
    }

    if (overtimeHours.gt(0) && hourlyRateForPremiums.gt(0)) {
      const overtimeDef = await this.definitions.earning(tenantId, 'OVERTIME_PAY');
      const statutoryMultiplier = (await this.brackets.resolveFlat(tenantId, 'OVERTIME_MULTIPLIER', regime, period.periodEnd)) ?? new Decimal(1);
      const contractMultiplier = overtimeDef?.defaultMultiplier ? new Decimal(overtimeDef.defaultMultiplier.toString()) : new Decimal(0);
      const multiplier = Decimal.max(statutoryMultiplier, contractMultiplier);
      const amount = overtimeHours.mul(hourlyRateForPremiums).mul(multiplier).toDecimalPlaces(2);
      earningLines.push({ code: 'OVERTIME_PAY', rate: hourlyRateForPremiums, quantity: overtimeHours, multiplier, amount, taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, sourceRule: 'OVERTIME_MULTIPLIER bracket (Labor Code Art. 165)', explanation: `${overtimeHours.toString()}h × ${hourlyRateForPremiums.toDecimalPlaces(4).toString()} × ${multiplier.toString()} (max of statutory/contract multiplier) = ${amount.toString()}` });
    }
    if (nightHours.gt(0) && hourlyRateForPremiums.gt(0)) {
      const rate = await this.brackets.resolveFlat(tenantId, 'NIGHT_PREMIUM', regime, period.periodEnd);
      if (rate) {
        const amount = nightHours.mul(hourlyRateForPremiums).mul(rate).toDecimalPlaces(2);
        earningLines.push({ code: 'NIGHT_PREMIUM', rate: hourlyRateForPremiums, quantity: nightHours, multiplier: rate, amount, taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, sourceRule: 'NIGHT_PREMIUM bracket (Labor Code Art. 166)', explanation: `${nightHours.toString()}h × ${hourlyRateForPremiums.toDecimalPlaces(4).toString()} × ${rate.toString()} = ${amount.toString()}` });
      }
    }
    if (holidayHours.plus(weekendHours).gt(0) && hourlyRateForPremiums.gt(0)) {
      const rate = await this.brackets.resolveFlat(tenantId, 'HOLIDAY_PREMIUM', regime, period.periodEnd);
      if (rate) {
        const hours = holidayHours.plus(weekendHours);
        const amount = hours.mul(hourlyRateForPremiums).mul(rate).toDecimalPlaces(2);
        earningLines.push({ code: 'HOLIDAY_PREMIUM', rate: hourlyRateForPremiums, quantity: hours, multiplier: rate, amount, taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, sourceRule: 'HOLIDAY_PREMIUM bracket (Labor Code Art. 164)', explanation: `${hours.toString()}h × ${hourlyRateForPremiums.toDecimalPlaces(4).toString()} × ${rate.toString()} = ${amount.toString()}` });
      }
    }
    if (leaveHours.gt(0)) {
      const leaveDays = leaveHours.dividedBy(8); // 8h/day approximation — disclosed simplification, see docs/PAYROLL.md
      const avg = await this.averageEarnings.calculate(tenantId, employment.id, 'LEAVE_PAY', period.periodStart, leaveDays, regime, 'PAYROLL_PERIOD', period.id);
      earningLines.push({ code: 'LEAVE_PAY', quantity: leaveDays, rate: new Decimal(avg.averageDaily.toString()), amount: new Decimal(avg.resultAmount.toString()), taxable: true, socialBase: true, unemploymentBase: true, medicalBase: true, sourceRule: 'Labor Code Art. 140 average-pay leave formula', explanation: `${leaveDays.toString()} days × ${avg.averageDaily.toString()} (12-month average daily pay) = ${avg.resultAmount.toString()}` });
    }

    const variableInputs = await this.variableInputs.forPeriod(tenantId, employment.id, period.periodStart);
    for (const input of variableInputs) {
      const def = await this.definitions.earning(tenantId, input.earningCode);
      let amount = new Decimal(0);
      if (input.amount != null) amount = new Decimal(input.amount.toString());
      else if (input.percentage != null) {
        const base = earningLines.find((l) => l.code === 'BASE_SALARY')?.baseAmount ?? new Decimal(0);
        amount = base.mul(input.percentage.toString());
      }
      if (amount.eq(0)) continue;
      earningLines.push({ code: input.earningCode, amount: amount.toDecimalPlaces(2), taxable: def?.taxableIncome ?? true, socialBase: def?.socialInsuranceBase ?? true, unemploymentBase: def?.unemploymentBase ?? true, medicalBase: def?.medicalInsuranceBase ?? true, sourceInput: `PayrollVariableInput:${input.id}`, explanation: `Variable input ${input.earningCode} = ${amount.toDecimalPlaces(2).toString()}` });
    }

    const gross = earningLines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const taxableIncome = earningLines.filter((l) => l.taxable).reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const socialBase = earningLines.filter((l) => l.socialBase).reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const unemploymentBase = earningLines.filter((l) => l.unemploymentBase).reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const medicalBase = earningLines.filter((l) => l.medicalBase).reduce((s, l) => s.plus(l.amount), new Decimal(0));

    const exemption = new Decimal(taxProfile.exemptionAmount.toString());
    const taxableAfterExemption = Decimal.max(taxableIncome.minus(exemption), 0);
    const incomeTaxResult = await this.brackets.applyProgressive(tenantId, 'INCOME_TAX', regime, period.periodEnd, taxableAfterExemption);
    const employeeSocialResult = await this.brackets.applyProgressive(tenantId, 'SOCIAL_INSURANCE', regime, period.periodEnd, socialBase, 'EMPLOYEE');
    const employeeUnemploymentResult = await this.brackets.applyProgressive(tenantId, 'UNEMPLOYMENT_INSURANCE', regime, period.periodEnd, unemploymentBase, 'EMPLOYEE');
    const employeeMedicalResult = await this.brackets.applyProgressive(tenantId, 'MEDICAL_INSURANCE', regime, period.periodEnd, medicalBase, 'EMPLOYEE').catch(() => ({ amount: new Decimal(0), trace: 'not configured', legalReference: null }));

    const employerSocialResult = await this.brackets.applyProgressive(tenantId, 'SOCIAL_INSURANCE', regime, period.periodEnd, socialBase, 'EMPLOYER');
    const employerUnemploymentResult = await this.brackets.applyProgressive(tenantId, 'UNEMPLOYMENT_INSURANCE', regime, period.periodEnd, unemploymentBase, 'EMPLOYER');
    const employerMedicalResult = await this.brackets.applyProgressive(tenantId, 'MEDICAL_INSURANCE', regime, period.periodEnd, medicalBase, 'EMPLOYER').catch(() => ({ amount: new Decimal(0), trace: 'not configured', legalReference: null }));

    const deductionLines: DeductionLine[] = [
      { code: 'INCOME_TAX', baseAmount: taxableAfterExemption, amount: incomeTaxResult.amount.toDecimalPlaces(2), sourceRule: incomeTaxResult.legalReference ?? undefined, explanation: incomeTaxResult.trace },
      { code: 'EMPLOYEE_SOCIAL_INSURANCE', baseAmount: socialBase, amount: employeeSocialResult.amount.toDecimalPlaces(2), sourceRule: employeeSocialResult.legalReference ?? undefined, explanation: employeeSocialResult.trace },
      { code: 'EMPLOYEE_UNEMPLOYMENT_INSURANCE', baseAmount: unemploymentBase, amount: employeeUnemploymentResult.amount.toDecimalPlaces(2), sourceRule: employeeUnemploymentResult.legalReference ?? undefined, explanation: employeeUnemploymentResult.trace },
      { code: 'EMPLOYEE_MEDICAL_INSURANCE', baseAmount: medicalBase, amount: employeeMedicalResult.amount.toDecimalPlaces(2), explanation: employeeMedicalResult.trace },
    ].filter((l) => l.amount.gt(0));

    const netBeforePostTax = gross.minus(deductionLines.reduce((s, l) => s.plus(l.amount), new Decimal(0)));

    const orders = await this.executionOrders.activeFor(tenantId, employment.id, period.periodEnd);
    const deductionCap = await this.brackets.resolveFlat(tenantId, 'DEDUCTION_CAP', regime, period.periodEnd);
    let remainingCap = deductionCap ? netBeforePostTax.mul(deductionCap) : null;
    let netAfterOrders = netBeforePostTax;
    for (const order of orders) {
      let amount = order.calculationMethod === 'FIXED' ? new Decimal(order.fixedAmount?.toString() ?? 0) : netBeforePostTax.mul(order.percentage?.toString() ?? 0);
      if (order.capAmount) amount = Decimal.min(amount, new Decimal(order.capAmount.toString()));
      if (order.protectedMinimum) amount = Decimal.min(amount, Decimal.max(netAfterOrders.minus(order.protectedMinimum.toString()), 0));
      if (remainingCap != null) {
        if (amount.gt(remainingCap)) {
          await this.executionOrders.recordCarryForward(tenantId, employment.id, order.orderType, order.id, period.periodStart, amount.minus(remainingCap));
          amount = remainingCap;
        }
        remainingCap = remainingCap.minus(amount);
      }
      if (amount.gt(0)) {
        deductionLines.push({ code: order.orderType, amount: amount.toDecimalPlaces(2), sourceRule: `PayrollExecutionOrder:${order.id}`, explanation: `${order.calculationMethod} deduction for ${order.creditor} = ${amount.toDecimalPlaces(2).toString()}` });
        netAfterOrders = netAfterOrders.minus(amount);
      }
    }

    const net = netAfterOrders.toDecimalPlaces(2);
    const employeeDeductions = deductionLines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const employerContributions = employerSocialResult.amount.plus(employerUnemploymentResult.amount).plus(employerMedicalResult.amount).toDecimalPlaces(2);
    const employerTotalCost = gross.plus(employerContributions).toDecimalPlaces(2);

    if (net.lt(0)) throw new ValidationAppError(`Negative net pay for employment ${employment.id}: ${net.toString()} (spec section 129 — respect deduction caps/priorities)`);

    return this.prisma.runInTransaction(async (tx) => {
      const prior = await tx.payrollCalculationResult.findFirst({ where: { tenantId, employmentId: employment.id, payrollPeriodId: period.id, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' } });
      if (prior) await tx.payrollCalculationResult.update({ where: { id: prior.id }, data: { status: 'SUPERSEDED' } });

      const result = await tx.payrollCalculationResult.create({
        data: {
          tenantId,
          organizationId: employment.organizationId,
          employmentId: employment.id,
          payrollPeriodId: period.id,
          calculationRunId: runId,
          version: (prior?.version ?? 0) + 1,
          currencyId: compensationSegments[0].currencyId,
          gross: gross.toDecimalPlaces(2).toString(),
          taxableIncome: taxableAfterExemption.toDecimalPlaces(2).toString(),
          employeeDeductions: employeeDeductions.toString(),
          net: net.toString(),
          employerContributions: employerContributions.toString(),
          employerTotalCost: employerTotalCost.toString(),
          status: 'CALCULATED',
          supersedesResultId: prior?.id,
        },
      });

      let seq = 0;
      for (const l of earningLines) await tx.payrollResultLine.create({ data: { tenantId, resultId: result.id, calculationCode: l.code, lineType: 'EARNING', quantity: l.quantity?.toString(), rate: l.rate?.toString(), baseAmount: l.baseAmount?.toString(), multiplier: l.multiplier?.toString(), amount: l.amount.toString(), taxable: l.taxable, socialBase: l.socialBase, unemploymentBase: l.unemploymentBase, medicalBase: l.medicalBase, sourceInput: l.sourceInput, sourceRule: l.sourceRule, calculationSequence: seq++, explanation: l.explanation } });
      for (const l of deductionLines) await tx.payrollResultLine.create({ data: { tenantId, resultId: result.id, calculationCode: l.code, lineType: 'DEDUCTION', baseAmount: l.baseAmount?.toString(), amount: l.amount.toString(), sourceRule: l.sourceRule, calculationSequence: seq++, explanation: l.explanation } });
      if (employerSocialResult.amount.gt(0)) await tx.payrollResultLine.create({ data: { tenantId, resultId: result.id, calculationCode: 'EMPLOYER_SOCIAL_INSURANCE', lineType: 'EMPLOYER_CONTRIBUTION', baseAmount: socialBase.toString(), amount: employerSocialResult.amount.toDecimalPlaces(2).toString(), sourceRule: employerSocialResult.legalReference ?? undefined, calculationSequence: seq++, explanation: employerSocialResult.trace } });
      if (employerUnemploymentResult.amount.gt(0)) await tx.payrollResultLine.create({ data: { tenantId, resultId: result.id, calculationCode: 'EMPLOYER_UNEMPLOYMENT_INSURANCE', lineType: 'EMPLOYER_CONTRIBUTION', baseAmount: unemploymentBase.toString(), amount: employerUnemploymentResult.amount.toDecimalPlaces(2).toString(), sourceRule: employerUnemploymentResult.legalReference ?? undefined, calculationSequence: seq++, explanation: employerUnemploymentResult.trace } });
      if (employerMedicalResult.amount.gt(0)) await tx.payrollResultLine.create({ data: { tenantId, resultId: result.id, calculationCode: 'EMPLOYER_MEDICAL_INSURANCE', lineType: 'EMPLOYER_CONTRIBUTION', baseAmount: medicalBase.toString(), amount: employerMedicalResult.amount.toDecimalPlaces(2).toString(), calculationSequence: seq++, explanation: employerMedicalResult.trace } });

      await this.audit.record({ tenantId, eventType: 'PAYROLL_EMPLOYEE_CALCULATED', entityType: 'PAYROLL_CALCULATION_RESULT', entityId: result.id, action: 'CREATE', userId, newValues: { gross: gross.toString(), net: net.toString() } }, tx);
      return result;
    });
  }

  async getResult(tenantId: string, resultId: string) {
    const row = await this.prisma.payrollCalculationResult.findFirst({ where: { id: resultId, tenantId }, include: { lines: true, employment: { include: { employee: { include: { physicalPerson: true } } } } } });
    if (!row) throw new NotFoundAppError('PayrollCalculationResult', resultId);
    return row;
  }

  listResults(tenantId: string, payrollPeriodId: string) {
    return this.prisma.payrollCalculationResult.findMany({ where: { tenantId, payrollPeriodId, status: { not: 'SUPERSEDED' } }, include: { employment: { include: { employee: { include: { physicalPerson: true } } } } } });
  }

  listErrors(tenantId: string, calculationRunId: string) {
    return this.prisma.payrollCalculationError.findMany({ where: { tenantId, calculationRunId } });
  }
}
