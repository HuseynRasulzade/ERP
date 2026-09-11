import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_STATUS_TRANSFER_TYPE } from './inventory-status-transfer.repository';
import { InventoryMovementService } from './inventory-movement.service';
import { StockAvailabilityService } from './stock-availability.service';

/**
 * Posting handler for InventoryStatusTransfer (spec section 26) — e.g.
 * Available -> Quarantine. Quantity never leaves the warehouse; only
 * `stockStatus` changes, via a STATUS_CHANGE_OUT/STATUS_CHANGE_IN
 * movement pair at the same warehouse/location. Never an accounting
 * consequence (no valuation change, no quantity change — see
 * docs/WAREHOUSE_INVENTORY.md).
 */
@Injectable()
export class InventoryStatusTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = INVENTORY_STATUS_TRANSFER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: InventoryMovementService,
    private readonly availability: StockAvailabilityService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.inventoryStatusTransfer.findFirst({ where: { id: document.id, tenantId }, include: { lines: true, warehouse: true } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    if (transfer.lines.length === 0) throw new ValidationAppError('Cannot post an inventory status transfer with no lines');

    for (const line of transfer.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a status transfer line with non-positive quantity');
      if (line.fromStatus === line.toStatus) throw new ValidationAppError('Source and destination status must differ');
      const product = await tx.product.findFirst({ where: { id: line.productId, tenantId } });
      if (!product) throw new ValidationAppError('Status transfer line references an unknown product');

      await this.movements.lockStockKey(tx, tenantId, transfer.warehouseId, line.productId, line.batchId);
      const available = await this.availability.getPhysicalStock(tenantId, transfer.warehouseId, line.productId, { batchId: line.batchId ?? undefined, stockStatus: line.fromStatus }, tx);
      if (new Decimal(line.quantity.toString()).gt(available)) {
        throw new ValidationAppError(`Warehouse ${transfer.warehouse.code} has only ${available.toFixed(6)} units of ${product.code} in status ${line.fromStatus}; ${line.quantity.toString()} were requested`);
      }
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const transfer = await tx.inventoryStatusTransfer.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    for (const line of transfer.lines) {
      await this.movements.recordMovement(
        tenantId,
        {
          organizationId: transfer.organizationId,
          warehouseId: transfer.warehouseId,
          productId: line.productId,
          unitId: line.unitId,
          batchId: line.batchId,
          stockStatus: line.fromStatus,
          movementType: 'STATUS_CHANGE_OUT',
          quantity: new Decimal(line.quantity.toString()).negated(),
          effectiveDate: businessDate,
          registrarDocumentType: INVENTORY_STATUS_TRANSFER_TYPE,
          registrarDocumentId: transfer.id,
          registrarLineId: line.id,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );
      await this.movements.recordMovement(
        tenantId,
        {
          organizationId: transfer.organizationId,
          warehouseId: transfer.warehouseId,
          productId: line.productId,
          unitId: line.unitId,
          batchId: line.batchId,
          stockStatus: line.toStatus,
          movementType: 'STATUS_CHANGE_IN',
          quantity: new Decimal(line.quantity.toString()),
          effectiveDate: businessDate,
          registrarDocumentType: INVENTORY_STATUS_TRANSFER_TYPE,
          registrarDocumentId: transfer.id,
          registrarLineId: line.id,
          createdBy: document.postedBy ?? document.createdBy ?? undefined,
        },
        tx,
      );
    }

    return null;
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.movements.deleteMovementsFor(tenantId, INVENTORY_STATUS_TRANSFER_TYPE, document.id, tx);
  }
}
