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
import { FIXED_ASSET_DISPOSAL_TYPE } from './fixed-asset-disposal.repository';
import {
  FIXED_ASSET_MOVEMENT_REGISTER,
  FixedAssetBalanceService,
} from './fixed-asset-balance.service';

/**
 * Posting handler for FixedAssetDisposal (docx spec Phase 16 sections
 * 65-74) — removes gross cost + accumulated depreciation + accumulated
 * impairment from the register and recognizes gain/loss. Disclosed
 * simplification: this build does not model where sale proceeds
 * physically land (cash/bank) — a `buyerId` posts the proceeds as a
 * CUSTOMER_RECEIVABLE (211) instead; record a separate CashTransaction/
 * IncomingBankPayment/Sales Invoice for the actual settlement if one
 * exists (spec section 68 already directs "link, don't duplicate" — this
 * build does not verify or reconcile against that linked Sales Invoice's
 * own GL, only stores `sourceSalesInvoiceId` for traceability).
 */
@Injectable()
export class FixedAssetDisposalPostingHandler implements DocumentPostingHandler {
  readonly documentType = FIXED_ASSET_DISPOSAL_TYPE;

  constructor(
    private readonly mappings: AccountingMappingService,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const disposal = await tx.fixedAssetDisposal.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!disposal)
      throw new ValidationAppError('Document disappeared during posting');
    const asset = await tx.fixedAsset.findFirst({
      where: { id: disposal.assetId, tenantId },
    });
    if (!asset)
      throw new ValidationAppError('Disposal references an unknown asset');
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status))
      throw new ValidationAppError(`Asset is already ${asset.status}`);
    if (
      disposal.proceeds &&
      new Decimal(disposal.proceeds.toString()).gt(0) &&
      !disposal.buyerId
    ) {
      throw new ValidationAppError(
        'Disposal proceeds require a buyerId to post the receivable',
      );
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const disposal = await tx.fixedAssetDisposal.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!disposal)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const current = await this.balances.getBalances(
      tenantId,
      disposal.assetId,
      businessDate,
      tx,
    );

    const movements: RegisterMovementInput[] = [];
    if (current.grossCost.gt(0))
      movements.push({
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate,
        movementType:
          disposal.disposalType === 'WRITE_OFF' ? 'WRITE_OFF' : 'FULL_DISPOSAL',
        dimensions: {
          organizationId: disposal.organizationId,
          assetId: disposal.assetId,
        },
        resources: { costDecrease: current.grossCost.toString() },
      });
    if (current.accumulatedDepreciation.gt(0))
      movements.push({
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate,
        movementType: 'FULL_DISPOSAL',
        dimensions: {
          organizationId: disposal.organizationId,
          assetId: disposal.assetId,
        },
        resources: {
          depreciationDecrease: current.accumulatedDepreciation.toString(),
        },
      });
    if (current.accumulatedImpairment.gt(0))
      movements.push({
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate,
        movementType: 'FULL_DISPOSAL',
        dimensions: {
          organizationId: disposal.organizationId,
          assetId: disposal.assetId,
        },
        resources: {
          impairmentDecrease: current.accumulatedImpairment.toString(),
        },
      });
    return movements;
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const disposal = await tx.fixedAssetDisposal.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!disposal)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    // Exclude this document's own movements — buildMovements() already
    // wrote them to the register in this same transaction, before this
    // method runs (see FixedAssetBalanceService.getBalances's own doc).
    const current = await this.balances.getBalances(
      tenantId,
      disposal.assetId,
      businessDate,
      tx,
      {
        recorderDocumentType: FIXED_ASSET_DISPOSAL_TYPE,
        recorderDocumentId: disposal.id,
      },
    );
    const proceeds = new Decimal(disposal.proceeds?.toString() ?? '0');
    const disposalCosts = new Decimal(disposal.disposalCosts.toString());
    const gainLoss = proceeds.minus(disposalCosts).minus(current.netBookValue);

    const dims = [
      { dimensionCode: 'FIXED_ASSET', referenceId: disposal.assetId },
    ];
    const lines: AccountingPostingLineInput[] = [];

    const costAccount = await this.mappings.resolve(
      tenantId,
      disposal.organizationId,
      MappingKeys.FIXED_ASSET_COST,
      businessDate,
      tx,
    );
    if (current.grossCost.gt(0))
      lines.push({
        accountId: costAccount.id,
        side: 'CREDIT',
        amountBase: current.grossCost,
        description: `Disposal ${disposal.number ?? disposal.id} — gross cost removed`,
        dimensions: dims,
      });

    const accumulatedTotal = current.accumulatedDepreciation.plus(
      current.accumulatedImpairment,
    );
    if (accumulatedTotal.gt(0)) {
      const accumulatedAccount = await this.mappings.resolve(
        tenantId,
        disposal.organizationId,
        MappingKeys.ACCUMULATED_DEPRECIATION,
        businessDate,
        tx,
      );
      lines.push({
        accountId: accumulatedAccount.id,
        side: 'DEBIT',
        amountBase: accumulatedTotal,
        description: `Disposal ${disposal.number ?? disposal.id} — accumulated depreciation/impairment removed`,
        dimensions: dims,
      });
    }

    if (proceeds.gt(0) && disposal.buyerId) {
      const receivableAccount = await this.mappings.resolve(
        tenantId,
        disposal.organizationId,
        MappingKeys.CUSTOMER_RECEIVABLE,
        businessDate,
        tx,
      );
      const asset = await tx.fixedAsset.findFirst({
        where: { id: disposal.assetId },
      });
      let currencyId = asset?.currencyId ?? null;
      if (!currencyId) {
        const org = await tx.organization.findUnique({
          where: { id: disposal.organizationId },
        });
        currencyId = org?.baseCurrencyId ?? null;
      }
      if (!currencyId) {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
        currencyId = tenant?.baseCurrencyId ?? null;
      }
      const receivableDims = [
        { dimensionCode: 'PARTNER', referenceId: disposal.buyerId },
        { dimensionCode: 'COUNTERPARTY', referenceId: disposal.buyerId },
        { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: disposal.id },
        ...(currencyId
          ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }]
          : []),
      ];
      lines.push({
        accountId: receivableAccount.id,
        side: 'DEBIT',
        amountBase: proceeds,
        description: `Disposal ${disposal.number ?? disposal.id} — sale proceeds receivable`,
        dimensions: receivableDims,
      });
    }

    if (gainLoss.gt(0)) {
      const gainAccount = await this.mappings.resolve(
        tenantId,
        disposal.organizationId,
        MappingKeys.DISPOSAL_GAIN,
        businessDate,
        tx,
      );
      lines.push({
        accountId: gainAccount.id,
        side: 'CREDIT',
        amountBase: gainLoss,
        description: `Disposal ${disposal.number ?? disposal.id} — gain`,
        dimensions: [],
      });
    } else if (gainLoss.lt(0)) {
      const lossAccount = await this.mappings.resolve(
        tenantId,
        disposal.organizationId,
        MappingKeys.DISPOSAL_LOSS,
        businessDate,
        tx,
      );
      lines.push({
        accountId: lossAccount.id,
        side: 'DEBIT',
        amountBase: gainLoss.abs(),
        description: `Disposal ${disposal.number ?? disposal.id} — loss`,
        dimensions: [],
      });
    }

    await tx.fixedAssetDisposal.update({
      where: { id: disposal.id },
      data: {
        grossCostAtDisposal: current.grossCost,
        accumulatedDepreciationAtDisposal: accumulatedTotal,
        gainLoss,
      },
    });
    await tx.fixedAsset.updateMany({
      where: { id: disposal.assetId },
      data: {
        status:
          disposal.disposalType === 'WRITE_OFF' ? 'WRITTEN_OFF' : 'DISPOSED',
        disposalDate: businessDate,
      },
    });

    if (lines.length === 0) return null;
    return {
      description: `Fixed asset disposal ${disposal.number ?? disposal.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }

  async undoSideEffects(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const disposal = await tx.fixedAssetDisposal.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!disposal) return;
    await tx.fixedAsset.updateMany({
      where: { id: disposal.assetId, tenantId },
      data: { status: 'ACTIVE', disposalDate: null },
    });
  }
}
