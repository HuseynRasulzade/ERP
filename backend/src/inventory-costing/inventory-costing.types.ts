import Decimal from 'decimal.js';

/** Shared context/strategy contracts (spec section 88 — Strategy pattern:
 * FIFOCostingStrategy and WeightedAverageCostingStrategy both implement
 * this so a future costing method never has to touch the orchestrator). */

export interface IncomingCostContext {
  tenantId: string;
  organizationId: string;
  costingKey: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  inventoryMovementId: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  effectiveDate: Date;
  postingDate: Date;
  quantity: Decimal; // positive
  unitCost: Decimal;
  currencyId: string;
}

export interface OutgoingCostContext {
  tenantId: string;
  organizationId: string;
  costingKey: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  inventoryMovementId: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  effectiveDate: Date;
  postingDate: Date;
  quantity: Decimal; // positive
  currencyId: string;
}

export interface OutgoingCostResult {
  unitCost: Decimal;
  totalCost: Decimal;
  costStatus: 'FINAL' | 'PROVISIONAL';
}

export interface InventoryCostingStrategy {
  processIncomingMovement(ctx: IncomingCostContext, tx: any): Promise<void>;
  calculateOutgoingCost(ctx: OutgoingCostContext, tx: any): Promise<OutgoingCostResult | null>;
}
