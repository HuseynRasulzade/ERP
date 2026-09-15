import Decimal from 'decimal.js';

/** Shared value types for the costing engine (spec sections 6-11, 88). */

export interface IncomingMovementInput {
  tenantId: string;
  organizationId: string;
  costingKey: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  currencyId?: string | null;
  quantity: Decimal;
  unitCost: Decimal;
  receiptDate: Date;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  sourceMovementId?: string | null;
  provisional?: boolean;
}

export interface OutgoingMovementInput {
  tenantId: string;
  organizationId: string;
  costingKey: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  quantity: Decimal; // positive
  effectiveDate: Date;
  outgoingDocumentType: string;
  outgoingDocumentId: string;
  outgoingDocumentLineId?: string | null;
  outgoingMovementId: string;
  calculationRunId?: string | null;
}

export interface ConsumptionResult {
  totalConsumedQuantity: Decimal;
  totalConsumedCost: Decimal;
  shortfallQuantity: Decimal; // > 0 when there wasn't enough layer coverage (negative-stock scenario)
  breakdown: { costLayerId: string; quantity: Decimal; unitCost: Decimal; cost: Decimal }[];
}

export interface AdditionalCostSplit {
  layerId: string;
  additionalAmount: Decimal;
  remainingShareAmount: Decimal; // capitalized to on-hand inventory
  consumedShareAmount: Decimal; // pushed to COGS (already-sold portion)
  newUnitCost: Decimal;
}
