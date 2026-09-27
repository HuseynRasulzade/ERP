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
import { FX_CONVERSION_TYPE } from './fx-conversion.repository';

const EPSILON = new Decimal('0.005');

/**
 * Posting handler for FXConversion (spec sections 61-63) — a currency
 * exchange between two of the tenant's own bank accounts. Deliberately
 * separate from Phase 13's realized settlement FX: `officialRate` (when
 * on file) vs `tradeRate` produces a gain/loss booked to its own
 * BANK_FX_GAIN/BANK_FX_LOSS mapping keys, never touching
 * SettlementMovement/SettlementAllocation. Never creates a customer/
 * supplier settlement (spec: "heç bir customer/supplier invoice
 * settlement yaratmır").
 */
@Injectable()
export class FXConversionPostingHandler implements DocumentPostingHandler {
  readonly documentType = FX_CONVERSION_TYPE;

  constructor(private readonly mappings: AccountingMappingService) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const conversion = await tx.fXConversion.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!conversion)
      throw new ValidationAppError('Document disappeared during posting');
    if (conversion.sourceAmount.lte(0) || conversion.destinationAmount.lte(0))
      throw new ValidationAppError(
        'Cannot post an FX conversion with a non-positive amount',
      );
    if (
      conversion.sourceBankAccountId === conversion.destinationBankAccountId
    ) {
      throw new ValidationAppError(
        'Source and destination bank accounts must be different',
      );
    }

    const [source, destination] = await Promise.all([
      tx.bankAccount.findFirst({
        where: { id: conversion.sourceBankAccountId, tenantId },
      }),
      tx.bankAccount.findFirst({
        where: { id: conversion.destinationBankAccountId, tenantId },
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
    const conversion = await tx.fXConversion.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!conversion)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return [
      {
        registerCode: 'BANK_CASH_MOVEMENT_REGISTER',
        businessDate,
        movementType: 'FX_CONVERSION_OUT',
        dimensions: {
          organizationId: document.organizationId ?? null,
          bankAccountId: conversion.sourceBankAccountId,
        },
        resources: {
          amount: conversion.sourceAmount.toString(),
          currencyId: conversion.sourceCurrencyId,
          direction: 'OUTFLOW',
        },
      },
      {
        registerCode: 'BANK_CASH_MOVEMENT_REGISTER',
        businessDate,
        movementType: 'FX_CONVERSION_IN',
        dimensions: {
          organizationId: document.organizationId ?? null,
          bankAccountId: conversion.destinationBankAccountId,
        },
        resources: {
          amount: conversion.destinationAmount.toString(),
          currencyId: conversion.destinationCurrencyId,
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
    const conversion = await tx.fXConversion.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!conversion)
      throw new ValidationAppError('Document disappeared during posting');
    const organizationId = conversion.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const sourceAmount = new Decimal(conversion.sourceAmount.toString());
    const destinationAmount = new Decimal(
      conversion.destinationAmount.toString(),
    );
    const fee = new Decimal(conversion.bankFee.toString());

    const bankAccountGl = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.BANK,
      businessDate,
      tx,
    );

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: bankAccountGl.id,
        side: 'DEBIT',
        amountBase: destinationAmount,
        description: `FX conversion ${conversion.number ?? conversion.id} — destination bank inflow`,
        dimensions: [
          {
            dimensionCode: 'BANK_ACCOUNT',
            referenceId: conversion.destinationBankAccountId,
          },
          {
            dimensionCode: 'CURRENCY',
            referenceId: conversion.destinationCurrencyId,
          },
        ],
      },
    ];

    // Gain/loss (spec sections 61-63): the source leg's base-equivalent
    // value at the OFFICIAL rate (when one is on file) vs what the trade
    // actually converted at, booked to its own account — separate posting
    // source type from Phase 13's realized settlement FX.
    let sourceLegBase = sourceAmount;
    if (conversion.officialRate) {
      const officialBase = sourceAmount.times(
        conversion.officialRate.toString(),
      );
      const diff = destinationAmount.minus(officialBase);
      if (diff.abs().gt(EPSILON)) {
        const gainKey = diff.gt(0)
          ? MappingKeys.BANK_FX_GAIN
          : MappingKeys.BANK_FX_LOSS;
        const account = await this.mappings.resolve(
          tenantId,
          organizationId,
          gainKey,
          businessDate,
          tx,
        );
        lines.push({
          accountId: account.id,
          side: diff.gt(0) ? 'CREDIT' : 'DEBIT',
          amountBase: diff.abs(),
          description: `FX conversion ${conversion.number ?? conversion.id} — bank FX ${diff.gt(0) ? 'gain' : 'loss'} vs official rate`,
          dimensions: [
            {
              dimensionCode: 'BANK_ACCOUNT',
              referenceId: conversion.sourceBankAccountId,
            },
          ],
        });
      }
      sourceLegBase = officialBase;
    } else {
      sourceLegBase = destinationAmount;
    }

    lines.push({
      accountId: bankAccountGl.id,
      side: 'CREDIT',
      amountBase: sourceLegBase,
      description: `FX conversion ${conversion.number ?? conversion.id} — source bank outflow`,
      dimensions: [
        {
          dimensionCode: 'BANK_ACCOUNT',
          referenceId: conversion.sourceBankAccountId,
        },
        { dimensionCode: 'CURRENCY', referenceId: conversion.sourceCurrencyId },
      ],
    });

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
        description: `FX conversion ${conversion.number ?? conversion.id} — bank fee`,
        dimensions: [
          {
            dimensionCode: 'BANK_ACCOUNT',
            referenceId: conversion.sourceBankAccountId,
          },
        ],
      });
      lines.push({
        accountId: bankAccountGl.id,
        side: 'CREDIT',
        amountBase: fee,
        description: `FX conversion ${conversion.number ?? conversion.id} — bank fee outflow`,
        dimensions: [
          {
            dimensionCode: 'BANK_ACCOUNT',
            referenceId: conversion.sourceBankAccountId,
          },
          {
            dimensionCode: 'CURRENCY',
            referenceId: conversion.sourceCurrencyId,
          },
        ],
      });
    }

    return {
      description: `FX conversion ${conversion.number ?? conversion.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
