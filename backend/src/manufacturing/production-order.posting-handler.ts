import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { BOMService } from './bom.service';

/**
 * Posting handler for ProductionOrder (spec sections 23-34). POST means
 * RELEASE: explodes the frozen `bomVersionId` into
 * `ProductionMaterialRequirement` rows (spec sections 28-30) and creates
 * a best-effort `StockReservation` per requirement — a shortage is
 * recorded (`reservationStatus: 'PARTIAL'`/`'NONE'`) rather than blocking
 * release (spec section 34's own "Material shortage production planning
 * signal-dir. Silent negative issue etmə." — the block instead happens
 * later, at `MaterialIssue` posting time, via the normal Phase 10
 * negative-stock rules). No GL consequence — a released order has not
 * yet moved any physical material (spec section 27).
 */
@Injectable()
export class ProductionOrderPostingHandler implements DocumentPostingHandler {
  readonly documentType = 'PRODUCTION_ORDER';

  constructor(private readonly bom: BOMService) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const order = await tx.productionOrder.findFirst({ where: { id: document.id, tenantId }, include: { outputs: true } });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    if (order.outputs.length === 0) throw new ValidationAppError('Cannot release a production order with no planned outputs');
    if (new Decimal(order.plannedOutputQuantity.toString()).lte(0)) throw new ValidationAppError('Planned output quantity must be positive');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const order = await tx.productionOrder.findFirst({ where: { id: document.id, tenantId } });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    const exploded = await this.bom.explode(tenantId, order.bomVersionId, new Decimal(order.plannedOutputQuantity.toString()), businessDate);
    for (const item of exploded) {
      const requirement = await tx.productionMaterialRequirement.create({ data: { tenantId, productionOrderId: order.id, sourceBomLineId: item.sourceBomLineId, componentProductId: item.componentProductId, unitId: item.unitId, requiredQuantity: item.requiredQuantity.toString(), warehouseId: order.outputWarehouseId } });

      const available = await tx.inventoryMovement.aggregate({ where: { tenantId, warehouseId: order.outputWarehouseId, productId: item.componentProductId, stockStatus: 'AVAILABLE' }, _sum: { quantity: true } });
      const reserved = await tx.stockReservation.aggregate({ where: { tenantId, warehouseId: order.outputWarehouseId, productId: item.componentProductId, status: 'ACTIVE' }, _sum: { quantity: true } });
      const freeToReserve = new Decimal((available._sum.quantity ?? 0).toString()).minus((reserved._sum.quantity ?? 0).toString());
      const toReserve = Decimal.min(Decimal.max(freeToReserve, 0), item.requiredQuantity);

      if (toReserve.gt(0)) {
        await tx.stockReservation.create({ data: { tenantId, organizationId: order.organizationId, sourceDocumentType: this.documentType, sourceDocumentId: order.id, sourceLineId: requirement.id, productId: item.componentProductId, warehouseId: order.outputWarehouseId, quantity: toReserve.toString(), createdBy: document.createdBy ?? undefined } });
      }
      await tx.productionMaterialRequirement.update({ where: { id: requirement.id }, data: { reservedQuantity: toReserve.toString(), reservationStatus: toReserve.gte(item.requiredQuantity) ? 'FULL' : toReserve.gt(0) ? 'PARTIAL' : 'NONE' } });
    }

    await tx.productionOrder.update({ where: { id: order.id }, data: { calculationStatus: 'PROVISIONAL' } });
    return null; // no GL consequence — see class doc
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const hasIssues = await tx.materialIssue.count({ where: { tenantId, productionOrderId: document.id, postingStatus: 'POSTED' } });
    if (hasIssues > 0) throw new ValidationAppError('Cannot unpost — this production order already has posted material issues. Reverse those first.');

    await tx.stockReservation.updateMany({ where: { tenantId, sourceDocumentType: this.documentType, sourceDocumentId: document.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    await tx.productionMaterialRequirement.deleteMany({ where: { tenantId, productionOrderId: document.id } });
  }
}
