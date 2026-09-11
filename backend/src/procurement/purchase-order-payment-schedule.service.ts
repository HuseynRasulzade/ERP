import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, PaymentScheduleMismatchError, ValidationAppError } from '../common/errors/app-error';
import { GeneratePurchasePaymentScheduleDto } from './dto/procurement.dto';

/**
 * PurchaseOrderPaymentSchedule (spec sections 70, 85-86, 119) — a PLANNED
 * obligation only, visible to a future Treasury Payment Calendar (Phase
 * 14), never a Bank Payment. Mirrors PaymentScheduleService (Phase 6)
 * exactly, with an added `basis` label per installment (ADVANCE /
 * AFTER_RECEIPT / AFTER_INVOICE) since this build has no rich PaymentTerms
 * template to derive a schedule from — the caller supplies installments
 * directly, same simplification as OrderPaymentSchedule.
 *
 * Rounding (spec section 119): every installment given as a percentage is
 * `round(total * pct / 100)` except the last, which absorbs whatever
 * remains so the schedule always sums to exactly the PO total.
 */
@Injectable()
export class PurchaseOrderPaymentScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, purchaseOrderId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.purchaseOrderPaymentSchedule.findMany({ where: { tenantId, purchaseOrderId }, orderBy: { sequence: 'asc' } }));
  }

  async generate(tenantId: string, membershipId: string, organizationId: string, purchaseOrderId: string, userId: string, dto: GeneratePurchasePaymentScheduleDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('PurchaseOrder', purchaseOrderId);

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

    if (!runningSum.equals(total)) throw new PaymentScheduleMismatchError(total.toFixed(2), runningSum.toFixed(2));

    return this.prisma.runInTransaction(async (tx) => {
      await tx.purchaseOrderPaymentSchedule.deleteMany({ where: { tenantId, purchaseOrderId } });

      const rows = [];
      for (const [i, installment] of dto.installments.entries()) {
        const row = await tx.purchaseOrderPaymentSchedule.create({
          data: {
            tenantId,
            purchaseOrderId,
            sequence: i,
            dueDate: new Date(installment.dueDate),
            basis: installment.basis,
            percentage: installment.percentage ?? undefined,
            amount: amounts[i].toString(),
            currencyId: order.currencyId,
            status: 'PLANNED',
          },
        });
        rows.push(row);
      }

      await this.audit.record(
        { tenantId, eventType: 'PURCHASE_PAYMENT_SCHEDULE_GENERATED', entityType: 'PurchaseOrderPaymentSchedule', entityId: purchaseOrderId, action: 'CREATE', userId, newValues: { installmentCount: rows.length, total: total.toFixed(2) } },
        tx,
      );

      return rows;
    });
  }
}

function round2(v: Decimal): Decimal {
  return new Decimal(v.toFixed(2));
}
