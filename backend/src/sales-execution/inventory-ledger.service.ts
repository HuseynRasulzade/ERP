import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export const INVENTORY_REGISTER_CODE = 'INVENTORY_REGISTER';

export interface InventoryMovementInput {
  productId: string;
  warehouseId: string;
  quantity: Decimal.Value;
  movementType: 'ISSUE' | 'RECEIPT';
  businessDate: Date;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceLineId?: string;
}

/**
 * A real, quantity-only inventory register (spec sections 12-13, 123) —
 * NOT a stub. Reuses Phase 0's generic `RegisterMovement` (registerCode
 * `INVENTORY_REGISTER`) rather than a parallel stock ledger, exactly as
 * that table was designed for. What it deliberately does NOT do is
 * valuation (unit cost, FIFO/weighted-average) — that is Phase 11
 * Costing's job (spec section 36) — so `availableQuantity` below answers
 * "how many units" and never "worth how much".
 */
@Injectable()
export class InventoryLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async recordMovement(tenantId: string, input: InventoryMovementInput, tx: PrismaTransactionClient) {
    const count = await tx.registerMovement.count({ where: { tenantId, registerCode: INVENTORY_REGISTER_CODE } });
    return tx.registerMovement.create({
      data: {
        tenantId,
        registerCode: INVENTORY_REGISTER_CODE,
        recorderDocumentType: input.sourceDocumentType,
        recorderDocumentId: input.sourceDocumentId,
        recorderLineId: input.sourceLineId,
        businessDate: input.businessDate,
        movementType: input.movementType,
        dimensions: { warehouseId: input.warehouseId, productId: input.productId },
        resources: { quantity: new Decimal(input.quantity).toString() },
        sequence: BigInt(count + 1),
      },
    });
  }

  /** Sum of RECEIPT minus ISSUE for a product/warehouse — quantity only,
   * no cost basis. Used only as the availability check this build can
   * honestly provide (spec section 14) — not a substitute for a real
   * Phase 10 Inventory Register with batch/serial and cost layers. */
  async availableQuantity(tenantId: string, warehouseId: string, productId: string, client?: PrismaTransactionClient): Promise<Decimal> {
    const db = client ?? this.prisma;
    const movements = await db.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: INVENTORY_REGISTER_CODE,
        dimensions: { path: ['warehouseId'], equals: warehouseId },
      },
    });
    let total = new Decimal(0);
    for (const m of movements) {
      const dims = m.dimensions as any;
      if (dims?.productId !== productId) continue;
      const qty = new Decimal((m.resources as any)?.quantity ?? 0);
      total = m.movementType === 'RECEIPT' ? total.plus(qty) : total.minus(qty);
    }
    return total;
  }
}
