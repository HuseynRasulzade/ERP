import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { Books, CLOSED_STATUSES } from './fixed-assets.constants';
import { CreateCandidateInput, FixedAssetAcquisitionService } from './fixed-asset-acquisition.service';
import { CapitalInvestmentService } from './capital-investment.service';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetDepreciationService } from './fixed-asset-depreciation.service';
import { FixedAssetReportingService } from './fixed-asset-reporting.service';

export interface PurchaseInvoiceFixedAssetLine {
  lineId: string;
  productId?: string | null;
  description: string;
  quantity: Decimal.Value;
  netAmount: Decimal.Value;
  taxAmount: Decimal.Value;
  nonRecoverableTaxAmount: Decimal.Value;
}

/**
 * Stable internal API of the fixed-asset module for other modules
 * (spec sections 93, 144, 165): Purchase (Phase 9) feeds acquisition
 * candidates, Month Close (Phase 22) calls calculate/validate, reporting
 * (Phase 23) and the health engine (Phase 30) read balances. Nothing here
 * requires a caller to know the FA tables.
 */
@Injectable()
export class FixedAssetsIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acquisition: FixedAssetAcquisitionService,
    private readonly cip: CapitalInvestmentService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly depreciation: FixedAssetDepreciationService,
    private readonly reporting: FixedAssetReportingService,
  ) {}

  /** Must be awaited BEFORE the caller opens its posting transaction. */
  async prepare(tenantId: string) {
    await this.acquisition.prepare(tenantId);
  }

  createAcquisitionCandidate(input: CreateCandidateInput, tx?: PrismaTransactionClient) {
    return this.acquisition.createCandidate(input, tx);
  }

  /** Purchase Invoice posted: one candidate per FIXED_ASSET line (idempotent). */
  async onPurchaseInvoicePosted(
    tx: PrismaTransactionClient,
    input: { tenantId: string; organizationId: string; invoiceId: string; invoiceNumber: string | null; invoiceDate: Date; supplierId: string; currencyId: string | null; userId?: string | null; lines: PurchaseInvoiceFixedAssetLine[] },
  ) {
    const created = [];
    for (const l of input.lines) {
      created.push(
        await this.acquisition.createCandidate(
          {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            sourceDocumentType: 'PURCHASE_INVOICE',
            sourceDocumentId: input.invoiceId,
            sourceDocumentLineId: l.lineId,
            sourceDocumentNumber: input.invoiceNumber,
            sourceDate: input.invoiceDate,
            supplierId: input.supplierId,
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            currencyId: input.currencyId,
            transactionAmount: l.netAmount,
            baseAmount: l.netAmount,
            taxAmount: l.taxAmount,
            nonRecoverableTaxAmount: l.nonRecoverableTaxAmount,
            // Recoverable VAT is never part of cost (spec sections 11, 167).
            capitalizableAmount: l.netAmount,
            candidateType: 'PURCHASE_INVOICE_LINE',
            glRecognized: true,
            createdBy: input.userId,
          },
          tx,
        ),
      );
    }
    return created;
  }

  onPurchaseInvoiceUnposted(tx: PrismaTransactionClient, tenantId: string, invoiceId: string, userId?: string) {
    return this.acquisition.withdrawForSource(tx, tenantId, 'PURCHASE_INVOICE', invoiceId, userId);
  }

  addCapitalizableCost(tx: PrismaTransactionClient, input: Parameters<CapitalInvestmentService['addCapitalizableCost']>[1]) {
    return this.cip.addCapitalizableCost(tx, input);
  }

  async getAssetNBV(tenantId: string, assetId: string, asOf?: Date, book: string = Books.ACCOUNTING_BOOK) {
    return (await this.ledger.balances(tenantId, assetId, { asOf, book })).netBookValue;
  }

  async getAssetCostBasis(tenantId: string, assetId: string, asOf?: Date) {
    return (await this.ledger.balances(tenantId, assetId, { asOf })).grossCarrying;
  }

  getDepreciationForPeriod(tenantId: string, assetId: string, period: string, book: string = Books.ACCOUNTING_BOOK) {
    return this.depreciation.getDepreciationForPeriod(tenantId, assetId, period, book);
  }

  /** True when the asset exists and is not closed (disposed / written off). */
  async validateAssetStatus(tenantId: string, assetId: string, allowed?: string[]) {
    const a = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, tenantId } });
    if (!a) throw new NotFoundAppError('FixedAsset', assetId);
    return { assetId, status: a.status, valid: allowed ? allowed.includes(a.status) : !CLOSED_STATUSES.includes(a.status) };
  }

  getFixedAssetBalances(tenantId: string, organizationId: string, asOf: Date) {
    return this.reporting.getFixedAssetBalances(tenantId, organizationId, asOf);
  }

  /** Phase 22 month-close hook: calculate + post one period. */
  async calculateFixedAssetDepreciation(tenantId: string, organizationId: string, period: string, userId: string, book: string = Books.ACCOUNTING_BOOK) {
    const run = await this.depreciation.calculateInternal(tenantId, organizationId, userId, period, book);
    return this.depreciation.postInternal(tenantId, organizationId, userId, run.id);
  }

  validateFixedAssetClose(tenantId: string, organizationId: string, period: string, book: string = Books.ACCOUNTING_BOOK) {
    return this.depreciation.validateClose(tenantId, organizationId, period, book);
  }
}
