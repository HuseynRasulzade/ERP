import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { PayrollEligibilityService } from './payroll-eligibility.service';
import { CompensationService } from './compensation.service';
import { PayrollInputService } from './payroll-input.service';
import { EarningCalculationService } from './earning-calculation.service';
import { AverageEarningsService } from './average-earnings.service';
import { PayrollVariableInputService } from './payroll-variable-input.service';
import { GrossToNetService } from './gross-to-net.service';
import { PayrollTaxProfileService } from './payroll-tax-profile.service';
import { PayrollPeriodService } from './payroll-period.service';
import { EarningCodes } from './payroll-codes';
import { ResultLineDraft } from './payroll-result-line.types';
import { CalculatePayrollDto } from './dto/payroll.dto';

const CALC_TYPE = 'PAYROLL_CALCULATION_RUN';

/**
 * PayrollCalculationEngine — the orchestrator (docx spec Phase 19 sections
 * 17-18, 74-80, 157-158). The calculation pipeline is a FIXED, documented
 * sequence (Base Salary -> Overtime -> Night -> Holiday -> Leave Average
 * -> Bonus/Allowance -> Gross-to-Net) rather than a generic runtime
 * dependency graph (disclosed simplification vs spec section 17's own
 * `PayrollCalculationStrategy` graph-with-cycle-detection ask) — the fixed
 * order is itself acyclic and dependency-respecting by construction, and
 * every line still carries its own explanation/source/rule trace (spec
 * sections 77-79).
 *
 * Idempotent within one `calculationVersion`: re-running replaces that
 * version's PayrollCalculationResult rows in place (delete + recreate)
 * rather than creating duplicates — a NEW version (retro/recalculation)
 * is exclusively PayrollRecalculationService's job (task 40), never this
 * engine's.
 */
@Injectable()
export class PayrollCalculationEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly eligibility: PayrollEligibilityService,
    private readonly compensation: CompensationService,
    private readonly payrollInput: PayrollInputService,
    private readonly earningCalc: EarningCalculationService,
    private readonly averageEarnings: AverageEarningsService,
    private readonly variableInputs: PayrollVariableInputService,
    private readonly grossToNet: GrossToNetService,
    private readonly taxProfiles: PayrollTaxProfileService,
    private readonly periods: PayrollPeriodService,
  ) {}

  async calculate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    periodId: string,
    dto: CalculatePayrollDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.periods.get(tenantId, membershipId, organizationId, periodId);
    if (!['OPEN', 'INPUT_COLLECTION', 'READY_TO_CALCULATE', 'CALCULATED', 'ERROR', 'REOPENED'].includes(period.status))
      throw new ValidationAppError(`Cannot calculate a payroll period in status ${period.status}`);

    const runType = dto.runType ?? 'REGULAR';
    await this.periods.setStatus(tenantId, periodId, 'CALCULATING');

    const run = await this.prisma.payrollCalculationRun.create({
      data: {
        tenantId,
        organizationId,
        payrollPeriodId: periodId,
        runType,
        version: period.calculationVersion,
        initiatedBy: userId,
      },
    });

    const employmentIds =
      dto.employmentIds ??
      (await this.eligibility.getEligibleEmployments(organizationId, period.periodStart, period.periodEnd)).map(
        (e) => e.id,
      );

    let totalGross = new Decimal(0);
    let totalNet = new Decimal(0);
    let totalTaxes = new Decimal(0);
    let totalEmployerCost = new Decimal(0);
    let processed = 0;
    let failed = 0;

    for (const employmentId of employmentIds) {
      try {
        const outcome = await this.calculateOneEmployment(
          tenantId,
          employmentId,
          period,
          run.id,
          userId,
        );
        totalGross = totalGross.plus(outcome.gross);
        totalNet = totalNet.plus(outcome.net);
        totalTaxes = totalTaxes.plus(outcome.taxes);
        totalEmployerCost = totalEmployerCost.plus(outcome.employerTotalCost);
        processed++;

        if (outcome.net.lt(0)) {
          await this.prisma.payrollError.create({
            data: {
              tenantId,
              calculationRunId: run.id,
              employmentId,
              calculationCode: 'NET_PAY',
              errorCode: 'NEGATIVE_NET_PAY',
              message: `Net pay is negative (${outcome.net.toFixed(2)}) — deductions exceed gross`,
              severity: 'ERROR',
              blocking: true,
            },
          });
        }
      } catch (err) {
        failed++;
        await this.prisma.payrollError.create({
          data: {
            tenantId,
            calculationRunId: run.id,
            employmentId,
            errorCode: 'CALCULATION_FAILED',
            message: err instanceof Error ? err.message : String(err),
            severity: 'ERROR',
            blocking: true,
          },
        });
      }
    }

    const updatedRun = await this.prisma.payrollCalculationRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        employeesProcessed: processed,
        employeesFailed: failed,
        totalGross,
        totalNet,
        totalTaxes,
        totalEmployerCost,
      },
    });

    const hasBlockingErrors = await this.prisma.payrollError.findFirst({
      where: { calculationRunId: run.id, blocking: true, resolved: false },
    });
    await this.periods.setStatus(tenantId, periodId, hasBlockingErrors ? 'ERROR' : 'CALCULATED', {
      calculatedAt: new Date(),
    });

    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_CALCULATED',
      entityType: CALC_TYPE,
      entityId: run.id,
      action: 'CREATE',
      userId,
      newValues: { processed, failed, totalGross: totalGross.toFixed(2), totalNet: totalNet.toFixed(2) },
    });

    return this.prisma.payrollCalculationRun.findFirst({ where: { id: run.id }, include: { errors: true } });
  }

  private async calculateOneEmployment(
    tenantId: string,
    employmentId: string,
    period: { id: string; periodStart: Date; periodEnd: Date; calculationVersion: number },
    runId: string,
    userId: string,
  ) {
    const existing = await this.prisma.payrollCalculationResult.findUnique({
      where: {
        employmentId_payrollPeriodId_version: {
          employmentId,
          payrollPeriodId: period.id,
          version: period.calculationVersion,
        },
      },
    });
    if (existing) {
      await this.prisma.payrollResultLine.deleteMany({ where: { resultId: existing.id } });
      await this.prisma.payrollCalculationResult.delete({ where: { id: existing.id } });
    }

    const computed = await this.computeForEmployment(tenantId, employmentId, period);
    return this.persistResult(tenantId, employmentId, period, runId, period.calculationVersion, computed);
  }

  /** Pure calculation (no persistence) — shared by the regular calculator
   * above and PayrollRecalculationService's retro path, which persists the
   * same computation under a NEW version instead of replacing in place. */
  async computeForEmployment(
    tenantId: string,
    employmentId: string,
    period: { id: string; periodStart: Date; periodEnd: Date },
  ) {
    const [input, segments, employment] = await Promise.all([
      this.payrollInput.getInputs(tenantId, employmentId, period.periodStart, period.periodEnd),
      this.compensation.resolveSegments(tenantId, employmentId, period.periodStart, period.periodEnd),
      this.prisma.employment.findFirst({ where: { id: employmentId } }),
    ]);
    if (!employment) throw new ValidationAppError('Employment not found');
    if (segments.length === 0)
      throw new ValidationAppError('No compensation assignment found covering this payroll period');

    const earningLines: ResultLineDraft[] = [];
    earningLines.push(...this.earningCalc.calculateBaseSalary(segments, input));
    const overtime = this.earningCalc.calculateOvertimePay(segments, input);
    if (overtime) earningLines.push(overtime);
    const night = this.earningCalc.calculateNightPremium(segments, input);
    if (night) earningLines.push(night);
    earningLines.push(...this.earningCalc.calculateHolidayPremium(segments, input));

    if (input.leaveHours.gt(0)) {
      const paidDays = input.leaveHours.div(8);
      const avg = await this.averageEarnings.calculateLeaveAverage(
        tenantId,
        employmentId,
        period.periodStart,
        employment.employmentStartDate,
        paidDays,
      );
      await this.averageEarnings.persist(tenantId, employmentId, 'LEAVE_PAY', avg);
      earningLines.push({
        calculationCode: EarningCodes.LEAVE_PAY,
        lineType: 'EARNING',
        quantity: paidDays,
        rate: avg.averageDaily,
        amount: avg.resultAmount,
        sourceInput: 'PayrollTimeInput',
        sourceRule: this.averageEarnings.leaveAverageRuleCode,
        explanation: `${paidDays.toFixed(2)} days x ${avg.averageDaily.toFixed(4)} average daily (${avg.referenceMonths}mo reference, ${avg.averageMonthly.toFixed(2)} avg monthly)`,
      });
    }

    const baseAmountSum = earningLines
      .filter((l) => l.calculationCode === EarningCodes.BASE_SALARY)
      .reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
    const grossSoFar = earningLines.reduce((sum, l) => sum.plus(l.amount), new Decimal(0));
    earningLines.push(
      ...(await this.variableInputs.resolveForPeriod(
        tenantId,
        employmentId,
        period.periodStart,
        period.periodEnd,
        baseAmountSum,
        grossSoFar,
      )),
    );

    const taxProfile = await this.taxProfiles.resolve(tenantId, employmentId, period.periodEnd);
    const g2n = await this.grossToNet.compute(tenantId, employmentId, earningLines, period.periodEnd, taxProfile);

    const allLines = [...earningLines, ...g2n.lines];

    return {
      g2n,
      allLines,
      snapshot: {
        hrEmploymentVersion: employment.version,
        compensationAssignmentIds: segments.map((s) => s.assignment.id),
        taxProfile,
        timeInputRaw: input.raw.map((r) => ({ timeCode: r.timeCode, hours: r.hours.toString(), days: r.days.toString() })),
      },
    };
  }

  /** Persists a `computeForEmployment()` result as a PayrollCalculationResult
   * at the given `version` (either the period's current calculationVersion
   * for a regular run, or an existing result's version+1 for a retro). */
  async persistResult(
    tenantId: string,
    employmentId: string,
    period: { id: string },
    runId: string,
    version: number,
    computed: Awaited<ReturnType<PayrollCalculationEngine['computeForEmployment']>>,
  ) {
    const { g2n, allLines, snapshot } = computed;
    return this.prisma.runInTransaction(async (tx: PrismaTransactionClient) => {
      const result = await tx.payrollCalculationResult.create({
        data: {
          tenantId,
          employmentId,
          payrollPeriodId: period.id,
          calculationRunId: runId,
          version,
          gross: g2n.gross,
          taxableIncome: g2n.taxableIncome,
          employeeDeductions: g2n.employeeDeductions,
          net: g2n.net,
          employerContributions: g2n.employerContributions,
          employerTotalCost: g2n.employerTotalCost,
          snapshot,
        },
      });

      let sequence = 0;
      for (const line of allLines) {
        sequence++;
        await tx.payrollResultLine.create({
          data: {
            tenantId,
            resultId: result.id,
            calculationCode: line.calculationCode,
            lineType: line.lineType,
            quantity: line.quantity,
            rate: line.rate,
            baseAmount: line.baseAmount,
            multiplier: line.multiplier,
            amount: line.amount,
            sourceInput: line.sourceInput,
            sourceRule: line.sourceRule,
            calculationSequence: sequence,
            explanation: line.explanation,
          },
        });
      }

      return {
        result,
        gross: g2n.gross,
        net: g2n.net,
        taxes: g2n.employeeDeductions,
        employerTotalCost: g2n.employerTotalCost,
      };
    });
  }
}
