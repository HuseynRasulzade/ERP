import Decimal from 'decimal.js';
import { InventoryCostingPolicy } from '@prisma/client';
import { PrismaTransactionClient } from '../prisma/prisma.service';

export interface CostEventContext {
  tenantId: string;
  organizationId: string;
  costingKey: string;
  productId: string;
  warehouseId?: string | null;
  batchId?: string | null;
  currencyId?: string | null;
  policy: InventoryCostingPolicy;
}

export interface ReceiveInput {
  quantity: Decimal; // positive
  unitCost: Decimal;
  effectiveDate: Date;
  sourceReceiptDocumentType?: string;
  sourceReceiptDocumentId?: string;
  sourceReceiptLineId?: string;
  sourceInventoryMovementId?: string | null;
}

export interface ReceiveResult {
  unitCost: Decimal;
  totalCost: Decimal;
  layerId?: string;
}

export interface ConsumeInput {
  quantity: Decimal; // positive magnitude to consume
  effectiveDate: Date;
  outgoingInventoryMovementId?: string | null;
  outgoingDocumentType: string;
  outgoingDocumentId: string;
  outgoingDocumentLineId?: string | null;
  /** Purchase-return-to-supplier / sales-return-restore hint: consume this
   * exact layer (spec section 28) rather than blind FIFO order. */
  preferSourceLayerId?: string | null;
  allowNegative: boolean;
}

export interface ConsumptionDetail {
  costLayerId?: string;
  quantity: Decimal;
  unitCost: Decimal;
  cost: Decimal;
}

export interface ConsumeResult {
  totalCost: Decimal;
  details: ConsumptionDetail[];
  provisional: boolean;
}

/**
 * InventoryCostingStrategy (spec section 88) — the abstraction that keeps
 * the FIFO/Weighted-Average distinction out of every call site. Adding
 * SPECIFIC_IDENTIFICATION/STANDARD_COST/MOVING_AVERAGE-as-a-distinct-method
 * later means one new class, never touching InventoryCostingService.
 */
export interface InventoryCostingStrategy {
  receive(ctx: CostEventContext, input: ReceiveInput, tx: PrismaTransactionClient): Promise<ReceiveResult>;
  consume(ctx: CostEventContext, input: ConsumeInput, tx: PrismaTransactionClient): Promise<ConsumeResult>;
  /** Best-effort "what would the next unit cost" / reporting snapshot — never
   * authoritative for a specific already-posted movement's own cost (that is
   * always read back from InventoryCostConsumption/InventoryCostMovement). */
  currentUnitCost(ctx: CostEventContext, asOfDate: Date, tx: PrismaTransactionClient): Promise<Decimal | null>;
}
