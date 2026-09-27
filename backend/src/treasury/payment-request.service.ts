import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ApprovalService } from '../approvals/approval.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CreatePaymentRequestDto } from './dto/treasury.dto';

export const PAYMENT_REQUEST_TYPE = 'PAYMENT_REQUEST';
const SEQUENCE_PREFIX = 'PAYREQ';

/**
 * Payment Request (Ödəniş Tələbi) service. Plain CRUD + status, no
 * GL/posting of its own (mirrors PurchaseRequirement's non-posting
 * shape) — created only from an approved Purchase Invoice with an OPEN
 * SupplierPayable, and freezes the amount/terms/counterparty a
 * PaymentOrder will later be raised against.
 *
 * Amount-tier approval (docx spec Phase 14, sections 11-13) runs through
 * the same generic ApprovalService/ApprovalPlanProvider framework
 * PaymentOrder already uses — see PaymentRequestApprovalPlanProvider. A
 * tenant with no TreasuryPaymentApprovalRule rows configured plans zero
 * steps, so `approvalStatus` lands on NOT_REQUIRED immediately and this
 * request is usable right away, exactly as before this field existed.
 */
@Injectable()
export class PaymentRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly approvals: ApprovalService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    status?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.paymentRequest.findMany({
          where: { organizationId, ...(status ? { status } : {}) },
          orderBy: { createdAt: 'desc' },
        }),
      )
      .then((rows) =>
        Promise.all(rows.map((row) => this.withComputedFields(row))),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.paymentRequest.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('PaymentRequest', id);
    return this.withComputedFields(row);
  }

  /** `executedAmount` is never stored — always computed live from this
   * request's own linked, POSTED PaymentOrder rows (spec section 7: "PAID
   * status source bank payments-dən hesablanmalıdır. Manual set
   * edilməməlidir"). `remainingApproved` is what a new PaymentOrder can
   * still draw against this request. */
  private async withComputedFields(row: any) {
    const orders = await this.prisma.paymentOrder.findMany({
      where: { paymentRequestId: row.id, status: { not: 'CANCELLED' } },
    });
    const committed = orders.reduce(
      (s, o) => s.plus(o.amount.toString()),
      new Decimal(0),
    );
    const executed = orders
      .filter((o) => o.postingStatus === 'POSTED')
      .reduce((s, o) => s.plus(o.amount.toString()), new Decimal(0));
    const approvedAmount =
      row.approvedAmount != null
        ? new Decimal(row.approvedAmount.toString())
        : row.approvalStatus === 'NOT_REQUIRED'
          ? new Decimal(row.amount.toString())
          : null;
    return {
      ...row,
      executedAmount: executed.toFixed(2),
      committedAmount: committed.toFixed(2),
      remainingApproved:
        approvedAmount != null
          ? approvedAmount.minus(committed).toFixed(2)
          : null,
    };
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreatePaymentRequestDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: dto.purchaseInvoiceId, organizationId },
    });
    if (!invoice)
      throw new ValidationAppError(
        'Purchase invoice does not belong to this organization',
      );
    if (invoice.postingStatus !== 'POSTED')
      throw new ValidationAppError(
        'Only a posted purchase invoice can be requested for payment',
      );

    const payable = await this.prisma.supplierPayable.findFirst({
      where: {
        tenantId,
        sourceDocumentType: 'PURCHASE_INVOICE',
        sourceDocumentId: invoice.id,
      },
    });
    if (!payable || payable.status === 'CANCELLED')
      throw new ValidationAppError('This invoice has no outstanding payable');
    const remaining = new Decimal(payable.invoiceAmount.toString()).minus(
      payable.paidAmount.toString(),
    );
    if (remaining.lte(0))
      throw new ValidationAppError('This invoice is already fully paid');

    const amount =
      dto.amount != null ? new Decimal(dto.amount.toString()) : remaining;
    if (!amount.isFinite() || amount.lte(0))
      throw new ValidationAppError('Amount must be positive');
    if (amount.gt(remaining))
      throw new ValidationAppError(
        `Amount ${amount.toString()} exceeds the outstanding payable ${remaining.toString()}`,
      );

    // Contract reference, if the invoice's own source PO points at one
    // (PurchaseOrder.contractId — see docs/APPROVALS.md's spend-limit
    // control). Purely informational here — no limit re-check at payment
    // time in this increment.
    let contractId: string | null = null;
    if (invoice.supplierOrderId) {
      const order = await this.prisma.purchaseOrder.findFirst({
        where: { id: invoice.supplierOrderId, tenantId },
      });
      contractId = (order as any)?.contractId ?? null;
    }

    await this.ensureSequence(tenantId);
    const header = await this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        PAYMENT_REQUEST_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.paymentRequest.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          counterpartyId: invoice.counterpartyId,
          purchaseInvoiceId: invoice.id,
          contractId,
          currencyId: invoice.currencyId,
          amount,
          paymentTerms: invoice.dueDate
            ? `Due ${invoice.dueDate.toISOString().slice(0, 10)}`
            : undefined,
          description: dto.description,
          priority: dto.priority ?? 'NORMAL',
          category: dto.category ?? 'SUPPLIER',
          requestedPaymentDate: dto.requestedPaymentDate
            ? this.parseDate(dto.requestedPaymentDate)
            : businessDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'PAYMENT_REQUEST_CREATED',
          entityType: PAYMENT_REQUEST_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { number: created.number, amount: amount.toString() },
        },
        tx,
      );

      // Amount-tier approval (spec sections 11-13) — plans zero steps
      // (NOT_REQUIRED) when the tenant has no TreasuryPaymentApprovalRule
      // rows configured, so this request is immediately usable exactly as
      // before this gate existed.
      await this.approvals.createStepsForDocument(
        tenantId,
        organizationId,
        PAYMENT_REQUEST_TYPE,
        created.id,
        tx,
      );

      return tx.paymentRequest.findFirst({ where: { id: created.id } });
    });
    return this.withComputedFields(header);
  }

  // -- Approval (spec sections 11-13) --------------------------------------------

  /** `approvedAmount` may be less than the requested amount (partial
   * approval, spec section 10/159) — recorded only once the WHOLE
   * approval chain clears (the last/highest-authority step's own amount
   * decision, matching the spec's own worked example: "Finance Manager
   * approves 15,000 only"), never per intermediate step. */
  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    approvedAmount?: number,
    comment?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.prisma.paymentRequest.findFirst({
      where: { id, organizationId },
    });
    if (!current) throw new NotFoundAppError('PaymentRequest', id);

    const result = await this.approvals.approve(
      tenantId,
      organizationId,
      PAYMENT_REQUEST_TYPE,
      id,
      userId,
      comment,
    );
    if (result.approvalStatus === 'APPROVED') {
      const finalAmount =
        approvedAmount != null
          ? new Decimal(approvedAmount.toString())
          : new Decimal(current.amount.toString());
      if (!finalAmount.isFinite() || finalAmount.lte(0))
        throw new ValidationAppError('Approved amount must be positive');
      if (finalAmount.gt(new Decimal(current.amount.toString()))) {
        throw new ValidationAppError(
          `Approved amount ${finalAmount.toString()} exceeds the requested amount ${current.amount.toString()}`,
        );
      }
      await this.prisma.paymentRequest.update({
        where: { id },
        data: { approvedAmount: finalAmount, plannedAmount: finalAmount },
      });
    }
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    comment?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.approvals.reject(
      tenantId,
      organizationId,
      PAYMENT_REQUEST_TYPE,
      id,
      userId,
      comment,
    );
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async cancel(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'CANCELLED')
      throw new ValidationAppError('Payment request is already cancelled');
    if (current.status === 'FULFILLED')
      throw new ValidationAppError('Cannot cancel a fulfilled payment request');
    if (new Decimal(current.committedAmount).gt(0))
      throw new ValidationAppError(
        'Cannot cancel a payment request that already has a payment order against it',
      );

    const result = await this.prisma.paymentRequest.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: userId,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'PAYMENT_REQUEST_CANCELLED',
      entityType: PAYMENT_REQUEST_TYPE,
      entityId: id,
      action: 'CANCEL',
      userId,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  /** Marks this request FULFILLED once a PaymentOrder is created from it — called by PaymentOrderService. */
  async markFulfilled(
    tenantId: string,
    id: string,
    tx: PrismaTransactionClient,
  ) {
    await tx.paymentRequest.update({
      where: { id },
      data: { status: 'FULFILLED' },
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: PAYMENT_REQUEST_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: PAYMENT_REQUEST_TYPE,
          documentType: PAYMENT_REQUEST_TYPE,
          prefix: SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
