import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { BANK_FEE_TYPE } from './bank-fee.repository';

/**
 * Posting handler for BankFee (spec section 54) — Dr Bank Expense / Cr
 * Bank Account, plus a manual flat tax amount when one was recorded
 * (disclosed simplification — see BankFee's own schema doc comment).
 */
@Injectable()
export class BankFeePostingHandler implements DocumentPostingHandler {
  readonly documentType = BANK_FEE_TYPE;

  constructor(private readonly mappings: AccountingMappingService) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const fee = await tx.bankFee.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!fee)
      throw new ValidationAppError('Document disappeared during posting');
    if (fee.amount.lte(0))
      throw new ValidationAppError(
        'Cannot post a bank fee with a non-positive amount',
      );

    const bankAccount = await tx.bankAccount.findFirst({
      where: { id: fee.bankAccountId, tenantId },
    });
    if (!bankAccount || !bankAccount.active)
      throw new ValidationAppError(
        'Cannot post against a missing or inactive bank account',
      );
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const fee = await tx.bankFee.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!fee)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const total = new Decimal(fee.amount.toString()).plus(
      fee.taxAmount.toString(),
    );

    return [
      {
        registerCode: 'BANK_CASH_MOVEMENT_REGISTER',
        businessDate,
        movementType: 'BANK_FEE_LINE',
        dimensions: {
          organizationId: document.organizationId ?? null,
          bankAccountId: fee.bankAccountId,
        },
        resources: {
          amount: total.toString(),
          currencyId: fee.currencyId,
          direction: 'OUTFLOW',
        },
      },
    ];
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const fee = await tx.bankFee.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!fee)
      throw new ValidationAppError('Document disappeared during posting');
    const organizationId = fee.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(fee.amount.toString());
    const tax = new Decimal(fee.taxAmount.toString());

    const expenseAccount = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.BANK_FEE_EXPENSE,
      businessDate,
      tx,
    );
    const bankAccountGl = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.BANK,
      businessDate,
      tx,
    );

    const bankDimensions = [
      { dimensionCode: 'BANK_ACCOUNT', referenceId: fee.bankAccountId },
      ...(fee.currencyId
        ? [{ dimensionCode: 'CURRENCY', referenceId: fee.currencyId }]
        : []),
    ];

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amountBase: amount,
        description: `Bank fee ${fee.number ?? fee.id} — ${fee.feeType.toLowerCase()}`,
        dimensions: bankDimensions,
      },
    ];
    if (tax.gt(0)) {
      lines.push({
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amountBase: tax,
        description: `Bank fee ${fee.number ?? fee.id} — tax`,
        dimensions: bankDimensions,
      });
    }
    lines.push({
      accountId: bankAccountGl.id,
      side: 'CREDIT',
      amountBase: amount.plus(tax),
      description: `Bank fee ${fee.number ?? fee.id} — bank outflow`,
      dimensions: bankDimensions,
    });

    return {
      description: `Bank fee ${fee.number ?? fee.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
