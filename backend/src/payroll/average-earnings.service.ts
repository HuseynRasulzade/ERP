import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { PayrollRateBracketService } from './payroll-rate-bracket.service';
import { PayrollDefinitionsService } from './payroll-definitions.service';

/**
 * AverageEarningsService (spec sections 35-39). The reference-period
 * length (12 calendar months), which earnings count, and the daily
 * divisor are ALL read from configuration (`PayrollEarningDefinition
 * .averageEarningsInclusion`, `PayrollRateBracket` type
 * `AVERAGE_PAY_DIVISOR`) — never a literal `30.4` in this file (spec
 * section 37's own explicit prohibition). Every result is fully traced
 * (spec section 39) in `AverageEarningsBase.traceDetail`.
 */
@Injectable()
export class AverageEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brackets: PayrollRateBracketService,
    private readonly definitions: PayrollDefinitionsService,
  ) {}

  async calculate(tenantId: string, employmentId: string, calculationType: string, referenceDate: Date, paidDays: Decimal, regime: string, sourceDocumentType?: string, sourceDocumentId?: string) {
    const employment = await this.prisma.employment.findFirstOrThrow({ where: { id: employmentId, tenantId } });
    const refMonthStart = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1));
    const periodEnd = new Date(refMonthStart.getTime() - 1); // last day of the month before the reference month
    const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() - 11, 1));
    const clippedStart = employment.employmentStartDate > periodStart ? employment.employmentStartDate : periodStart;

    const results = await this.prisma.payrollCalculationResult.findMany({
      where: { tenantId, employmentId, status: { in: ['CALCULATED', 'POSTED'] }, period: { periodStart: { gte: clippedStart }, periodEnd: { lte: periodEnd } } },
      include: { lines: true, period: true },
      orderBy: { period: { periodStart: 'asc' } },
    });

    const earningDefs = await this.definitions.listEarnings(tenantId);
    const includedCodes = new Set(earningDefs.filter((e) => e.averageEarningsInclusion).map((e) => e.code));

    let total = new Decimal(0);
    const monthlyTrace: { period: string; included: string; excluded: string }[] = [];
    for (const result of results) {
      let monthTotal = new Decimal(0);
      const includedLines: string[] = [];
      const excludedLines: string[] = [];
      for (const line of result.lines) {
        if (line.lineType !== 'EARNING') continue;
        if (includedCodes.has(line.calculationCode)) {
          monthTotal = monthTotal.plus(line.amount.toString());
          includedLines.push(`${line.calculationCode}:${line.amount.toString()}`);
        } else {
          excludedLines.push(`${line.calculationCode}:${line.amount.toString()}`);
        }
      }
      total = total.plus(monthTotal);
      monthlyTrace.push({ period: `${result.period.year}-${String(result.period.month).padStart(2, '0')}`, included: includedLines.join(', '), excluded: excludedLines.join(', ') });
    }

    const includedMonths = results.length;
    const divisor = await this.brackets.resolveFlat(tenantId, 'AVERAGE_PAY_DIVISOR', regime, referenceDate);
    if (!divisor) throw new ValidationAppError(`No AVERAGE_PAY_DIVISOR rate bracket configured for regime ${regime} — seed the applicable legal rule first (spec section 37).`);

    const averageMonthly = includedMonths > 0 ? total.dividedBy(includedMonths) : new Decimal(0);
    const averageDaily = averageMonthly.dividedBy(divisor);
    const resultAmount = averageDaily.mul(paidDays);

    const row = await this.prisma.averageEarningsBase.create({
      data: {
        tenantId,
        employmentId,
        calculationType,
        referencePeriodStart: clippedStart,
        referencePeriodEnd: periodEnd,
        includedMonths,
        totalIncludedEarnings: total.toString(),
        divisor: divisor.toString(),
        averageDaily: averageDaily.toString(),
        averageMonthly: averageMonthly.toString(),
        paidDays: paidDays.toString(),
        resultAmount: resultAmount.toString(),
        traceDetail: JSON.stringify(monthlyTrace),
        sourceDocumentType,
        sourceDocumentId,
      },
    });
    return row;
  }

  history(tenantId: string, employmentId: string) {
    return this.prisma.averageEarningsBase.findMany({ where: { tenantId, employmentId }, orderBy: { createdAt: 'desc' } });
  }
}
