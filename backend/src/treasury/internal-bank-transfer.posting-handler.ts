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
import { INTERNAL_BANK_TRANSFER_TYPE } from './internal-bank-transfer.repository';

/**
 * Posting handler for InternalBankTransfer (spec sections 57-60) — moves
 * money between two of the tenant's own bank accounts; never a supplier/
 * customer settlement (spec: "Bu supplier/customer settlement deyil").
 * Disclosed simplification: posted as one atomic event (both legs, same
 * business date, `transferState` set straight to COMPLETED) rather than
 * the spec's own optional INITIATED->DEBITED->IN_TRANSIT->CREDITED timing
 * split (see docs/TREASURY.md).
 */
@Injectable()
export class InternalBankTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = INTERNAL_BANK_TRANSFER_TYPE;

  constructor(private readonly mappings: AccountingMappingService) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const transfer = await tx.internalBankTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!transfer)
      throw new ValidationAppError('Document disappeared during posting');
    if (transfer.amount.lte(0))
      throw new ValidationAppError(
        'Cannot post an internal transfer with a non-positive amount',
      );
    if (transfer.sourceBankAccountId === transfer.destinationBankAccountId) {
      throw new ValidationAppError(
        'Source and destination bank accounts must be different',
      );
    }

    const [source, destination] = await Promise.all([
      tx.bankAccount.findFirst({
        where: { id: transfer.sourceBankAccountId, tenantId },
      }),
      tx.bankAccount.findFirst({
        where: { id: transfer.destinationBankAccountId, tenantId },
      }),
    ]);
    if (!source || !source.active)
      throw new ValidationAppError(
        'Source bank account is missing or inactive',
      );
    if (!destination || !destination.active)
      throw new ValidationAppError(
        'Destination bank account is missing or inactive',
      );
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const transfer = await tx.internalBankTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!transfer)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return [
      {
        registerCode: 'BANK_CASH_MOVEMENT_REGISTER',
        businessDate,
        movementType: 'INTERNAL_TRANSFER_OUT',
        dimensions: {
          organizationId: document.organizationId ?? null,
          bankAccountId: transfer.sourceBankAccountId,
        },
        resources: {
          amount: transfer.amount.plus(transfer.feeAmount).toString(),
          currencyId: transfer.currencyId,
          direction: 'OUTFLOW',
        },
      },
      {
        registerCode: 'BANK_CASH_MOVEMENT_REGISTER',
        businessDate,
        movementType: 'INTERNAL_TRANSFER_IN',
        dimensions: {
          organizationId: document.organizationId ?? null,
          bankAccountId: transfer.destinationBankAccountId,
        },
        resources: {
          amount: transfer.amount.toString(),
          currencyId: transfer.currencyId,
          direction: 'INFLOW',
        },
      },
    ];
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const transfer = await tx.internalBankTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!transfer)
      throw new ValidationAppError('Document disappeared during posting');
    const organizationId = transfer.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(transfer.amount.toString());
    const fee = new Decimal(transfer.feeAmount.toString());

    const bankAccountGl = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.BANK,
      businessDate,
      tx,
    );
    const currencyDimension = transfer.currencyId
      ? [{ dimensionCode: 'CURRENCY', referenceId: transfer.currencyId }]
      : [];

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: bankAccountGl.id,
        side: 'DEBIT',
        amountBase: amount,
        description: `Internal transfer ${transfer.number ?? transfer.id} — destination bank inflow`,
        dimensions: [
          {
            dimensionCode: 'BANK_ACCOUNT',
            referenceId: transfer.destinationBankAccountId,
          },
          ...currencyDimension,
        ],
      },
      {
        accountId: bankAccountGl.id,
        side: 'CREDIT',
        amountBase: amount.plus(fee),
        description: `Internal transfer ${transfer.number ?? transfer.id} — source bank outflow`,
        dimensions: [
          {
            dimensionCode: 'BANK_ACCOUNT',
            referenceId: transfer.sourceBankAccountId,
          },
          ...currencyDimension,
        ],
      },
    ];

    // Inter-bank transfer fee (spec section 60) — kept separate from the
    // transfer principal, never blended into the moved amount.
    if (fee.gt(0)) {
      const feeExpense = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.BANK_FEE_EXPENSE,
        businessDate,
        tx,
      );
      lines.push({
        accountId: feeExpense.id,
        side: 'DEBIT',
        amountBase: fee,
        description: `Internal transfer ${transfer.number ?? transfer.id} — transfer fee`,
        dimensions: [
          {
            dimensionCode: 'BANK_ACCOUNT',
            referenceId: transfer.sourceBankAccountId,
          },
        ],
      });
    }

    return {
      description: `Internal bank transfer ${transfer.number ?? transfer.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
