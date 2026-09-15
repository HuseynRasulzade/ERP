import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SETTLEMENT_PAYMENT_TYPE } from './settlement-payment.repository';

const SEQUENCE_PREFIX = 'PMT';

@Injectable()
export class SettlementPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.settlementPayment.findMany({ where: { organizationId, counterpartyId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementPayment.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('SettlementPayment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      direction: string;
      counterpartyId?: string;
      counterpartyRole?: string;
      contractId?: string;
      currencyId: string;
      amount: number;
      exchangeRate?: number;
      reference?: string;
      documentDate: string;
      // Phase 14 bank/treasury fields (spec sections 26-28) — all optional
      // so this method still serves Phase 13's own bare payment-adapter
      // callers unchanged.
      bankAccountId?: string;
      operationType?: string;
      paymentRequestId?: string;
      paymentInstructionId?: string;
      bankReference?: string;
      externalTransactionId?: string;
      // Phase 15 cash fields.
      cashDeskId?: string;
      cashierId?: string;
      employeeId?: string;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SETTLEMENT_PAYMENT_TYPE, documentDate, tx);
      const payment = await tx.settlementPayment.create({
        data: {
          tenantId,
          organizationId,
          direction: dto.direction,
          counterpartyId: dto.counterpartyId,
          counterpartyRole: dto.counterpartyRole,
          contractId: dto.contractId,
          currencyId: dto.currencyId,
          amount: dto.amount.toString(),
          exchangeRate: dto.exchangeRate?.toString(),
          reference: dto.reference,
          bankAccountId: dto.bankAccountId,
          operationType: dto.operationType,
          paymentRequestId: dto.paymentRequestId,
          paymentInstructionId: dto.paymentInstructionId,
          bankReference: dto.bankReference,
          externalTransactionId: dto.externalTransactionId,
          cashDeskId: dto.cashDeskId,
          cashierId: dto.cashierId,
          employeeId: dto.employeeId,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_PAYMENT_CREATED', entityType: SETTLEMENT_PAYMENT_TYPE, entityId: payment.id, action: 'CREATE', userId, newValues: { number: payment.number, amount: dto.amount } }, tx);
      return payment;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SETTLEMENT_PAYMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: SETTLEMENT_PAYMENT_TYPE, documentType: SETTLEMENT_PAYMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
