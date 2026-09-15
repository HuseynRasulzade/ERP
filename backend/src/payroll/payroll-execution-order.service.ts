import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * PayrollExecutionOrderService (spec sections 65-66, 130) — alimony and
 * other court/execution-document deductions, plus the arrears ledger
 * (`DeductionCarryForwardBalance`) that keeps an unpaid remainder visible
 * forever rather than losing it when a payroll period's deduction cap is
 * reached (spec section 130's own worked example).
 */
@Injectable()
export class PayrollExecutionOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { employmentId: string; orderType: string; creditor: string; courtReference?: string; calculationMethod?: string; percentage?: number; fixedAmount?: number; priority?: number; capAmount?: number; protectedMinimum?: number; effectiveFrom: string }) {
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, tenantId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const row = await this.prisma.payrollExecutionOrder.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        orderType: dto.orderType,
        creditor: dto.creditor,
        courtReference: dto.courtReference,
        calculationMethod: dto.calculationMethod ?? 'PERCENTAGE',
        percentage: dto.percentage?.toString(),
        fixedAmount: dto.fixedAmount?.toString(),
        priority: dto.priority ?? 100,
        capAmount: dto.capAmount?.toString(),
        protectedMinimum: dto.protectedMinimum?.toString(),
        effectiveFrom: new Date(dto.effectiveFrom),
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_EXECUTION_ORDER_CREATED', entityType: 'PAYROLL_EXECUTION_ORDER', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  activeFor(tenantId: string, employmentId: string, date: Date) {
    return this.prisma.payrollExecutionOrder.findMany({ where: { tenantId, employmentId, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { priority: 'asc' } });
  }

  /** Records whatever an order's calculated amount could NOT be withheld
   * this period (an aggregate cap bound it) as an OUTSTANDING carry-
   * forward row — never silently dropped. */
  async recordCarryForward(tenantId: string, employmentId: string, deductionCode: string, sourceExecutionOrderId: string | null, originPeriod: Date, amount: Decimal) {
    if (amount.lte(0)) return null;
    return this.prisma.deductionCarryForwardBalance.create({ data: { tenantId, employmentId, deductionCode, sourceExecutionOrderId, originPeriod, amount: amount.toString() } });
  }

  outstandingCarryForward(tenantId: string, employmentId: string) {
    return this.prisma.deductionCarryForwardBalance.findMany({ where: { tenantId, employmentId, status: { not: 'RESOLVED' } }, orderBy: { originPeriod: 'asc' } });
  }

  async resolveCarryForward(tenantId: string, userId: string, id: string, amount: Decimal) {
    const balance = await this.prisma.deductionCarryForwardBalance.findFirst({ where: { id, tenantId } });
    if (!balance) throw new NotFoundAppError('DeductionCarryForwardBalance', id);
    const resolved = new Decimal(balance.resolvedAmount.toString()).plus(amount);
    const status = resolved.gte(balance.amount.toString()) ? 'RESOLVED' : 'PARTIALLY_RESOLVED';
    return this.prisma.deductionCarryForwardBalance.update({ where: { id }, data: { resolvedAmount: resolved.toString(), status } });
  }

  list(tenantId: string, employmentId?: string) {
    return this.prisma.payrollExecutionOrder.findMany({ where: { tenantId, employmentId }, orderBy: { priority: 'asc' } });
  }
}
