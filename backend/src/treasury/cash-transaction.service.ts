import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateCashTransactionDto, UpdateCashTransactionDto } from './dto/treasury.dto';
import { CASH_TRANSACTION_TYPE } from './cash-transaction.repository';

const SEQUENCE_PREFIX = 'CASHTXN';
const CUSTOMER_TYPES = ['CUSTOMER', 'BOTH'];
const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];

/**
 * CashTransaction (Kassa mədaxil/məxaric) service. A cashbox is picked
 * from this organization's master data (Cashbox), never created here —
 * posting is what actually moves the GL, exactly like PaymentOrder.
 */
@Injectable()
export class CashTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.cashTransaction.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashTransaction.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('CashTransaction', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: CreateCashTransactionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);

    const cashbox = await this.prisma.cashbox.findFirst({ where: { id: dto.cashboxId, organizationId } });
    if (!cashbox) throw new ValidationAppError('Cashbox does not belong to this organization');
    if (!cashbox.active) throw new ValidationAppError('Cashbox is inactive');

    if (dto.category === 'CUSTOMER_PAYMENT' || dto.category === 'SUPPLIER_PAYMENT') {
      if (!dto.counterpartyId) throw new ValidationAppError(`A ${dto.category} cash transaction requires a counterparty`);
      await this.assertCounterpartyRole(organizationId, dto.counterpartyId, dto.category === 'CUSTOMER_PAYMENT' ? CUSTOMER_TYPES : SUPPLIER_TYPES);
    }
    if (dto.category === 'CUSTOMER_PAYMENT' && dto.direction !== 'RECEIPT') throw new ValidationAppError('A CUSTOMER_PAYMENT must be a RECEIPT');
    if (dto.category === 'SUPPLIER_PAYMENT' && dto.direction !== 'PAYMENT') throw new ValidationAppError('A SUPPLIER_PAYMENT must be a PAYMENT');

    if (dto.sourceSalesInvoiceId) {
      if (dto.category !== 'CUSTOMER_PAYMENT') throw new ValidationAppError('sourceSalesInvoiceId only applies to a CUSTOMER_PAYMENT');
      const invoice = await this.prisma.salesInvoice.findFirst({ where: { id: dto.sourceSalesInvoiceId, organizationId } });
      if (!invoice) throw new ValidationAppError('Sales invoice does not belong to this organization');
      if (invoice.counterpartyId !== dto.counterpartyId) throw new ValidationAppError("Sales invoice does not belong to this transaction's counterparty");
    }
    if (dto.sourcePurchaseInvoiceId) {
      if (dto.category !== 'SUPPLIER_PAYMENT') throw new ValidationAppError('sourcePurchaseInvoiceId only applies to a SUPPLIER_PAYMENT');
      const invoice = await this.prisma.purchaseInvoice.findFirst({ where: { id: dto.sourcePurchaseInvoiceId, organizationId } });
      if (!invoice) throw new ValidationAppError('Purchase invoice does not belong to this organization');
      if (invoice.counterpartyId !== dto.counterpartyId) throw new ValidationAppError("Purchase invoice does not belong to this transaction's counterparty");
    }

    const amount = new Decimal(dto.amount.toString());
    if (!amount.isFinite() || amount.lte(0)) throw new ValidationAppError('Amount must be positive');

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, CASH_TRANSACTION_TYPE, businessDate, tx);
      const created = await tx.cashTransaction.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          cashboxId: dto.cashboxId,
          direction: dto.direction,
          category: dto.category,
          counterpartyId: dto.counterpartyId,
          currencyId: dto.currencyId ?? cashbox.currencyId,
          amount,
          description: dto.description,
          sourceSalesInvoiceId: dto.sourceSalesInvoiceId,
          sourcePurchaseInvoiceId: dto.sourcePurchaseInvoiceId,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        { tenantId, eventType: 'CASH_TRANSACTION_CREATED', entityType: CASH_TRANSACTION_TYPE, entityId: created.id, action: 'CREATE', userId, newValues: { number: created.number, amount: amount.toString() } },
        tx,
      );

      return created;
    });
  }

  async update(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, dto: UpdateCashTransactionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.postingStatus === 'POSTED') throw new ValidationAppError('Unpost the cash transaction before editing it');
    if (current.status === 'CANCELLED') throw new ValidationAppError('Cannot edit a cancelled cash transaction');

    const category = dto.category ?? current.category;
    const counterpartyId = dto.counterpartyId !== undefined ? dto.counterpartyId : current.counterpartyId;
    if ((category === 'CUSTOMER_PAYMENT' || category === 'SUPPLIER_PAYMENT') && !counterpartyId) {
      throw new ValidationAppError(`A ${category} cash transaction requires a counterparty`);
    }
    if (dto.counterpartyId) {
      await this.assertCounterpartyRole(organizationId, dto.counterpartyId, category === 'CUSTOMER_PAYMENT' ? CUSTOMER_TYPES : SUPPLIER_TYPES);
    }

    const result = await this.prisma.cashTransaction.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        ...(dto.documentDate !== undefined ? { documentDate: this.parseDate(dto.documentDate) } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.counterpartyId !== undefined ? { counterpartyId: dto.counterpartyId } : {}),
        ...(dto.amount !== undefined ? { amount: new Decimal(dto.amount.toString()) } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({ tenantId, eventType: 'CASH_TRANSACTION_UPDATED', entityType: CASH_TRANSACTION_TYPE, entityId: id, action: 'UPDATE', userId, newValues: dto });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private async assertCounterpartyRole(organizationId: string, counterpartyId: string, allowedTypes: string[]) {
    const cp = await this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId } });
    if (!cp) throw new ValidationAppError('Counterparty does not belong to this organization');
    if (!cp.active) throw new ValidationAppError('Counterparty is inactive');
    if (!allowedTypes.includes(cp.counterpartyType)) throw new ValidationAppError(`Counterparty does not have the required role (${allowedTypes.join('/')})`);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: CASH_TRANSACTION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: CASH_TRANSACTION_TYPE, documentType: CASH_TRANSACTION_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
