import { Injectable } from '@nestjs/common';
import { InventoryCostingPolicy } from '@prisma/client';

export interface CostingKeyParts {
  organizationId: string;
  productId: string;
  warehouseId: string | null;
  batchId: string | null;
}

/**
 * InventoryCostingDimensionService (spec section 5) — the ONE place that
 * decides which inventory movements share a cost pool. The quantity
 * register always tracks warehouse/batch/status; the cost pool may be
 * coarser (e.g. organization + product, so Baku and Ganja share one
 * average) depending on policy. Stock status and location are never cost
 * dimensions (spec sections 32-33): re-tagging or moving inside a
 * warehouse never creates a cost event.
 */
@Injectable()
export class InventoryCostingDimensionService {
  resolve(policy: Pick<InventoryCostingPolicy, 'costByWarehouse' | 'costByBatch'>, movement: { organizationId: string; productId: string; warehouseId: string; batchId?: string | null }): CostingKeyParts & { costingKey: string } {
    const parts: CostingKeyParts = {
      organizationId: movement.organizationId,
      productId: movement.productId,
      warehouseId: policy.costByWarehouse ? movement.warehouseId : null,
      batchId: policy.costByBatch ? movement.batchId ?? null : null,
    };
    return { ...parts, costingKey: InventoryCostingDimensionService.keyOf(parts) };
  }

  static keyOf(parts: CostingKeyParts): string {
    return [parts.organizationId, parts.productId, parts.warehouseId ?? '*', parts.batchId ?? '*'].join('|');
  }

  static parse(costingKey: string): CostingKeyParts {
    const [organizationId, productId, warehouseId, batchId] = costingKey.split('|');
    return { organizationId, productId, warehouseId: warehouseId === '*' ? null : warehouseId, batchId: batchId === '*' ? null : batchId };
  }

  isFinancial(policy: Pick<InventoryCostingPolicy, 'financialOwnershipTypes'>, ownershipType: string): boolean {
    const types = policy.financialOwnershipTypes && policy.financialOwnershipTypes.length > 0 ? policy.financialOwnershipTypes : ['OWN'];
    return types.includes(ownershipType);
  }
}
