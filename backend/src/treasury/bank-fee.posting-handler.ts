import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { BANK_FEE_TYPE } from './bank-fee.repository';
import { BankCashMovementService } from './bank-cash-movement.service';

/**
 * Posting handler for BankFee (spec sections 54-56). Dr Bank Expense /
 * Cr Bank, plus a `BankCashMovement` OUTFLOW. When `statementLineId` is
 * set, this fee originated from an unmatched statement line
 * classification (spec section 48) — this handler doesn't itself create
 * the match; `BankMatchingService.manualMatch` (called by the caller
 * after posting) links the two.
 */
@Injectable()
export class BankFeePostingHandler implements DocumentPostingHandler {
  readonly documentType = BANK_FEE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const fee = await tx.bankFee.findFirst({ where: { id: document.id, tenantId } });
    if (!fee) throw new ValidationAppError('Document disappeared during posting');
    if (fee.amount.lte(0)) throw new ValidationAppError('Cannot post a bank fee with non-positive amount');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const fee = await tx.bankFee.findFirst({ where: { id: document.id, tenantId } });
    if (!fee) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = fee.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const total = new Decimal(fee.amount.toString()).plus(fee.taxAmount.toString());

    await this.bankCash.record(tenantId, { organizationId, bankAccountId: fee.bankAccountId, currencyId: fee.currencyId, direction: 'OUTFLOW', amount: total, baseAmount: total, sourceDocumentType: BANK_FEE_TYPE, sourceDocumentId: fee.id, transactionDate: businessDate, effectiveDate: businessDate }, tx);

    const expense = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx).catch(() => null);
    const bank = await this.mappings.resolve(tenantId, organizationId, MappingKeys.BANK, businessDate, tx).catch(() => null);
    if (!expense || !bank) return null;

    return { description: `Bank fee ${fee.number ?? fee.id} (${fee.feeType})`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: expense.id, side: 'DEBIT', amountBase: total, description: `Bank fee — ${fee.feeType}` }, { accountId: bank.id, side: 'CREDIT', amountBase: total, description: `Bank fee — ${fee.feeType}` }] };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.bankCash.reverse(tenantId, BANK_FEE_TYPE, document.id, tx);
  }
}
