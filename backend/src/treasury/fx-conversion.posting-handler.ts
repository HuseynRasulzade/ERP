import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FX_CONVERSION_TYPE } from './fx-conversion.repository';
import { BankCashMovementService } from './bank-cash-movement.service';

/**
 * Posting handler for FXConversion (spec sections 61-63, 119, 169) — bank
 * account currency exchange, DELIBERATELY separate from Phase 13's
 * settlement FX (spec section 63). Never creates a customer/supplier
 * settlement consequence. Gain/loss vs the official rate (when known) is
 * booked to `OTHER_OPERATING_INCOME`/`_EXPENSE` — this build has no
 * dedicated treasury-FX mapping key, a disclosed simplification also used
 * for Phase 13's own realized FX.
 */
@Injectable()
export class FXConversionPostingHandler implements DocumentPostingHandler {
  readonly documentType = FX_CONVERSION_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const fx = await tx.fXConversion.findFirst({ where: { id: document.id, tenantId } });
    if (!fx) throw new ValidationAppError('Document disappeared during posting');
    if (fx.sourceAmount.lte(0) || fx.destinationAmount.lte(0)) throw new ValidationAppError('Cannot post an FX conversion with non-positive amounts');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const fx = await tx.fXConversion.findFirst({ where: { id: document.id, tenantId } });
    if (!fx) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = fx.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const sourceAmount = new Decimal(fx.sourceAmount.toString());
    const destinationAmount = new Decimal(fx.destinationAmount.toString());
    const fee = new Decimal(fx.bankFeeAmount.toString());

    await this.bankCash.record(tenantId, { organizationId, bankAccountId: fx.sourceBankAccountId, currencyId: fx.sourceCurrencyId, direction: 'OUTFLOW', amount: sourceAmount, baseAmount: sourceAmount, sourceDocumentType: FX_CONVERSION_TYPE, sourceDocumentId: fx.id, transactionDate: businessDate, effectiveDate: businessDate }, tx);
    await this.bankCash.record(tenantId, { organizationId, bankAccountId: fx.destinationBankAccountId, currencyId: fx.destinationCurrencyId, direction: 'INFLOW', amount: destinationAmount, baseAmount: destinationAmount, sourceDocumentType: FX_CONVERSION_TYPE, sourceDocumentId: fx.id, transactionDate: businessDate, effectiveDate: businessDate }, tx);
    if (fee.gt(0)) {
      await this.bankCash.record(tenantId, { organizationId, bankAccountId: fx.sourceBankAccountId, currencyId: fx.sourceCurrencyId, direction: 'OUTFLOW', amount: fee, baseAmount: fee, sourceDocumentType: FX_CONVERSION_TYPE, sourceDocumentId: `${fx.id}:FEE`, transactionDate: businessDate, effectiveDate: businessDate }, tx);
    }

    if (!fx.officialRate) return null; // no reference rate — nothing to compare gain/loss against
    const officialEquivalent = sourceAmount.mul(fx.officialRate.toString());
    const diff = destinationAmount.minus(officialEquivalent); // + gain, - loss
    if (diff.abs().lte('0.01')) return null;

    const account = await this.mappings.resolve(tenantId, organizationId, diff.gt(0) ? MappingKeys.OTHER_OPERATING_INCOME : MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx).catch(() => null);
    const bank = await this.mappings.resolve(tenantId, organizationId, MappingKeys.BANK, businessDate, tx).catch(() => null);
    if (!account || !bank) return null;

    const abs = diff.abs();
    const lines = diff.gt(0)
      ? [{ accountId: bank.id, side: 'DEBIT' as const, amountBase: abs, description: 'FX conversion gain vs official rate' }, { accountId: account.id, side: 'CREDIT' as const, amountBase: abs, description: 'FX conversion gain' }]
      : [{ accountId: account.id, side: 'DEBIT' as const, amountBase: abs, description: 'FX conversion loss' }, { accountId: bank.id, side: 'CREDIT' as const, amountBase: abs, description: 'FX conversion loss vs official rate' }];

    return { description: `FX conversion ${fx.number ?? fx.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.bankCash.reverse(tenantId, FX_CONVERSION_TYPE, document.id, tx);
    await this.bankCash.reverse(tenantId, FX_CONVERSION_TYPE, `${document.id}:FEE`, tx);
  }
}
