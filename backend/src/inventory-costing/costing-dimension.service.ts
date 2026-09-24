import { Injectable } from '@nestjs/common';

export interface CostingDimensionContext {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
}

/**
 * InventoryCostingDimensionService (spec section 5) — costing dimensions
 * are configured independently of quantity dimensions. A policy might
 * cost at organization+product only (two warehouses share one average),
 * or drill down to organization+warehouse+product+batch. This is the one
 * place that assembles the resulting costingKey, so every consumer
 * (FIFO layers, WA balances, the cost register) partitions identically.
 */
@Injectable()
export class InventoryCostingDimensionService {
  resolveCostingKey(policy: { costByWarehouse: boolean; costByBatch: boolean }, ctx: CostingDimensionContext): string {
    const parts = [ctx.organizationId, ctx.productId];
    if (policy.costByWarehouse && ctx.warehouseId) parts.push(ctx.warehouseId);
    if (policy.costByBatch && ctx.batchId) parts.push(ctx.batchId);
    return parts.join(':');
  }
}
