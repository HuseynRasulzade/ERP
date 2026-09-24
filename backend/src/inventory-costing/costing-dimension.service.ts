import { Injectable } from '@nestjs/common';
import { InventoryCostingPolicy } from '@prisma/client';

export interface CostingDimensionInput {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
}

/**
 * CostingDimensionService (spec section 5) — a costing key is NOT assumed
 * to equal the quantity register's own dimensions. A policy with
 * `costByWarehouse = false` pools the same product's cost across every
 * warehouse in the organization (e.g. two branches sharing one average
 * cost) even though Phase 10 still tracks their physical stock separately;
 * `costByBatch = true` splits the pool further per batch (spec section 37).
 * Kept as its own service (not inlined into the strategies) so a future
 * `costByCharacteristic` dimension is one place to change.
 */
@Injectable()
export class CostingDimensionService {
  resolveCostingKey(policy: Pick<InventoryCostingPolicy, 'costByWarehouse' | 'costByBatch'>, input: CostingDimensionInput): string {
    const parts = [input.organizationId, input.productId];
    parts.push(policy.costByWarehouse ? (input.warehouseId ?? '-') : '*');
    parts.push(policy.costByBatch ? (input.batchId ?? '-') : '*');
    return parts.join(':');
  }
}
