import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ShipmentInsufficientStockError, ShipmentQuantityExceedsRemainingError, ValidationAppError } from '../common/errors/app-error';
import { SHIPMENT_TYPE } from './shipment.repository';
import { SALES_ORDER_TYPE } from '../sales-documents/sales-order.repository';
import { InventoryLedgerService } from './inventory-ledger.service';
import { ReservationService } from '../sales-preorder/reservation.service';
import { OrderFulfillmentService } from '../sales-preorder/order-fulfillment.service';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

/**
 * Posting handler for Shipment (spec sections 3, 12-18). Deliberately
 * carries NO GL consequence (`buildAccountingBatch` always returns
 * `null`) — COGS is deferred (spec section 38: `CostingService` returns
 * no authoritative cost in this build, see costing.service.ts), and the
 * spec's own boundary (section 123) keeps physical inventory movement
 * here separate from the GL. `buildAccountingBatch` is still the right
 * home for this handler's real side effects (its docstring explicitly
 * allows them, unlike `buildMovements`): recording ISSUE inventory
 * movements, consuming any active reservation for each source order line
 * (spec section 15), and writing the `ORDER_TO_SHIPMENT` `DocumentLineLink`
 * `OrderFulfillmentService` already knows how to aggregate. `buildMovements`
 * stays pure and only emits the generic per-line register entry every
 * other document type in this codebase also writes.
 */
@Injectable()
export class ShipmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = SHIPMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryLedgerService,
    private readonly reservations: ReservationService,
    private readonly fulfillment: OrderFulfillmentService,
    private readonly batchSerial: BatchSerialService,
    private readonly costing: InventoryCostingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const shipment = await tx.shipment.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!shipment) throw new ValidationAppError('Document disappeared during posting');
    if (shipment.lines.length === 0) throw new ValidationAppError('Cannot post a shipment with no lines');

    const counterparty = await tx.counterparty.findFirst({ where: { id: shipment.counterpartyId, tenantId } });
    if (!counterparty || !counterparty.active) {
      throw new ValidationAppError('Cannot post a shipment for a missing or inactive counterparty');
    }
    const warehouse = await tx.warehouse.findFirst({ where: { id: shipment.warehouseId, tenantId } });
    if (!warehouse || !warehouse.active) {
      throw new ValidationAppError('Cannot post a shipment for a missing or inactive warehouse');
    }

    for (const line of shipment.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a shipment line with non-positive quantity');

      if (line.sourceOrderLineId) {
        const orderLine = await tx.salesOrderLine.findFirst({ where: { id: line.sourceOrderLineId, tenantId } });
        if (!orderLine) throw new ValidationAppError(`Source order line not found: ${line.sourceOrderLineId}`);

        const alreadyShipped = await tx.documentLineLink.aggregate({
          where: { tenantId, sourceDocumentType: SALES_ORDER_TYPE, sourceLineId: orderLine.id, relationType: 'ORDER_TO_SHIPMENT' },
          _sum: { quantity: true },
        });
        const remaining = new Decimal(orderLine.quantity.toString())
          .minus(orderLine.cancelledQuantity.toString())
          .minus((alreadyShipped._sum.quantity ?? 0).toString());
        if (new Decimal(line.quantity.toString()).gt(remaining)) {
          throw new ShipmentQuantityExceedsRemainingError(remaining.toFixed(6), line.quantity.toString());
        }
      }

      // Availability check (spec section 14) — quantity-only, this
      // build's honest substitute for a real Phase 10 stock check.
      const available = await this.inventory.availableQuantity(tenantId, line.warehouseId ?? shipment.warehouseId, line.productId, tx);
      if (!warehouse.allowNegativeStock && available.lt(line.quantity.toString())) {
        throw new ShipmentInsufficientStockError(line.productId, available.toFixed(6), line.quantity.toString());
      }
    }
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const shipment = await tx.shipment.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!shipment) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return shipment.lines.map((line) => ({
      registerCode: 'SHIPMENT_REGISTER',
      recorderLineId: line.id,
      businessDate,
      movementType: 'SHIPMENT_LINE',
      dimensions: {
        organizationId: document.organizationId ?? null,
        counterpartyId: shipment.counterpartyId,
        warehouseId: line.warehouseId ?? shipment.warehouseId,
        productId: line.productId,
      },
      resources: { quantity: line.quantity.toString(), sourceOrderLineId: line.sourceOrderLineId },
    }));
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const shipment = await tx.shipment.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!shipment) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    for (const line of shipment.lines) {
      const warehouseId = line.warehouseId ?? shipment.warehouseId;
      const capturedSerials = await this.batchSerial.getCapturedSerials(tenantId, SHIPMENT_TYPE, line.id, tx);

      if (capturedSerials.length > 0) {
        const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, tenantId } });
        const serialIds = await this.batchSerial.issueSerials(tenantId, shipment.organizationId, line.productId, warehouseId, warehouse?.code ?? warehouseId, SHIPMENT_TYPE, line.id, tx);
        for (const serialId of serialIds) {
          const movement = await this.inventory.recordMovement(
            tenantId,
            { productId: line.productId, warehouseId, quantity: '1', movementType: 'ISSUE', businessDate, sourceDocumentType: SHIPMENT_TYPE, sourceDocumentId: shipment.id, sourceLineId: line.id, batchId: line.batchId, serialId },
            tx,
          );
          await this.costing.calculateOutgoingCost(
            tenantId,
            { organizationId: shipment.organizationId, productId: line.productId, warehouseId, batchId: line.batchId, quantity: '1', effectiveDate: businessDate, outgoingDocumentType: SHIPMENT_TYPE, outgoingDocumentId: shipment.id, outgoingDocumentLineId: line.id, outgoingMovementId: movement.id },
            tx,
          );
        }
      } else {
        const movement = await this.inventory.recordMovement(
          tenantId,
          {
            productId: line.productId,
            warehouseId,
            quantity: line.quantity.toString(),
            movementType: 'ISSUE',
            businessDate,
            sourceDocumentType: SHIPMENT_TYPE,
            sourceDocumentId: shipment.id,
            sourceLineId: line.id,
            batchId: line.batchId,
          },
          tx,
        );
        // Phase 11 COGS pricing (spec section 24) — priced right here, at
        // physical issue, not deferred to the Sales Invoice. This is the
        // "Immediate provisional COGS" model (spec section 25);
        // `CostingService.getUnitCost` reads the result back for the
        // invoice's own Dr COGS / Cr Inventory posting.
        await this.costing.calculateOutgoingCost(
          tenantId,
          { organizationId: shipment.organizationId, productId: line.productId, warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), effectiveDate: businessDate, outgoingDocumentType: SHIPMENT_TYPE, outgoingDocumentId: shipment.id, outgoingDocumentLineId: line.id, outgoingMovementId: movement.id },
          tx,
        );
      }

      if (line.sourceOrderLineId) {
        await tx.documentLineLink.create({
          data: {
            tenantId,
            sourceDocumentType: SALES_ORDER_TYPE,
            sourceDocumentId: shipment.customerOrderId!,
            sourceLineId: line.sourceOrderLineId,
            targetDocumentType: SHIPMENT_TYPE,
            targetDocumentId: shipment.id,
            targetLineId: line.id,
            quantity: line.quantity,
            relationType: 'ORDER_TO_SHIPMENT',
          },
        });
        await this.reservations.consumeForLine(tenantId, line.sourceOrderLineId, new Decimal(line.quantity.toString()), tx);
      }
    }

    if (shipment.customerOrderId) {
      await this.fulfillment.recomputeOrderStatuses(tenantId, shipment.customerOrderId, tx);
    }

    return null; // no GL consequence — see class docstring
  }

  /**
   * Symmetric undo for unpost (spec section 17): removes the ISSUE
   * inventory movements and `ORDER_TO_SHIPMENT` links this handler wrote,
   * and restores reservation coverage. Restoration creates a fresh ACTIVE
   * reservation for the un-shipped quantity rather than reconstructing
   * the exact original reservation rows `consumeForLine` may have split
   * across (documented simplification — net quantity is correct, the
   * original reservation's own id/history is not resurrected).
   */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const shipment = await tx.shipment.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!shipment) return;

    await this.costing.reverseOutgoing(tenantId, SHIPMENT_TYPE, shipment.id, tx);
    await this.inventory.deleteMovementsFor(tenantId, SHIPMENT_TYPE, shipment.id, tx);
    for (const line of shipment.lines) {
      await this.batchSerial.undoIssuedSerials(tenantId, SHIPMENT_TYPE, [line.id], line.warehouseId ?? shipment.warehouseId, tx);
    }

    for (const line of shipment.lines) {
      if (!line.sourceOrderLineId) continue;

      const link = await tx.documentLineLink.findFirst({
        where: { tenantId, targetDocumentType: SHIPMENT_TYPE, targetDocumentId: shipment.id, targetLineId: line.id, relationType: 'ORDER_TO_SHIPMENT' },
      });
      await tx.documentLineLink.deleteMany({
        where: { tenantId, targetDocumentType: SHIPMENT_TYPE, targetDocumentId: shipment.id, targetLineId: line.id, relationType: 'ORDER_TO_SHIPMENT' },
      });

      if (link) {
        const orderLine = await tx.salesOrderLine.findFirst({ where: { id: line.sourceOrderLineId, tenantId } });
        if (orderLine && orderLine.reservationPolicy !== 'NONE') {
          await tx.stockReservation.create({
            data: {
              tenantId,
              organizationId: shipment.organizationId,
              sourceDocumentType: SALES_ORDER_TYPE,
              sourceDocumentId: shipment.customerOrderId ?? orderLine.salesOrderId,
              sourceLineId: orderLine.id,
              productId: orderLine.productId,
              warehouseId: line.warehouseId ?? shipment.warehouseId,
              quantity: link.quantity,
              status: 'ACTIVE',
            },
          });
        }
      }
    }

    if (shipment.customerOrderId) {
      await this.fulfillment.recomputeOrderStatuses(tenantId, shipment.customerOrderId, tx);
    }
  }
}
