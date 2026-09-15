import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { ADDITIONAL_PURCHASE_COST_TYPE } from './additional-purchase-cost.repository';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AdditionalCostCapitalizationService } from '../inventory-costing/additional-cost-capitalization.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * Posting handler for AdditionalPurchaseCost (spec sections 12-13).
 * Allocates `totalCost` across its `targetLines` (each a GoodsReceiptLine)
 * by the chosen method and writes one `PurchaseCostAllocation` row per
 * target — the handoff Phase 11 Costing reads (spec section 12: "Allocation
 * nəticəsi inventory costing layer-a ötürülməlidir").
 *
 * Capitalized-to-inventory model only (disclosed simplification — see
 * class docstring on the Prisma model): always
 *   Dr Inventory (GOODS_INVENTORY)   totalCost (net)
 *   Dr Recoverable Input VAT         if taxable
 *   Cr Accounts Payable (531)        gross — to the cost supplier
 * never the expense-recognition alternative the spec also allows.
 */
@Injectable()
export class AdditionalPurchaseCostPostingHandler implements DocumentPostingHandler {
  readonly documentType = ADDITIONAL_PURCHASE_COST_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
    private readonly capitalization: AdditionalCostCapitalizationService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const cost = await tx.additionalPurchaseCost.findFirst({ where: { id: document.id, tenantId }, include: { targetLines: true } });
    if (!cost) throw new ValidationAppError('Document disappeared during posting');
    if (cost.targetLines.length === 0) throw new ValidationAppError('Cannot post an additional cost with no target lines');
    if (cost.totalCost.lte(0)) throw new ValidationAppError('Cannot post an additional cost with non-positive total');

    const supplier = await tx.counterparty.findFirst({ where: { id: cost.counterpartyId, tenantId } });
    if (!supplier || !supplier.active) throw new ValidationAppError('Cannot post an additional cost for a missing or inactive supplier');

    if (cost.allocationMethod === 'MANUAL') {
      for (const t of cost.targetLines) {
        if (!t.manualCoefficient || t.manualCoefficient.lte(0)) throw new ValidationAppError('Every target line needs a positive manual coefficient for MANUAL allocation');
      }
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const cost = await tx.additionalPurchaseCost.findFirst({ where: { id: document.id, tenantId }, include: { targetLines: { include: { goodsReceiptLine: { include: { goodsReceipt: true } } } } } });
    if (!cost) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = cost.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    const weights: { targetId: string; goodsReceiptLineId: string; productId: string; warehouseId: string | null; weight: Decimal }[] = [];
    for (const t of cost.targetLines) {
      const grLine = t.goodsReceiptLine;
      let weight: Decimal;
      switch (cost.allocationMethod) {
        case 'BY_QUANTITY':
          weight = new Decimal(grLine.quantity.toString());
          break;
        case 'BY_VALUE':
          weight = new Decimal(grLine.lineTotal.toString());
          break;
        case 'BY_WEIGHT': {
          const product = await tx.product.findFirst({ where: { id: grLine.productId, tenantId } });
          weight = new Decimal((product?.weight ?? 0).toString()).mul(grLine.quantity.toString());
          break;
        }
        case 'BY_VOLUME': {
          const product = await tx.product.findFirst({ where: { id: grLine.productId, tenantId } });
          weight = new Decimal((product?.volume ?? 0).toString()).mul(grLine.quantity.toString());
          break;
        }
        case 'MANUAL':
          weight = new Decimal((t.manualCoefficient ?? 0).toString());
          break;
        case 'EQUALLY':
        default:
          weight = new Decimal(1);
      }
      weights.push({ targetId: t.id, goodsReceiptLineId: grLine.id, productId: grLine.productId, warehouseId: grLine.warehouseId ?? grLine.goodsReceipt.warehouseId, weight });
    }

    const totalWeight = weights.reduce((s, w) => s.plus(w.weight), new Decimal(0));
    if (totalWeight.lte(0)) throw new ValidationAppError(`Cannot allocate by ${cost.allocationMethod}: every target line has zero weight (check product weight/volume/value)`);

    const totalCost = new Decimal(cost.totalCost.toString());
    const allocations: { goodsReceiptLineId: string; productId: string; amount: Decimal }[] = [];
    let running = new Decimal(0);
    weights.forEach((w, i) => {
      const isLast = i === weights.length - 1;
      const amount = isLast ? totalCost.minus(running) : totalCost.mul(w.weight).div(totalWeight).toDecimalPlaces(2);
      running = running.plus(amount);
      allocations.push({ goodsReceiptLineId: w.goodsReceiptLineId, productId: w.productId, amount });
    });

    for (const a of allocations) {
      await tx.purchaseCostAllocation.create({ data: { tenantId, additionalPurchaseCostId: cost.id, goodsReceiptLineId: a.goodsReceiptLineId, productId: a.productId, allocatedAmount: a.amount.toString() } });
    }

    let currencyId = cost.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) throw new ValidationAppError('Cannot post an additional purchase cost: no currency on the document, organization, or tenant');

    const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    const payable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, businessDate, tx);

    // One DEBIT line per allocation target (spec section 12's handoff row
    // per product) — account 205 requires a PRODUCT dimension, so a
    // single lump-sum line across possibly-different products would be
    // invalid even when there is only one target.
    const lines: AccountingPostingLineInput[] = allocations.map((a) => {
      const target = weights.find((w) => w.goodsReceiptLineId === a.goodsReceiptLineId);
      return { accountId: inventory.id, side: 'DEBIT' as const, amountBase: a.amount, description: `Additional purchase cost capitalized — ${cost.number ?? cost.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: a.productId }, ...(target?.warehouseId ? [{ dimensionCode: 'WAREHOUSE', referenceId: target.warehouseId }] : [])] };
    });

    // Phase 11 capitalization (spec sections 19-20, 45, 72, 141): folds
    // each allocation into its receipt line's FIFO layer/WAC bucket,
    // splitting between on-hand inventory (stays in the Dr Inventory line
    // above) and already-recognized COGS (reclassified here) whenever
    // part of that receipt has already shipped. The `Dr Inventory` lines
    // above still total `totalCost` — these extra lines only move part
    // of that amount from Inventory to COGS, never change the total.
    const { extraCogsLines } = await this.capitalization.applyAllocations(
      tenantId,
      organizationId,
      businessDate,
      ADDITIONAL_PURCHASE_COST_TYPE,
      cost.id,
      allocations.map((a) => ({ goodsReceiptLineId: a.goodsReceiptLineId, productId: a.productId, warehouseId: weights.find((w) => w.goodsReceiptLineId === a.goodsReceiptLineId)?.warehouseId ?? null, amount: a.amount })),
      tx,
    );
    lines.push(...extraCogsLines);

    let grossTotal = totalCost;
    if (cost.taxRate.gt(0)) {
      const taxResult = await this.taxCalculation.calculateLine(
        { tenantId, organizationId, businessDate, taxPointDate: businessDate, operationType: 'PURCHASE', taxCategoryCode: DEFAULT_TAX_CATEGORY, taxpayerSide: 'BUYER' },
        { amount: totalCost, priceIncludesTax: false },
        tx,
      );
      const { accountingLines: vatLines } = await this.taxRegister.registerTaxable(
        tenantId,
        document.postedBy ?? document.createdBy ?? 'system',
        { organizationId, sourceDocumentType: ADDITIONAL_PURCHASE_COST_TYPE, sourceDocumentId: document.id, taxPointDate: businessDate, currencyId: currencyId ?? undefined, operationType: 'PURCHASE', lines: [taxResult] },
        tx,
      );
      lines.push(...vatLines);
      grossTotal = taxResult.grossAmount;
      await tx.additionalPurchaseCost.update({ where: { id: cost.id }, data: { taxAmount: taxResult.taxAmount.toString() } });
    }

    lines.push({
      accountId: payable.id,
      side: 'CREDIT',
      amountBase: grossTotal,
      description: `Accounts payable — additional cost ${cost.number ?? cost.id}`,
      dimensions: [
        { dimensionCode: 'PARTNER', referenceId: cost.counterpartyId },
        { dimensionCode: 'COUNTERPARTY', referenceId: cost.counterpartyId },
        { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: cost.id },
        { dimensionCode: 'CURRENCY', referenceId: currencyId },
      ],
    });

    return { description: `Additional purchase cost ${cost.number ?? cost.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  /**
   * Disclosed simplification: this does NOT reverse the FIFO layer cost
   * bump `applyAllocations` made on post (unlike GoodsReceipt/Shipment/
   * Return, which fully reverse their own layer/consumption effects).
   * Reversing a capitalized additional cost correctly requires re-deriving
   * exactly which portion is still splittable between on-hand and
   * already-further-consumed inventory AT UNPOST TIME, which may differ
   * from the split computed at post time — that is a recalculation-engine
   * problem, not a simple field revert. Unposting an
   * AdditionalPurchaseCost therefore leaves the layer's cost as-is; treat
   * a posted-then-unposted-then-reposted AdditionalPurchaseCost as
   * requiring a manual `InventoryCostAdjustment` review, not an
   * automatic undo.
   */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await tx.purchaseCostAllocation.deleteMany({ where: { tenantId, additionalPurchaseCostId: document.id } });
  }
}
