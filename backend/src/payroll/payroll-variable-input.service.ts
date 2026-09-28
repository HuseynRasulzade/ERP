import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CreateVariableInputDto } from './dto/payroll.dto';
import { ResultLineDraft } from './payroll-result-line.types';

/**
 * PayrollVariableInputService — bonus/allowance/manual authorized inputs
 * (docx spec Phase 19 sections 31-34). A percentage-based bonus resolves
 * against the period's already-computed base or gross (passed in by the
 * caller), never a value baked in at input-creation time.
 */
@Injectable()
export class PayrollVariableInputService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, employmentId: string, fromDate: Date, toDate: Date) {
    return this.prisma.payrollVariableInput.findMany({
      where: { tenantId, employmentId, effectiveDate: { gte: fromDate, lte: toDate } },
      orderBy: { effectiveDate: 'asc' },
    });
  }

  create(tenantId: string, userId: string, dto: CreateVariableInputDto) {
    if (dto.amount === undefined && dto.percentage === undefined)
      throw new ValidationAppError('Either amount or percentage is required');
    return this.prisma.payrollVariableInput.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        earningCode: dto.earningCode,
        amount: dto.amount !== undefined ? new Decimal(dto.amount) : undefined,
        percentage: dto.percentage !== undefined ? new Decimal(dto.percentage) : undefined,
        quantity: dto.quantity !== undefined ? new Decimal(dto.quantity) : undefined,
        effectiveDate: this.parseDate(dto.effectiveDate),
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        approvalStatus: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
        createdBy: userId,
      },
    });
  }

  /** Resolves every variable input in range into result-line drafts.
   * PERCENT_OF_BASE resolves against `baseAmount`, PERCENT_OF_GROSS
   * against `grossSoFar` — both passed in by the calculation engine once
   * those totals are known. */
  async resolveForPeriod(
    tenantId: string,
    employmentId: string,
    periodStart: Date,
    periodEnd: Date,
    baseAmount: Decimal,
    grossSoFar: Decimal,
  ): Promise<ResultLineDraft[]> {
    const inputs = await this.list(tenantId, employmentId, periodStart, periodEnd);
    const lines: ResultLineDraft[] = [];
    for (const input of inputs.filter((i) => i.status === 'ACTIVE' && i.approvalStatus === 'APPROVED')) {
      let amount = new Decimal(0);
      let explanation = '';
      if (input.amount) {
        amount = new Decimal(input.amount.toString());
        explanation = `Fixed amount ${amount.toFixed(2)}`;
      } else if (input.percentage) {
        const pct = new Decimal(input.percentage.toString());
        const base = input.earningCode === 'BONUS' ? grossSoFar : baseAmount;
        amount = base.times(pct);
        explanation = `${pct.times(100).toFixed(2)}% of ${base.toFixed(2)}`;
      }
      lines.push({
        calculationCode: input.earningCode,
        lineType: 'EARNING',
        amount: amount.toDecimalPlaces(2),
        rate: input.percentage ? new Decimal(input.percentage.toString()) : undefined,
        baseAmount: input.percentage ? (input.earningCode === 'BONUS' ? grossSoFar : baseAmount) : undefined,
        sourceInput: 'PayrollVariableInput',
        sourceRule: input.id,
        explanation,
      });
    }
    return lines;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
