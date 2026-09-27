import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  CreateIncomingBankPaymentDto,
  UpdateIncomingBankPaymentDto,
} from './dto/treasury.dto';
import { INCOMING_BANK_PAYMENT_TYPE } from './incoming-bank-payment.repository';

const SEQUENCE_PREFIX = 'INBNK';

/**
 * Incoming Bank Payment (spec section 28) — the bank-side counterpart of
 * CashTransaction's RECEIPT direction, for money received via bank
 * transfer rather than into the till. Plain document-framework CRUD +
 * posting (see IncomingBankPaymentPostingHandler); no approval workflow,
 * matching CashTransaction's own scope.
 */
@Injectable()
export class IncomingBankPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.incomingBankPayment.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.incomingBankPayment.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('IncomingBankPayment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateIncomingBankPaymentDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });
    if (!bankAccount || !bankAccount.active)
      throw new ValidationAppError(
        'Bank account does not belong to this organization or is inactive',
      );

    const amount = new Decimal(dto.amount.toString());
    if (!amount.isFinite() || amount.lte(0))
      throw new ValidationAppError('Amount must be positive');

    if (
      (dto.category === 'CUSTOMER_PAYMENT' ||
        dto.category === 'CUSTOMER_ADVANCE') &&
      !dto.counterpartyId
    ) {
      throw new ValidationAppError(
        `A ${dto.category} incoming bank payment requires a counterparty`,
      );
    }

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        INCOMING_BANK_PAYMENT_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.incomingBankPayment.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          bankAccountId: dto.bankAccountId,
          category: dto.category ?? 'CUSTOMER_PAYMENT',
          counterpartyId: dto.counterpartyId,
          currencyId: dto.currencyId,
          amount,
          description: dto.description,
          sourceSalesInvoiceId: dto.sourceSalesInvoiceId,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'INCOMING_BANK_PAYMENT_CREATED',
          entityType: INCOMING_BANK_PAYMENT_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { number: created.number, amount: amount.toString() },
        },
        tx,
      );
      return created;
    });
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    patch: Omit<UpdateIncomingBankPaymentDto, 'expectedVersion'>,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED')
      throw new ValidationAppError(
        'Unpost the incoming bank payment before editing it',
      );
    if (current.status === 'CANCELLED')
      throw new ValidationAppError(
        'Cannot edit a cancelled incoming bank payment',
      );

    const result = await this.prisma.incomingBankPayment.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.counterpartyId !== undefined
          ? { counterpartyId: patch.counterpartyId }
          : {}),
        ...(patch.amount !== undefined
          ? { amount: new Decimal(patch.amount.toString()) }
          : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.bankReference !== undefined
          ? { bankReference: patch.bankReference }
          : {}),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'INCOMING_BANK_PAYMENT_UPDATED',
      entityType: INCOMING_BANK_PAYMENT_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: INCOMING_BANK_PAYMENT_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: INCOMING_BANK_PAYMENT_TYPE,
          documentType: INCOMING_BANK_PAYMENT_TYPE,
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
