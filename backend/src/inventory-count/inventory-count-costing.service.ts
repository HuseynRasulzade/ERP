import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { CostingService } from '../sales-execution/costing.service';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';

export type CostDirection = 'SHORTAGE' | 'SURPLUS';

export interface CostResolution {
  unitCost: Decimal | null;
  source: string;
  status: 'RESOLVED' | 'UNRESOLVED' | 'PENDING_VALUATION';
}

interface CostLayer {
  date: Date;
  quantity: Decimal;
  unitCost: Decimal;
}

/**
 * InventoryCountCostingService (spec sections 34-36, 55).
 *
 * Resolution chain, per policy:
 *   1. The platform costing API (`CostingService.getUnitCost`, the Phase 11
 *      seam other modules already call) — authoritative whenever it
 *      returns a value.
 *   2. Otherwise a *reference* cost derived from the receipt cost layers
 *      the platform does know about — posted Goods Receipt lines (price ×
 *      exchange rate) plus any inbound InventoryMovement that already
 *      carries a `provisionalCost` (e.g. an earlier count surplus):
 *        CURRENT_COST / CURRENT_WEIGHTED_AVERAGE — weighted average of layers
 *        LATEST_PURCHASE_COST                    — newest layer
 *        FIFO_LAYERS / FIFO_REFERENCE             — layers still on hand under
 *                                                   FIFO, consumed oldest-first
 *   3. Surplus-only policies: MANUAL_APPROVED (supervisor cost on the
 *      decision) and ZERO_PENDING_VALUATION (0, flagged PENDING_VALUATION).
 *
 * A shortage is NEVER costed from a manual price (spec section 135) and
 * an unresolved cost is returned as `UNRESOLVED` — the caller decides
 * (STRICT policy blocks posting; nothing is ever silently posted at 0).
 */
@Injectable()
export class InventoryCountCostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformCosting: CostingService,
  ) {}

  async resolveUnitCost(
    tenantId: string,
    organizationId: string,
    params: { productId: string; warehouseId: string; asOf: Date; quantity?: Decimal; approvedCost?: Decimal | null },
    direction: CostDirection,
    policy: string,
    tx?: PrismaTransactionClient,
  ): Promise<CostResolution> {
    if (direction === 'SURPLUS') {
      if (policy === 'ZERO_PENDING_VALUATION') return { unitCost: new Decimal(0), source: 'ZERO_PENDING_VALUATION', status: 'PENDING_VALUATION' };
      if (policy === 'MANUAL_APPROVED') {
        return params.approvedCost != null && params.approvedCost.gte(0)
          ? { unitCost: params.approvedCost, source: 'MANUAL_APPROVED', status: 'RESOLVED' }
          : { unitCost: null, source: 'MANUAL_APPROVED', status: 'UNRESOLVED' };
      }
    }

    if (['CURRENT_COST', 'CURRENT_WEIGHTED_AVERAGE', 'STANDARD_COST'].includes(policy)) {
      const platform = await this.platformCosting.getUnitCost(tenantId, organizationId, params.productId, params.warehouseId, params.asOf);
      if (platform != null) return { unitCost: new Decimal(platform), source: 'COSTING_ENGINE', status: 'RESOLVED' };
      if (policy === 'STANDARD_COST') return { unitCost: null, source: 'STANDARD_COST', status: 'UNRESOLVED' };
    }

    const layers = await this.loadLayers(tenantId, organizationId, params.productId, params.warehouseId, params.asOf, tx);
    if (layers.length === 0) return { unitCost: null, source: policy, status: 'UNRESOLVED' };

    if (policy === 'LATEST_PURCHASE_COST') {
      return { unitCost: layers[layers.length - 1].unitCost, source: 'LATEST_PURCHASE_COST', status: 'RESOLVED' };
    }
    if (policy === 'FIFO_LAYERS' || policy === 'FIFO_REFERENCE') {
      const fifo = await this.fifoCost(tenantId, params.productId, params.warehouseId, layers, params.quantity ?? new Decimal(1), tx);
      if (fifo) return { unitCost: fifo, source: 'FIFO_LAYERS', status: 'RESOLVED' };
      return { unitCost: null, source: 'FIFO_LAYERS', status: 'UNRESOLVED' };
    }
    const avg = this.weightedAverage(layers);
    return avg ? { unitCost: avg, source: 'WEIGHTED_AVERAGE', status: 'RESOLVED' } : { unitCost: null, source: 'WEIGHTED_AVERAGE', status: 'UNRESOLVED' };
  }

  /** Set-based valuation used for snapshot stock value (one query for
   * every product in the snapshot, never one per row). */
  async weightedAverageMap(tenantId: string, organizationId: string, productIds: string[], asOf: Date, tx?: PrismaTransactionClient): Promise<Map<string, Decimal>> {
    const out = new Map<string, Decimal>();
    if (productIds.length === 0) return out;
    const layersByKey = await this.loadLayersForProducts(tenantId, organizationId, productIds, asOf, tx);
    for (const [key, layers] of layersByKey) {
      const avg = this.weightedAverage(layers);
      if (avg) out.set(key, avg);
    }
    return out;
  }

  private weightedAverage(layers: CostLayer[]): Decimal | null {
    let qty = new Decimal(0);
    let value = new Decimal(0);
    for (const l of layers) {
      qty = qty.plus(l.quantity);
      value = value.plus(l.quantity.times(l.unitCost));
    }
    if (qty.lte(0)) return null;
    return value.div(qty).toDecimalPlaces(6);
  }

  /** FIFO: the layers still on hand are the newest ones covering the
   * current physical balance; a shortage consumes the oldest of those. */
  private async fifoCost(tenantId: string, productId: string, warehouseId: string, layers: CostLayer[], quantity: Decimal, tx?: PrismaTransactionClient): Promise<Decimal | null> {
    const db = tx ?? this.prisma;
    const agg = await db.inventoryMovement.aggregate({ where: { tenantId, productId, warehouseId, stockStatus: { in: PHYSICAL_STOCK_STATUSES } }, _sum: { baseQuantity: true } });
    let onHand = new Decimal((agg._sum.baseQuantity ?? 0).toString());
    if (onHand.lte(0)) return null;
    const remaining: CostLayer[] = [];
    for (let i = layers.length - 1; i >= 0 && onHand.gt(0); i--) {
      const take = Decimal.min(onHand, layers[i].quantity);
      remaining.unshift({ ...layers[i], quantity: take });
      onHand = onHand.minus(take);
    }
    let need = quantity.gt(0) ? quantity : new Decimal(1);
    let value = new Decimal(0);
    let consumed = new Decimal(0);
    for (const layer of remaining) {
      if (need.lte(0)) break;
      const take = Decimal.min(need, layer.quantity);
      value = value.plus(take.times(layer.unitCost));
      consumed = consumed.plus(take);
      need = need.minus(take);
    }
    if (consumed.lte(0)) return null;
    // Anything beyond the known layers is valued at the last consumed layer's cost.
    return value.div(consumed).toDecimalPlaces(6);
  }

  private async loadLayers(tenantId: string, organizationId: string, productId: string, warehouseId: string, asOf: Date, tx?: PrismaTransactionClient): Promise<CostLayer[]> {
    const map = await this.loadLayersForProducts(tenantId, organizationId, [productId], asOf, tx);
    return map.get(`${productId}|${warehouseId}`) ?? map.get(`${productId}|*`) ?? [];
  }

  /** Returns layers keyed `${productId}|${warehouseId}` plus an
   * organization-wide fallback `${productId}|*` (a warehouse that never
   * received the product itself still inherits the product's cost). */
  private async loadLayersForProducts(tenantId: string, organizationId: string, productIds: string[], asOf: Date, tx?: PrismaTransactionClient): Promise<Map<string, CostLayer[]>> {
    const db = tx ?? this.prisma;
    const receiptLines = await db.goodsReceiptLine.findMany({
      where: { tenantId, productId: { in: productIds }, goodsReceipt: { organizationId, postingStatus: 'POSTED', documentDate: { lte: asOf } } },
      include: { goodsReceipt: { select: { documentDate: true, warehouseId: true, exchangeRate: true, postedAt: true } } },
    });
    const costedMovements = await db.inventoryMovement.findMany({
      where: { tenantId, organizationId, productId: { in: productIds }, provisionalCost: { not: null }, quantity: { gt: 0 }, registrarDocumentType: { not: 'GOODS_RECEIPT' }, createdAt: { lte: asOf } },
      select: { productId: true, warehouseId: true, baseQuantity: true, provisionalCost: true, effectiveDate: true, createdAt: true },
    });

    const map = new Map<string, CostLayer[]>();
    const push = (key: string, layer: CostLayer) => {
      const list = map.get(key) ?? [];
      list.push(layer);
      map.set(key, list);
    };
    for (const l of receiptLines) {
      const qty = new Decimal(l.quantity.toString());
      if (qty.lte(0)) continue;
      const rate = l.goodsReceipt.exchangeRate ? new Decimal(l.goodsReceipt.exchangeRate.toString()) : new Decimal(1);
      const cost = new Decimal(l.price.toString()).times(rate);
      const wh = l.warehouseId ?? l.goodsReceipt.warehouseId;
      const layer = { date: l.goodsReceipt.postedAt ?? l.goodsReceipt.documentDate, quantity: qty, unitCost: cost };
      push(`${l.productId}|${wh}`, layer);
      push(`${l.productId}|*`, layer);
    }
    for (const m of costedMovements) {
      const layer = { date: m.createdAt, quantity: new Decimal(m.baseQuantity.toString()), unitCost: new Decimal(m.provisionalCost!.toString()) };
      push(`${m.productId}|${m.warehouseId}`, layer);
      push(`${m.productId}|*`, layer);
    }
    for (const list of map.values()) list.sort((a, b) => a.date.getTime() - b.date.getTime());
    return map;
  }
}
