import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { INTERNAL_BANK_TRANSFER_TYPE } from './internal-bank-transfer.repository';
import { BankCashMovementService } from './bank-cash-movement.service';

const SEQUENCE_PREFIX = 'IBT';

@Injectable()
export class InternalTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { sourceBankAccountId: string; destinationBankAccountId: string; currencyId: string; amount: number; feeAmount?: number; transferMode?: string; documentDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INTERNAL_BANK_TRANSFER_TYPE, documentDate, tx);
      const row = await tx.internalBankTransfer.create({
        data: { tenantId, organizationId, sourceBankAccountId: dto.sourceBankAccountId, destinationBankAccountId: dto.destinationBankAccountId, currencyId: dto.currencyId, amount: dto.amount.toString(), feeAmount: (dto.feeAmount ?? 0).toString(), transferMode: dto.transferMode ?? 'INSTANT', number: allocated.formatted, documentDate, createdBy: userId, updatedBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'INTERNAL_TRANSFER_INITIATED', entityType: INTERNAL_BANK_TRANSFER_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { amount: dto.amount } }, tx);
      return row;
    });
  }

  /** Completes a TWO_STEP transfer's destination leg (spec section 59). */
  async creditDestination(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const transfer = await this.prisma.internalBankTransfer.findFirst({ where: { id, tenantId, organizationId } });
    if (!transfer) throw new NotFoundAppError('InternalBankTransfer', id);
    if (transfer.transferMode !== 'TWO_STEP') throw new ValidationAppError('creditDestination only applies to a TWO_STEP transfer');
    if (transfer.transferState !== 'DEBITED') throw new ValidationAppError(`Cannot credit destination — transfer is in state ${transfer.transferState}`);

    return this.prisma.runInTransaction(async (tx) => {
      await this.bankCash.record(tenantId, { organizationId, bankAccountId: transfer.destinationBankAccountId, currencyId: transfer.currencyId, direction: 'INFLOW', amount: new Decimal(transfer.amount.toString()), baseAmount: new Decimal(transfer.amount.toString()), sourceDocumentType: INTERNAL_BANK_TRANSFER_TYPE, sourceDocumentId: transfer.id, transactionDate: new Date(), effectiveDate: new Date() }, tx);
      const updated = await tx.internalBankTransfer.update({ where: { id }, data: { transferState: 'CREDITED', creditedDate: new Date() } });
      await this.audit.record({ tenantId, eventType: 'INTERNAL_TRANSFER_COMPLETED', entityType: INTERNAL_BANK_TRANSFER_TYPE, entityId: id, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INTERNAL_BANK_TRANSFER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INTERNAL_BANK_TRANSFER_TYPE, documentType: INTERNAL_BANK_TRANSFER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
