import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, PaymentScheduleMismatchError, ValidationAppError } from '../common/errors/app-error';
import { GeneratePaymentScheduleDto } from './dto/sales-preorder.dto';

/**
 * OrderPaymentSchedule (spec sections 49-53). This build's `Counterparty`
 * has no rich `PaymentTerms` entity to derive a schedule from (Phase 3 as
 * actually built stops at a plain `paymentTerms: Int? // days` field) —
 * so the caller supplies the installment due-dates/percentages directly
 * (spec section 49's "50% advance / 50% after 30 days" example, expressed
 * as two `PaymentScheduleInstallmentDto` rows) rather than this service
 * deriving them from a PaymentTerms template. See docs/SALES_PREORDER.md.
 *
 * Rounding (spec section 50): when installments are given as percentages,
 * every line except the last is `round(total * pct / 100)`; the last
 * line absorbs whatever remains so the schedule always sums to exactly
 * the order total — never an independently-rounded, possibly-mismatched
 * final line.
 */
@Injectable()
export class PaymentScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, salesOrderId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.orderPaymentSchedule.findMany({ where: { tenantId, salesOrderId }, orderBy: { sequence: 'asc' } }));
  }

  async generate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    salesOrderId: string,
    userId: string,
    dto: GeneratePaymentScheduleDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('SalesOrder', salesOrderId);

    const total = new Decimal(order.grandTotal.toString());
    const amounts: Decimal[] = [];
    let runningSum = new Decimal(0);

    for (const [i, installment] of dto.installments.entries()) {
      const isLast = i === dto.installments.length - 1;
      let amount: Decimal;
      if (installment.amount !== undefined) {
        amount = new Decimal(installment.amount);
      } else if (installment.percentage !== undefined) {
        amount = isLast ? total.minus(runningSum) : round2(total.mul(installment.percentage).div(100));
      } else {
        throw new ValidationAppError('Each installment needs either an amount or a percentage');
      }
      amounts.push(amount);
      runningSum = runningSum.plus(amount);
    }

    if (!runningSum.equals(total)) {
      throw new PaymentScheduleMismatchError(total.toFixed(2), runningSum.toFixed(2));
    }

    return this.prisma.runInTransaction(async (tx) => {
      await tx.orderPaymentSchedule.deleteMany({ where: { tenantId, salesOrderId } });

      const rows = [];
      for (const [i, installment] of dto.installments.entries()) {
        const row = await tx.orderPaymentSchedule.create({
          data: {
            tenantId,
            salesOrderId,
            sequence: i,
            dueDate: new Date(installment.dueDate),
            percentage: installment.percentage ?? undefined,
            amount: amounts[i].toString(),
            currencyId: order.currencyId,
            status: 'PLANNED',
          },
        });
        rows.push(row);
      }

      await this.audit.record(
        { tenantId, eventType: 'PAYMENT_SCHEDULE_GENERATED', entityType: 'OrderPaymentSchedule', entityId: salesOrderId, action: 'CREATE', userId, newValues: { installmentCount: rows.length, total: total.toFixed(2) } },
        tx,
      );

      return rows;
    });
  }
}

function round2(v: Decimal): Decimal {
  return new Decimal(v.toFixed(2));
}
