import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AZ_LEAVE_AVERAGE_COEFFICIENT, AZ_LEAVE_AVERAGE_RULE_CODE } from './az-payroll-localization.data';

export interface AverageEarningsResult {
  referencePeriodStart: Date;
  referencePeriodEnd: Date;
  referenceMonths: number;
  includedEarnings: { period: string; amount: string }[];
  averageMonthly: Decimal;
  averageDaily: Decimal;
  paidDays: Decimal;
  resultAmount: Decimal;
}

/**
 * AverageEarningsService — the central engine behind leave pay, sick pay,
 * termination, and business-trip guarantee payments (docx spec Phase 19
 * sections 35-41). AZ's own rule (12 reference calendar months, 30.4 daily
 * divisor, Labor Code Article 140) is applied as CONFIG
 * (`az-payroll-localization.data.ts`), not hardcoded arithmetic — a
 * different jurisdiction's rule would only need different seed data plus
 * a different `calculationType` branch, never a change to this class's
 * own control flow.
 *
 * Disclosed simplification: "included earnings" are read from this
 * employment's own prior PayrollCalculationResult lines whose earning
 * definition has `averageEarningsInclusion = true` — this means average
 * pay is only as good as the payroll history already calculated in this
 * system (spec section 38's own AveragePayEarningClassification concept
 * is realized via the existing PayrollEarningDefinition flag rather than a
 * separate classification entity). An employee with fewer than 12
 * calendar months of history uses however many full months are available
 * since hire (spec test 178), never a fabricated zero-filled month.
 */
@Injectable()
export class AverageEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateLeaveAverage(
    tenantId: string,
    employmentId: string,
    leaveReferenceDate: Date,
    hireDate: Date,
    paidDays: Decimal,
  ): Promise<AverageEarningsResult> {
    const referenceEnd = new Date(
      Date.UTC(leaveReferenceDate.getUTCFullYear(), leaveReferenceDate.getUTCMonth(), 0),
    );
    const maxMonths = Math.max(
      0,
      (referenceEnd.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 +
        (referenceEnd.getUTCMonth() - hireDate.getUTCMonth()) +
        1,
    );
    const referenceMonths = Math.min(12, maxMonths);
    const referenceStart = new Date(
      Date.UTC(referenceEnd.getUTCFullYear(), referenceEnd.getUTCMonth() - referenceMonths + 1, 1),
    );

    const includedEarnings: { period: string; amount: string }[] = [];
    let totalIncluded = new Decimal(0);

    if (referenceMonths > 0) {
      const results = await this.prisma.payrollCalculationResult.findMany({
        where: {
          tenantId,
          employmentId,
          status: 'CALCULATED',
          payrollPeriod: { periodStart: { gte: referenceStart }, periodEnd: { lte: referenceEnd } },
        },
        include: { lines: true, payrollPeriod: true },
      });

      const earningCodes = Array.from(new Set(results.flatMap((r) => r.lines.map((l) => l.calculationCode))));
      const definitions = await this.prisma.payrollEarningDefinition.findMany({
        where: { tenantId, code: { in: earningCodes } },
      });
      const inclusionByCode = new Map(definitions.map((d) => [d.code, d.averageEarningsInclusion]));

      for (const result of results) {
        let monthTotal = new Decimal(0);
        for (const line of result.lines) {
          if (line.lineType !== 'EARNING') continue;
          if (!inclusionByCode.get(line.calculationCode)) continue;
          monthTotal = monthTotal.plus(line.amount.toString());
        }
        totalIncluded = totalIncluded.plus(monthTotal);
        includedEarnings.push({
          period: `${result.payrollPeriod.year}-${String(result.payrollPeriod.month).padStart(2, '0')}`,
          amount: monthTotal.toFixed(2),
        });
      }
    }

    const averageMonthly = referenceMonths > 0 ? totalIncluded.div(referenceMonths) : new Decimal(0);
    const averageDaily = averageMonthly.div(AZ_LEAVE_AVERAGE_COEFFICIENT);
    const resultAmount = averageDaily.times(paidDays).toDecimalPlaces(2);

    return {
      referencePeriodStart: referenceStart,
      referencePeriodEnd: referenceEnd,
      referenceMonths,
      includedEarnings,
      averageMonthly: averageMonthly.toDecimalPlaces(2),
      averageDaily: averageDaily.toDecimalPlaces(4),
      paidDays,
      resultAmount,
    };
  }

  async persist(
    tenantId: string,
    employmentId: string,
    calculationType: string,
    result: AverageEarningsResult,
  ) {
    return this.prisma.averageEarningsCalculation.create({
      data: {
        tenantId,
        employmentId,
        calculationType,
        referencePeriodStart: result.referencePeriodStart,
        referencePeriodEnd: result.referencePeriodEnd,
        includedEarnings: result.includedEarnings,
        adjustmentCoefficient: new Decimal(AZ_LEAVE_AVERAGE_COEFFICIENT),
        averageMonthly: result.averageMonthly,
        averageDaily: result.averageDaily,
        paidDays: result.paidDays,
        resultAmount: result.resultAmount,
      },
    });
  }

  readonly leaveAverageRuleCode = AZ_LEAVE_AVERAGE_RULE_CODE;
}
