import { Injectable } from '@nestjs/common';
import { EffectiveCostingPolicy } from './inventory-costing-policy.service';

export interface CostingDimensionInput {
  organizationId: string;
  productId: string;
  warehouseId?: string | null;
  characteristicId?: string | null;
  batchId?: string | null;
}

/**
 * InventoryCostingDimensionService (spec section 5). The costing
 * dimension a policy resolves to is NOT always the same as Phase 10's
 * physical stock dimensions — a policy can choose to average cost across
 * every warehouse in an organization while Phase 10 still tracks quantity
 * per warehouse (spec's own Baku/Ganja example). This is the one place in
 * the codebase that turns a policy + physical dimensions into the single
 * `costingKey` string every costing table is partitioned by.
 */
@Injectable()
export class CostingDimensionService {
  resolveKey(policy: EffectiveCostingPolicy, input: CostingDimensionInput): string {
    const parts = [input.organizationId, input.productId];
    if (policy.costByWarehouse) parts.push(`w:${input.warehouseId ?? '-'}`);
    if (policy.costByCharacteristic) parts.push(`c:${input.characteristicId ?? '-'}`);
    if (policy.costByBatch) parts.push(`b:${input.batchId ?? '-'}`);
    return parts.join('|');
  }
}
