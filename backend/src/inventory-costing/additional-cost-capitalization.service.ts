import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FIFOEngine } from './fifo-engine.service';
import { WeightedAverageEngine } from './weighted-average-engine.service';
import { InventoryCostingPolicyService } from './inventory-costing-policy.service';

/**
 * AdditionalCostCapitalizationService (spec sections 19-20, 45, 72, 141).
 * Reads the `PurchaseCostAllocation` rows `AdditionalPurchaseCostPostingHandler`
 * already writes (Phase 9's own allocation-by-quantity/weight/volume/value/
 * manual/equally result) and folds each allocated amount into the target
 * GoodsReceiptLine's FIFO cost layer — splitting it between on-hand
 * inventory and already-recognized COGS whenever part of that layer has
 * already shipped (never dumping the whole amount onto current stock,
 * spec section 138's own "never" list).
 */
@Injectable()
export class AdditionalCostCapitalizationService {
  constructor(
    private readonly fifo: FIFOEngine,
    private readonly wac: WeightedAverageEngine,
    private readonly policies: InventoryCostingPolicyService,
    private readonly mappings: AccountingMappingService,
  ) {}

  /**
   * Applies every `PurchaseCostAllocation` row for one AdditionalPurchaseCost
   * document. Returns the extra Dr COGS / Cr Inventory accounting lines the
   * posting handler should append to its own Dr Inventory / Cr Payable
   * batch — the SAME totalCost still balances, only the DEBIT side is now
   * split COGS vs Inventory instead of 100% Inventory.
   */
  async applyAllocations(
    tenantId: string,
    organizationId: string,
    businessDate: Date,
    sourceDocumentType: string,
    sourceDocumentId: string,
    allocations: { goodsReceiptLineId: string; productId: string; warehouseId: string | null; amount: Decimal }[],
    tx: PrismaTransactionClient,
  ): Promise<{ extraCogsAmount: Decimal; extraCogsLines: AccountingPostingLineInput[] }> {
    const policy = await this.policies.resolve(tenantId, organizationId, businessDate, tx);
    let extraCogsAmount = new Decimal(0);
    const cogsAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.COGS, businessDate, tx).catch(() => null);
    const inventoryAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx).catch(() => null);
    const extraCogsLines: AccountingPostingLineInput[] = [];

    for (const allocation of allocations) {
      if (allocation.amount.lte(0)) continue;

      if (policy.costingMethod === 'WEIGHTED_AVERAGE') {
        // Prospective-only treatment for WAC (see WeightedAverageEngine
        // class docstring) — the whole amount stays capitalized to
        // inventory; no COGS split is computed here.
        const costingKey = [organizationId, allocation.productId, policy.costByWarehouse ? `w:${allocation.warehouseId ?? '-'}` : undefined].filter(Boolean).join('|');
        await this.wac.applyAdditionalCost(tx, tenantId, costingKey, allocation.amount, sourceDocumentType, sourceDocumentId).catch(() => undefined);
        continue;
      }

      const layer = await this.findLayerForReceiptLine(tx, tenantId, allocation.goodsReceiptLineId);
      if (!layer) continue; // receipt line has no FIFO layer yet (e.g. price was unknown) — nothing to capitalize onto

      const split = await this.fifo.adjustLayerCost(tx, layer.id, allocation.amount);
      if (split.consumedShareAmount.gt(0) && cogsAccount && inventoryAccount) {
        extraCogsAmount = extraCogsAmount.plus(split.consumedShareAmount);
        extraCogsLines.push(
          { accountId: cogsAccount.id, side: 'DEBIT', amountBase: split.consumedShareAmount, description: `Additional cost — COGS adjustment for already-shipped stock (layer ${layer.id})`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: allocation.productId }] },
          { accountId: inventoryAccount.id, side: 'CREDIT', amountBase: split.consumedShareAmount, description: `Additional cost reclassified from inventory to COGS (layer ${layer.id})`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: allocation.productId }] },
        );
      }
    }

    return { extraCogsAmount, extraCogsLines };
  }

  private async findLayerForReceiptLine(tx: PrismaTransactionClient, tenantId: string, goodsReceiptLineId: string) {
    return tx.inventoryCostLayer.findFirst({ where: { tenantId, sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentLineId: goodsReceiptLineId } });
  }
}
