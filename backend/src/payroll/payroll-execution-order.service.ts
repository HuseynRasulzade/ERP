import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { DeductionCodes } from './payroll-codes';
import { ResultLineDraft } from './payroll-result-line.types';
import { CreateExecutionOrderDto } from './dto/payroll.dto';

/**
 * PayrollExecutionOrderService — alimony/execution orders (docx spec
 * Phase 19 sections 63-66, 130). Applied in `priority` order against
 * whatever is left of net-before-this-deduction; a legal cap or an
 * insufficient remainder never simply drops the shortfall — it accrues on
 * `carryForwardBalance` for the next period (spec section 130).
 */
@Injectable()
export class PayrollExecutionOrderService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, employmentId: string) {
    return this.prisma.payrollExecutionOrder.findMany({
      where: { tenantId, employmentId },
      orderBy: { priority: 'asc' },
    });
  }

  /** Voluntary deductions require written consent; statutory
   * execution/alimony orders require the court/execution document — both
   * are tracked via the same `executionDocumentReference` field (spec
   * sections 63/67: legal basis / consent always required). */
  create(tenantId: string, userId: string, dto: CreateExecutionOrderDto) {
    if (!dto.executionDocumentReference)
      throw new ValidationAppError(
        'executionDocumentReference is required — the legal basis (execution document) for a statutory order, or the written consent reference for a voluntary deduction',
      );
    return this.prisma.payrollExecutionOrder.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        orderType: dto.orderType,
        creditor: dto.creditor,
        executionDocumentReference: dto.executionDocumentReference,
        calculationMethod: dto.calculationMethod,
        percentage: dto.percentage !== undefined ? new Decimal(dto.percentage) : undefined,
        fixedAmount: dto.fixedAmount !== undefined ? new Decimal(dto.fixedAmount) : undefined,
        priority: dto.priority ?? 100,
        effectiveFrom: this.parseDate(dto.effectiveFrom),
        capAmount: dto.capAmount !== undefined ? new Decimal(dto.capAmount) : undefined,
        protectedMinimumRule: dto.protectedMinimumRule,
        createdBy: userId,
      },
    });
  }

  /** Resolves every active execution order against `availableForDeduction`
   * (net-before-deductions minus everything already deducted at a higher
   * priority), consuming it in priority order. Persists updated
   * carry-forward balances. */
  async resolveDeductions(
    tenantId: string,
    employmentId: string,
    grossOrTaxableBase: Decimal,
    availableForDeduction: Decimal,
    asOfDate: Date,
  ): Promise<{ lines: ResultLineDraft[]; remaining: Decimal }> {
    const orders = await this.prisma.payrollExecutionOrder.findMany({
      where: {
        tenantId,
        employmentId,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { priority: 'asc' },
    });

    const lines: ResultLineDraft[] = [];
    let remaining = availableForDeduction;

    for (const order of orders) {
      const carryForward = new Decimal(order.carryForwardBalance.toString());
      let requested = carryForward;
      if (order.calculationMethod === 'PERCENTAGE' && order.percentage) {
        requested = requested.plus(grossOrTaxableBase.times(order.percentage.toString()));
      } else if (order.calculationMethod === 'FIXED' && order.fixedAmount) {
        requested = requested.plus(new Decimal(order.fixedAmount.toString()));
      }
      if (order.capAmount) requested = Decimal.min(requested, new Decimal(order.capAmount.toString()));

      const deducted = Decimal.max(0, Decimal.min(requested, remaining)).toDecimalPlaces(2);
      const shortfall = requested.minus(deducted).toDecimalPlaces(2);

      if (deducted.gt(0)) {
        lines.push({
          calculationCode: DeductionCodes.EXECUTION_ORDER,
          lineType: 'DEDUCTION',
          baseAmount: grossOrTaxableBase,
          amount: deducted,
          sourceInput: order.id,
          sourceRule: 'AZ_DEDUCTION_LIMITS',
          explanation: `${order.orderType} to ${order.creditor ?? 'creditor'}: requested ${requested.toFixed(2)}, deducted ${deducted.toFixed(2)}${shortfall.gt(0) ? `, carried forward ${shortfall.toFixed(2)}` : ''}`,
        });
        remaining = remaining.minus(deducted);
      }

      await this.prisma.payrollExecutionOrder.update({
        where: { id: order.id },
        data: { carryForwardBalance: shortfall },
      });
    }

    return { lines, remaining };
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
