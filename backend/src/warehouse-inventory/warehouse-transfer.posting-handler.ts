import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { TransferUnpostBlockedError, ValidationAppError } from '../common/errors/app-error';
import { WAREHOUSE_TRANSFER_TYPE } from './warehouse-transfer.repository';
import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

/**
 * Posting handler for WarehouseTransfer (spec sections 11-13). Never
 * touches accounting — an internal transfer moves the SAME stock at the
 * SAME cost basis between two warehouses/locations of the same tenant, no
 * P&L or balance-sheet consequence beyond the quantity itself (disclosed
 * in docs/WAREHOUSE_INVENTORY.md).
 *
 * INSTANT: one TRANSFER_OUT at source (AVAILABLE) + one TRANSFER_IN at
 * destination (AVAILABLE), same transaction — the transfer never leaves
 * a state where the goods exist nowhere.
 *
 * TWO_STEP: post = ship — TRANSFER_OUT at source (AVAILABLE) and
 * TRANSFER_IN at destination with stockStatus=IN_TRANSIT (spec section
 * 10: in-transit stock is modeled as a status column at the destination
 * warehouse, not a separate pseudo-warehouse). The bespoke `receive`
 * command (WarehouseTransferService.receive) later moves some/all of
 * that IN_TRANSIT quantity to AVAILABLE — see there for that half.
 *
 * INTERNAL_LOCATION_TRANSFER: source = destination warehouse, movement
 * pair differs only by `locationId` (spec section 13 folded in here
 * rather than a separate document, since it is the same header/lines
 * shape as INSTANT with sourceWarehouseId === destinationWarehouseId).
 */
@Injectable()
export class WarehouseTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = WAREHOUSE_TRANSFER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
    private readonly costing: InventoryCostingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.warehouseTransfer.findFirst({ where: { id: document.id, tenantId }, include: { lines: true, sourceWarehouse: true } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    if (transfer.lines.length === 0) throw new ValidationAppError('Cannot post a warehouse transfer with no lines');
    if (transfer.transferType !== 'INTERNAL_LOCATION_TRANSFER' && transfer.sourceWarehouseId === transfer.destinationWarehouseId) {
      throw new ValidationAppError('Source and destination warehouse must differ for a warehouse-to-warehouse transfer');
    }

    for (const line of transfer.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a transfer line with non-positive quantity');
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Transfer line references an unknown product');

      await this.movements.lockStockKey(tx, tenantId, transfer.sourceWarehouseId, line.productId, line.batchId);
      await this.availability.validateAvailability(
        tenantId,
        transfer.sourceWarehouseId,
        transfer.sourceWarehouse.code,
        line.productId,
        product.code,
        new Decimal(line.quantity.toString()),
        transfer.sourceWarehouse.allowNegativeStock,
        { batchId: line.batchId ?? undefined },
        tx,
      );
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const transfer = await tx.warehouseTransfer.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const destinationStockStatus = transfer.transferType === 'TWO_STEP' ? 'IN_TRANSIT' : 'AVAILABLE';

    for (const line of transfer.lines) {
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Transfer line references an unknown product');

      const outMovement = await this.movements.recordMovement(
        tenantId,
        {
          organizationId: transfer.organizationId,
          warehouseId: transfer.sourceWarehouseId,
          locationId: line.sourceLocationId,
          productId: line.productId,
          unitId: line.unitId,
          batchId: line.batchId,
          stockStatus: 'AVAILABLE',
          movementType: 'TRANSFER_OUT',
          quantity: new Decimal(line.quantity.toString()).negated(),
          effectiveDate: businessDate,
          registrarDocumentType: WAREHOUSE_TRANSFER_TYPE,
          registrarDocumentId: transfer.id,
          registrarLineId: line.id,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );

      const inMovement = await this.movements.recordMovement(
        tenantId,
        {
          organizationId: transfer.organizationId,
          warehouseId: transfer.destinationWarehouseId,
          locationId: line.destinationLocationId,
          productId: line.productId,
          unitId: line.unitId,
          batchId: line.batchId,
          stockStatus: destinationStockStatus,
          movementType: 'TRANSFER_IN',
          quantity: new Decimal(line.quantity.toString()),
          effectiveDate: businessDate,
          registrarDocumentType: WAREHOUSE_TRANSFER_TYPE,
          registrarDocumentId: transfer.id,
          registrarLineId: line.id,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );

      // Phase 11 cost preservation (spec sections 30-32): the SAME unit
      // cost moves from the source costing key to the destination one —
      // never a fresh average, never a new economic value. A no-op when
      // the policy doesn't cost by warehouse (both sides already share
      // one costing key). IN_TRANSIT vs AVAILABLE at the destination is a
      // Phase 10 quantity-status concept only; this build moves the cost
      // immediately rather than modeling a separate transit cost pool
      // (disclosed simplification of spec section 31's "Transit
      // Inventory" account).
      if (transfer.sourceWarehouseId !== transfer.destinationWarehouseId) {
        await this.costing.transferCost(
          tenantId,
          {
            organizationId: transfer.organizationId,
            productId: line.productId,
            batchId: line.batchId,
            sourceWarehouseId: transfer.sourceWarehouseId,
            destinationWarehouseId: transfer.destinationWarehouseId,
            quantity: line.quantity.toString(),
            effectiveDate: businessDate,
            sourceDocumentType: WAREHOUSE_TRANSFER_TYPE,
            sourceDocumentId: transfer.id,
            sourceLineId: line.id,
            sourceOutMovementId: outMovement.id,
            destInMovementId: inMovement.id,
          },
          tx,
        );
      }
    }

    // Never a financial consequence — see class doc.
    return null;
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.warehouseTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (transfer && (transfer.transferStatus === 'PARTIALLY_RECEIVED' || transfer.transferStatus === 'RECEIVED')) {
      throw new TransferUnpostBlockedError(
        transfer.transferStatus === 'RECEIVED'
          ? 'Cannot unpost a transfer that has already been fully received'
          : 'Cannot unpost a transfer that has already been partially received — the destination has already consumed part of the in-transit stock',
      );
    }
    if (await this.costing.hasDownstreamConsumption(tenantId, WAREHOUSE_TRANSFER_TYPE, document.id, tx)) {
      throw new TransferUnpostBlockedError('the destination cost layer this transfer created has already been consumed by a later inventory movement — unpost that movement first');
    }
    await this.costing.reverseOutgoing(tenantId, WAREHOUSE_TRANSFER_TYPE, document.id, tx);
    await this.costing.reverseIncoming(tenantId, transfer?.organizationId ?? document.organizationId!, WAREHOUSE_TRANSFER_TYPE, document.id, document.postingDate ?? document.documentDate, tx);
    await this.movements.deleteMovementsFor(tenantId, WAREHOUSE_TRANSFER_TYPE, document.id, tx);
    // Reset any partial receivedQuantity progress written before this unpost.
    await tx.warehouseTransferLine.updateMany({ where: { warehouseTransferId: document.id, tenantId }, data: { receivedQuantity: '0' } });
  }
}
