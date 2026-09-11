import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { InventoryMovementService } from '../warehouse-inventory/inventory-movement.service';
import { StockAvailabilityService } from '../warehouse-inventory/stock-availability.service';

export const INVENTORY_REGISTER_CODE = 'INVENTORY_REGISTER'; // retained as a label for callers/tests; no longer a RegisterMovement registerCode

export interface InventoryMovementInput {
  productId: string;
  warehouseId: string;
  quantity: Decimal.Value;
  movementType: 'ISSUE' | 'RECEIPT';
  businessDate: Date;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceLineId?: string;
  batchId?: string | null;
  serialId?: string | null;
}

const MOVEMENT_TYPE_BY_SOURCE: Record<string, string> = {
  GOODS_RECEIPT: 'PURCHASE_RECEIPT',
  SHIPMENT: 'SALES_SHIPMENT',
  SALES_RETURN: 'SALES_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
};

/**
 * InventoryLedgerService — Sales/Purchase Execution's (Phases 7/9) own
 * call surface, now backed by Phase 10's real `InventoryMovement` table
 * (via `InventoryMovementService`/`StockAvailabilityService`) instead of
 * the generic `RegisterMovement` it originally used. The public
 * signature is UNCHANGED on purpose: `ShipmentPostingHandler`,
 * `GoodsReceiptPostingHandler`, `SalesReturnPostingHandler`, and
 * `PurchaseReturnPostingHandler` all still call `recordMovement`/
 * `availableQuantity` exactly as before — Phase 10 upgraded the engine
 * underneath four already-shipped, already-tested handlers with zero
 * call-site changes, exactly the "vahid Stock Truth Engine" spec section
 * 1 asks for ("bütün sistem ... məhz bu engine və registrlərdən almalıdır").
 * `movementType` maps to the detailed Phase 10 enum by `sourceDocumentType`
 * (see `MOVEMENT_TYPE_BY_SOURCE`); quantity becomes SIGNED (RECEIPT = +,
 * ISSUE = −) in the new register, matching its own convention.
 */
@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
  ) {}

  async recordMovement(tenantId: string, input: InventoryMovementInput, tx: PrismaTransactionClient) {
    const [warehouse, product] = await Promise.all([
      tx.warehouse.findFirst({ where: { id: input.warehouseId, tenantId } }),
      tx.product.findFirst({ where: { id: input.productId, tenantId } }),
    ]);
    if (!warehouse || !product) throw new Error('Warehouse or product not found for inventory movement');

    const signed = input.movementType === 'RECEIPT' ? new Decimal(input.quantity) : new Decimal(input.quantity).neg();
    return this.movements.recordMovement(
      tenantId,
      {
        organizationId: warehouse.organizationId,
        warehouseId: input.warehouseId,
        productId: input.productId,
        unitId: product.baseUnitId,
        batchId: input.batchId ?? undefined,
        serialId: input.serialId ?? undefined,
        movementType: MOVEMENT_TYPE_BY_SOURCE[input.sourceDocumentType] ?? input.movementType,
        quantity: signed,
        effectiveDate: input.businessDate,
        registrarDocumentType: input.sourceDocumentType,
        registrarDocumentId: input.sourceDocumentId,
        registrarLineId: input.sourceLineId,
      },
      tx,
    );
  }

  /** Every movement a document (Shipment/GoodsReceipt/SalesReturn/
   * PurchaseReturn) posted, for use from that document's own
   * `undoSideEffects` on unpost. */
  async deleteMovementsFor(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient) {
    return this.movements.deleteMovementsFor(tenantId, sourceDocumentType, sourceDocumentId, tx);
  }

  /** Available quantity (physical AVAILABLE minus active reservations) —
   * the same honest, quantity-only availability check Phase 7 always
   * exposed here, now reading the real Phase 10 register instead of a
   * quantity-only stand-in. */
  async availableQuantity(tenantId: string, warehouseId: string, productId: string, client?: PrismaTransactionClient): Promise<Decimal> {
    return this.availability.getAvailableStock(tenantId, warehouseId, productId, {}, client);
  }
}
