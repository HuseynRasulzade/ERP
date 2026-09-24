import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SetPaymentAllocationLineDto } from './dto/treasury.dto';

/**
 * Splittable payment allocation (1C parity: "avans/qarşılıqlı
 * hesablaşmaların bölüşdürülməsi") — before a PaymentOrder posts, its
 * amount can be distributed across several open Purchase Invoices for
 * the same counterparty, plus an optional unmatched-advance remainder
 * (a line with no purchaseInvoiceId). Rows are set as a whole
 * (replace-all) rather than added one at a time — the caller always
 * knows the full desired split, so there is no reason to support
 * add/remove of individual lines.
 */
@Injectable()
export class PaymentAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, paymentOrderId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.paymentAllocation.findMany({ where: { organizationId, paymentOrderId }, orderBy: { createdAt: 'asc' } });
  }

  async set(tenantId: string, membershipId: string, organizationId: string, paymentOrderId: string, userId: string, lines: SetPaymentAllocationLineDto[]) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.paymentOrder.findFirst({ where: { id: paymentOrderId, organizationId } });
    if (!order) throw new NotFoundAppError('PaymentOrder', paymentOrderId);
    if (order.postingStatus === 'POSTED') throw new ValidationAppError('Unpost the payment order before changing its allocation — paidAmount was already applied at posting time');
    if (order.status === 'CANCELLED') throw new ValidationAppError('Cannot allocate a cancelled payment order');

    if (lines.length === 0) {
      await this.prisma.paymentAllocation.deleteMany({ where: { organizationId, paymentOrderId } });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_ALLOCATION_CLEARED', entityType: 'PaymentOrder', entityId: paymentOrderId, action: 'UPDATE', userId });
      return [];
    }

    const orderAmount = new Decimal(order.amount.toString());
    let total = new Decimal(0);
    for (const line of lines) {
      const amount = new Decimal(line.amount.toString());
      if (!amount.isFinite() || amount.lte(0)) throw new ValidationAppError('Each allocation amount must be positive');
      total = total.plus(amount);
    }
    if (!total.equals(orderAmount)) {
      throw new ValidationAppError(`Allocations must sum to the payment order's amount ${orderAmount.toString()} (got ${total.toString()}) — use a line with no invoice for any unmatched advance`);
    }

    const invoiceIds = lines.map((l) => l.purchaseInvoiceId).filter((id): id is string => !!id);
    if (new Set(invoiceIds).size !== invoiceIds.length) {
      throw new ValidationAppError('Each purchase invoice can appear at most once in the allocation — combine amounts into a single line instead');
    }

    const invoices = invoiceIds.length > 0
      ? await this.prisma.purchaseInvoice.findMany({ where: { id: { in: invoiceIds }, organizationId } })
      : [];
    for (const invoiceId of invoiceIds) {
      const invoice = invoices.find((i) => i.id === invoiceId);
      if (!invoice) throw new ValidationAppError(`Purchase invoice not found: ${invoiceId}`);
      if (invoice.counterpartyId !== order.counterpartyId) {
        throw new ValidationAppError(`Purchase invoice ${invoice.number ?? invoiceId} does not belong to this payment order's counterparty`);
      }
      if (invoice.postingStatus !== 'POSTED') throw new ValidationAppError(`Purchase invoice ${invoice.number ?? invoiceId} is not posted`);
    }

    // Remaining-balance check: an invoice's payable must have enough
    // headroom for this line once every OTHER payment order's existing
    // allocation against it is accounted for (this order's own prior
    // allocation is being replaced, so it is excluded from the sum).
    for (const line of lines) {
      if (!line.purchaseInvoiceId) continue;
      const payable = await this.prisma.supplierPayable.findFirst({ where: { tenantId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: line.purchaseInvoiceId } });
      if (!payable || payable.status === 'CANCELLED') throw new ValidationAppError('This invoice has no outstanding payable');
      const otherAllocated = await this.prisma.paymentAllocation.aggregate({
        where: { tenantId, purchaseInvoiceId: line.purchaseInvoiceId, paymentOrderId: { not: paymentOrderId } },
        _sum: { amount: true },
      });
      const remaining = new Decimal(payable.invoiceAmount.toString())
        .minus(payable.paidAmount.toString())
        .minus(new Decimal((otherAllocated._sum.amount ?? 0).toString()));
      if (new Decimal(line.amount.toString()).gt(remaining)) {
        throw new ValidationAppError(`Allocation of ${line.amount} to invoice exceeds its remaining payable ${remaining.toString()}`);
      }
    }

    return this.prisma.runInTransaction(async (tx) => {
      await tx.paymentAllocation.deleteMany({ where: { organizationId, paymentOrderId } });
      const created = await Promise.all(
        lines.map((line) =>
          tx.paymentAllocation.create({
            data: {
              tenantId,
              organizationId,
              paymentOrderId,
              purchaseInvoiceId: line.purchaseInvoiceId ?? null,
              amount: new Decimal(line.amount.toString()),
              createdBy: userId,
            },
          }),
        ),
      );
      await this.audit.record(
        { tenantId, eventType: 'PAYMENT_ALLOCATION_SET', entityType: 'PaymentOrder', entityId: paymentOrderId, action: 'UPDATE', userId, newValues: { lines: lines.length, total: total.toString() } },
        tx,
      );
      return created;
    });
  }

  /** Every still-unapplied advance for a counterparty — a PaymentAllocation
   * row with no purchaseInvoiceId, on a POSTED payment order (a DRAFT
   * order's rows aren't real money yet). The row's own `amount` IS the
   * remaining unapplied balance: `applyAdvance` shrinks it in place
   * rather than tracking a separate running total. */
  async listUnmatchedAdvances(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.paymentAllocation.findMany({
      where: { tenantId, organizationId, purchaseInvoiceId: null, paymentOrder: { counterpartyId, postingStatus: 'POSTED' } },
      include: { paymentOrder: { select: { number: true, documentDate: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Applies part or all of a previously unmatched advance to a specific
   * open invoice (1C parity: "avansın əvəzləşdirilməsi") — splits the
   * advance row (reducing it by `amount`, or deleting it if fully
   * consumed), creates a new row naming the invoice, and increments that
   * invoice's SupplierPayable.paidAmount the same way `set` does at
   * posting time. The advance's own payment order stays POSTED and
   * untouched — this only relabels how money already paid settles. */
  async applyAdvance(tenantId: string, membershipId: string, organizationId: string, allocationId: string, userId: string, purchaseInvoiceId: string, amountToApply: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const allocation = await this.prisma.paymentAllocation.findFirst({ where: { id: allocationId, organizationId } });
    if (!allocation) throw new NotFoundAppError('PaymentAllocation', allocationId);
    if (allocation.purchaseInvoiceId) throw new ValidationAppError('This allocation is already matched to an invoice — only an unmatched advance can be applied');

    const order = await this.prisma.paymentOrder.findFirst({ where: { id: allocation.paymentOrderId, organizationId } });
    if (!order || order.postingStatus !== 'POSTED') throw new ValidationAppError('The advance\'s own payment order must be posted');

    const amount = new Decimal(amountToApply.toString());
    if (!amount.isFinite() || amount.lte(0)) throw new ValidationAppError('Amount to apply must be positive');
    const available = new Decimal(allocation.amount.toString());
    if (amount.gt(available)) throw new ValidationAppError(`Amount ${amount.toString()} exceeds the advance's remaining balance ${available.toString()}`);

    const invoice = await this.prisma.purchaseInvoice.findFirst({ where: { id: purchaseInvoiceId, organizationId } });
    if (!invoice) throw new ValidationAppError('Purchase invoice does not belong to this organization');
    if (invoice.counterpartyId !== order.counterpartyId) throw new ValidationAppError('Purchase invoice does not belong to this advance\'s counterparty');
    if (invoice.postingStatus !== 'POSTED') throw new ValidationAppError('Purchase invoice is not posted');

    const payable = await this.prisma.supplierPayable.findFirst({ where: { tenantId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: purchaseInvoiceId } });
    if (!payable || payable.status === 'CANCELLED') throw new ValidationAppError('This invoice has no outstanding payable');
    const remaining = new Decimal(payable.invoiceAmount.toString()).minus(payable.paidAmount.toString());
    if (amount.gt(remaining)) throw new ValidationAppError(`Amount ${amount.toString()} exceeds the invoice's remaining payable ${remaining.toString()}`);

    return this.prisma.runInTransaction(async (tx) => {
      if (amount.equals(available)) {
        await tx.paymentAllocation.update({ where: { id: allocation.id }, data: { purchaseInvoiceId } });
      } else {
        await tx.paymentAllocation.update({ where: { id: allocation.id }, data: { amount: available.minus(amount) } });
        await tx.paymentAllocation.create({
          data: { tenantId, organizationId, paymentOrderId: allocation.paymentOrderId, purchaseInvoiceId, amount, createdBy: userId },
        });
      }

      const newPaid = new Decimal(payable.paidAmount.toString()).plus(amount);
      const fullyPaid = newPaid.gte(new Decimal(payable.invoiceAmount.toString()));
      await tx.supplierPayable.update({ where: { id: payable.id }, data: { paidAmount: newPaid, status: fullyPaid ? 'PAID' : payable.status } });

      await this.audit.record(
        { tenantId, eventType: 'PAYMENT_ADVANCE_APPLIED', entityType: 'PaymentOrder', entityId: order.id, action: 'UPDATE', userId, newValues: { purchaseInvoiceId, amount: amount.toString() } },
        tx,
      );

      return tx.paymentAllocation.findMany({ where: { organizationId, paymentOrderId: allocation.paymentOrderId }, orderBy: { createdAt: 'asc' } });
    });
  }
}
