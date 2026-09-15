import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { INVENTORY_ADJUSTMENT_TYPE } from '../warehouse-inventory/inventory-adjustment.repository';

/**
 * InventoryCountAdjustmentService (spec sections 50-56). Materializes and
 * posts a Phase 10 `InventoryAdjustment` (WRITE_OFF for a net shortage,
 * SURPLUS for a net surplus) from an approved
 * `InventoryVarianceDecision` — going through `DocumentPostingService.post`
 * exactly like any other document in this codebase (spec section 57's own
 * transactional posting checklist: permission, period, movement
 * consistency, cost determination, accounting — all already enforced by
 * the generic posting pipeline + `InventoryAdjustmentPostingHandler`'s own
 * Phase 11 wiring, see docs/INVENTORY_COSTING.md).
 *
 * Disclosed simplification (spec section 50): `LOCATION_TRANSFER` and
 * `STATUS_TRANSFER` resolution types still post as a WRITE_OFF/SURPLUS
 * `InventoryAdjustment` here (tagged `reasonCode` for traceability)
 * rather than a true `WarehouseTransfer`(`INTERNAL_LOCATION_TRANSFER`)/
 * `InventoryStatusTransfer` pairing two variance rows together — that
 * pairing is a follow-up; the financial correctness (spec sections 52-53)
 * is unaffected either way since transfers/status changes have no
 * accounting consequence.
 */
@Injectable()
export class InventoryCountAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly posting: DocumentPostingService,
  ) {}

  /** Creates AND posts one InventoryAdjustment line document for a single
   * decision. Returns null for NO_ADJUSTMENT/SOURCE_DOCUMENT_CORRECTION
   * (spec section 46 — those never touch stock through this path). */
  async postFromDecision(
    tenantId: string,
    userId: string,
    input: {
      organizationId: string;
      sessionId: string;
      warehouseId: string;
      productId: string;
      unitId: string;
      batchId?: string | null;
      acceptedDifference: Decimal; // signed: + surplus, - shortage
      resolutionType: string;
      reasonCode?: string | null;
      approvedCost?: Decimal | null;
    },
  ): Promise<{ id: string } | null> {
    if (['NO_ADJUSTMENT', 'SOURCE_DOCUMENT_CORRECTION'].includes(input.resolutionType)) return null;
    if (input.acceptedDifference.isZero()) return null;

    const isSurplus = input.acceptedDifference.gt(0);
    const adjustmentType = isSurplus ? 'SURPLUS' : 'WRITE_OFF';

    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, INVENTORY_ADJUSTMENT_TYPE, new Date(), tx);
      const header = await tx.inventoryAdjustment.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          warehouseId: input.warehouseId,
          adjustmentType,
          reasonCode: input.reasonCode ?? undefined,
          sourceInventoryCountSessionId: input.sessionId,
          number: allocated.formatted,
          documentDate: new Date(),
          description: `Inventory count adjustment — ${input.resolutionType}`,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await tx.inventoryAdjustmentLine.create({
        data: {
          tenantId,
          inventoryAdjustmentId: header.id,
          position: 0,
          productId: input.productId,
          unitId: input.unitId,
          quantity: input.acceptedDifference.abs().toString(),
          batchId: input.batchId ?? undefined,
          costReference: input.approvedCost != null ? input.approvedCost.mul(input.acceptedDifference.abs()).toDecimalPlaces(2).toString() : undefined,
          description: `Count session variance — ${input.resolutionType}`,
        },
      });
      return header;
    }).then(async (header) => {
      await this.posting.post(tenantId, INVENTORY_ADJUSTMENT_TYPE, header.id, 1, userId);
      return header;
    });
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INVENTORY_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INVENTORY_ADJUSTMENT_TYPE, documentType: INVENTORY_ADJUSTMENT_TYPE, prefix: 'IADJ', padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
