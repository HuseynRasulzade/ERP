import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ApprovalService } from '../approvals/approval.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreatePaymentOrderDto, ReconcilePaymentOrderDto, UpdatePaymentOrderDto } from './dto/treasury.dto';
import { PAYMENT_ORDER_TYPE } from './payment-order.repository';
import { PaymentRequestService } from './payment-request.service';

const SEQUENCE_PREFIX = 'PAYORD';

/**
 * Payment Order (Ödəniş Tapşırığı) service. Created only from an OPEN
 * PaymentRequest; posting via the generic document-framework (see
 * PaymentOrderPostingHandler) IS the "Bank Ödənişi" event.
 * "Bank Uzlaşdırması" (reconciliation) is `reconcile()` below.
 */
@Injectable()
export class PaymentOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly approvals: ApprovalService,
    private readonly requests: PaymentRequestService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.paymentOrder.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.paymentOrder.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('PaymentOrder', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreatePaymentOrderDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const request = await this.prisma.paymentRequest.findFirst({ where: { id: dto.paymentRequestId, organizationId } });
    if (!request) throw new ValidationAppError('Payment request does not belong to this organization');
    if (request.status !== 'OPEN') throw new ValidationAppError(`Payment request is ${request.status}, not OPEN`);

    const bankAccount = await this.prisma.bankAccount.findFirst({ where: { id: dto.bankAccountId, organizationId } });
    if (!bankAccount) throw new ValidationAppError('Bank account does not belong to this organization');
    if (!bankAccount.active) throw new ValidationAppError('Bank account is inactive');

    const amount = dto.amount != null ? new Decimal(dto.amount.toString()) : new Decimal(request.amount.toString());
    if (!amount.isFinite() || amount.lte(0)) throw new ValidationAppError('Amount must be positive');
    if (amount.gt(new Decimal(request.amount.toString()))) throw new ValidationAppError(`Amount ${amount.toString()} exceeds the payment request's own amount ${request.amount.toString()}`);

    await this.ensureSequence(tenantId);
    const header = await this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, PAYMENT_ORDER_TYPE, businessDate, tx);
      const created = await tx.paymentOrder.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          paymentRequestId: request.id,
          counterpartyId: request.counterpartyId,
          bankAccountId: dto.bankAccountId,
          currencyId: request.currencyId,
          amount,
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        { tenantId, eventType: 'PAYMENT_ORDER_CREATED', entityType: PAYMENT_ORDER_TYPE, entityId: created.id, action: 'CREATE', userId, newValues: { number: created.number, amount: amount.toString() } },
        tx,
      );

      await this.approvals.createStepsForDocument(tenantId, organizationId, PAYMENT_ORDER_TYPE, created.id, tx);
      await this.requests.markFulfilled(tenantId, request.id, tx);

      // Re-fetch: createStepsForDocument just updated approvalStatus on
      // this same row — `created` is a stale pre-that-update snapshot.
      return tx.paymentOrder.findFirst({ where: { id: created.id } });
    });
    return header;
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, patch: Omit<UpdatePaymentOrderDto, 'expectedVersion'>, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED') throw new ValidationAppError('Unpost the payment order before editing it');
    if (current.status === 'CANCELLED') throw new ValidationAppError('Cannot edit a cancelled payment order');

    if (patch.bankAccountId) {
      const bankAccount = await this.prisma.bankAccount.findFirst({ where: { id: patch.bankAccountId, organizationId } });
      if (!bankAccount || !bankAccount.active) throw new ValidationAppError('Bank account does not belong to this organization or is inactive');
    }

    const result = await this.prisma.paymentOrder.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        ...(patch.bankAccountId !== undefined ? { bankAccountId: patch.bankAccountId } : {}),
        ...(patch.amount !== undefined ? { amount: new Decimal(patch.amount.toString()) } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.bankReference !== undefined ? { bankReference: patch.bankReference } : {}),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'PAYMENT_ORDER_UPDATED', entityType: PAYMENT_ORDER_TYPE, entityId: id, action: 'UPDATE', userId, newValues: patch });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  // -- Approval -----------------------------------------------------------------

  async approve(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.approve(tenantId, organizationId, PAYMENT_ORDER_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, comment?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.get(tenantId, membershipId, organizationId, id);
    await this.approvals.reject(tenantId, organizationId, PAYMENT_ORDER_TYPE, id, userId, comment);
    return this.get(tenantId, membershipId, organizationId, id);
  }

  // -- Bank Uzlaşdırması (reconciliation) ----------------------------------------

  async reconcile(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, dto: ReconcilePaymentOrderDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus !== 'POSTED') throw new ValidationAppError('Only a posted payment order can be reconciled');

    const bankStatementAmount = new Decimal(dto.bankStatementAmount.toString());
    const difference = bankStatementAmount.minus(new Decimal(current.amount.toString()));

    const result = await this.prisma.paymentOrder.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        reconciled: true,
        reconciledAt: new Date(),
        reconciledBy: userId,
        bankStatementAmount,
        reconciliationDifference: difference,
        ...(dto.bankReference !== undefined ? { bankReference: dto.bankReference } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId, eventType: 'PAYMENT_ORDER_RECONCILED', entityType: PAYMENT_ORDER_TYPE, entityId: id, action: 'UPDATE', userId,
      newValues: { bankStatementAmount: bankStatementAmount.toString(), difference: difference.toString() },
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: PAYMENT_ORDER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: PAYMENT_ORDER_TYPE, documentType: PAYMENT_ORDER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
