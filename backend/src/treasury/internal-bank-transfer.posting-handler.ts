import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { INTERNAL_BANK_TRANSFER_TYPE } from './internal-bank-transfer.repository';
import { BankCashMovementService } from './bank-cash-movement.service';

/**
 * Posting handler for InternalBankTransfer (spec sections 57-60). Never a
 * supplier/customer settlement (spec section 57); the transfer principal
 * itself has no GL consequence (same-currency cash relocation between two
 * balance-sheet bank accounts, spec section 58) — only a nonzero
 * `feeAmount` posts (Dr Bank Expense / Cr Source Bank). `INSTANT` posts
 * both legs together; `TWO_STEP` posts only the source debit here —
 * `InternalTransferService.creditDestination` posts the destination leg
 * later (spec section 59's in-transit window).
 */
@Injectable()
export class InternalBankTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = INTERNAL_BANK_TRANSFER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.internalBankTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    if (transfer.amount.lte(0)) throw new ValidationAppError('Cannot post a transfer with non-positive amount');
    if (transfer.sourceBankAccountId === transfer.destinationBankAccountId) throw new ValidationAppError('Source and destination bank account must differ');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const transfer = await tx.internalBankTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = transfer.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(transfer.amount.toString());
    const fee = new Decimal(transfer.feeAmount.toString());

    await this.bankCash.record(tenantId, { organizationId, bankAccountId: transfer.sourceBankAccountId, currencyId: transfer.currencyId, direction: 'OUTFLOW', amount, baseAmount: amount, sourceDocumentType: INTERNAL_BANK_TRANSFER_TYPE, sourceDocumentId: transfer.id, transactionDate: businessDate, effectiveDate: businessDate }, tx);

    const isTwoStep = transfer.transferMode === 'TWO_STEP';
    if (!isTwoStep) {
      await this.bankCash.record(tenantId, { organizationId, bankAccountId: transfer.destinationBankAccountId, currencyId: transfer.currencyId, direction: 'INFLOW', amount, baseAmount: amount, sourceDocumentType: INTERNAL_BANK_TRANSFER_TYPE, sourceDocumentId: transfer.id, transactionDate: businessDate, effectiveDate: businessDate }, tx);
    }

    await tx.internalBankTransfer.update({ where: { id: transfer.id }, data: { transferState: isTwoStep ? 'DEBITED' : 'CREDITED' } });

    if (fee.lte(0)) return null;
    const expense = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx).catch(() => null);
    const bank = await this.mappings.resolve(tenantId, organizationId, MappingKeys.BANK, businessDate, tx).catch(() => null);
    if (!expense || !bank) return null;
    return { description: `Internal transfer fee ${transfer.number ?? transfer.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: expense.id, side: 'DEBIT', amountBase: fee, description: 'Inter-bank transfer fee' }, { accountId: bank.id, side: 'CREDIT', amountBase: fee, description: 'Inter-bank transfer fee' }] };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.bankCash.reverse(tenantId, INTERNAL_BANK_TRANSFER_TYPE, document.id, tx);
    await tx.internalBankTransfer.update({ where: { id: document.id }, data: { transferState: 'INITIATED' } });
  }
}
