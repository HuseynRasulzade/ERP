import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { GoodsReceiptHasDownstreamLinksError, ReceiptQuantityExceedsRemainingError, ValidationAppError } from '../common/errors/app-error';
import { GOODS_RECEIPT_TYPE } from './goods-receipt.repository';
import { PURCHASE_ORDER_TYPE } from '../procurement/purchase-order.repository';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { InventoryLedgerService } from '../sales-execution/inventory-ledger.service';
import { PurchaseFulfillmentService, RelationTypes } from './purchase-fulfillment.service';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';

/**
 * Posting handler for GoodsReceipt (spec sections 3-5). Real physical
 * inventory RECEIPT movement (reuses `InventoryLedgerService` — one
 * quantity-only stock ledger for the whole platform) plus, per spec
 * section 5's "Model A", a real Accounting Core consequence:
 *
 *   Dr Inventory Received (GOODS_INVENTORY)      lineTotal
 *   Cr Goods Received Not Invoiced (GRNI clearing) lineTotal
 *
 * This build supports ONLY Model A (Goods Receipt posts a GRNI clearing
 * liability that PurchaseInvoicePostingHandler later clears) — the spec's
 * Model B ("Receipt is inventory-only, Invoice posts everything") is a
 * disclosed simplification not implemented, see docs/PURCHASE_EXECUTION.md.
 * No input VAT is posted here (spec section 6: VAT is a legal/tax event
 * that belongs to the Purchase Invoice, not the physical receipt).
 */
@Injectable()
export class GoodsReceiptPostingHandler implements DocumentPostingHandler {
  readonly documentType = GOODS_RECEIPT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly inventory: InventoryLedgerService,
    private readonly fulfillment: PurchaseFulfillmentService,
    private readonly batchSerial: BatchSerialService,
    private readonly costing: InventoryCostingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const receipt = await tx.goodsReceipt.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!receipt) throw new ValidationAppError('Document disappeared during posting');
    if (receipt.lines.length === 0) throw new ValidationAppError('Cannot post a goods receipt with no lines');

    const supplier = await tx.counterparty.findFirst({ where: { id: receipt.counterpartyId, tenantId } });
    if (!supplier || !supplier.active) throw new ValidationAppError('Cannot post a goods receipt for a missing or inactive supplier');
    const warehouse = await tx.warehouse.findFirst({ where: { id: receipt.warehouseId, tenantId } });
    if (!warehouse || !warehouse.active) throw new ValidationAppError('Cannot post a goods receipt for a missing or inactive warehouse');

    for (const line of receipt.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a goods receipt line with non-positive quantity');

      // Server-side re-check (spec section 22): never trust a
      // client-computed "remaining" — recompute from the database inside
      // this same posting transaction.
      if (line.supplierOrderLineId) {
        const remaining = await this.fulfillment.remainingToReceive(tenantId, line.supplierOrderLineId, tx);
        if (new Decimal(line.quantity.toString()).gt(remaining)) {
          throw new ReceiptQuantityExceedsRemainingError(remaining.toFixed(6), line.quantity.toString());
        }
      }
    }
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const receipt = await tx.goodsReceipt.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!receipt) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return receipt.lines.map((line) => ({
      registerCode: 'GOODS_RECEIPT_REGISTER',
      recorderLineId: line.id,
      businessDate,
      movementType: 'GOODS_RECEIPT_LINE',
      dimensions: {
        organizationId: document.organizationId ?? null,
        counterpartyId: receipt.counterpartyId,
        warehouseId: line.warehouseId ?? receipt.warehouseId,
        productId: line.productId,
      },
      resources: { quantity: line.quantity.toString(), price: line.price.toString(), supplierOrderLineId: line.supplierOrderLineId },
    }));
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const receipt = await tx.goodsReceipt.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!receipt) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = receipt.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    for (const line of receipt.lines) {
      const warehouseId = line.warehouseId ?? receipt.warehouseId;
      const capturedSerials = await this.batchSerial.getCapturedSerials(tenantId, GOODS_RECEIPT_TYPE, line.id, tx);

      // Phase 11 costing input (spec section 17): the receipt line's own
      // price is the initial cost source in this build — a purchase
      // invoice posted later corrects it via a real
      // AdditionalCostCapitalizationService-style adjustment on the same
      // layer (see PurchaseInvoicePostingHandler boundary in
      // docs/INVENTORY_COSTING.md: this build does not yet post a price
      // variance from the invoice itself, only from AdditionalPurchaseCost).
      const unitCost = line.price.gt(0) ? line.price.toString() : null;

      if (capturedSerials.length > 0) {
        // Serial-tracked line: one InventoryMovement per unit (spec
        // section 23) — resolve/create the real SerialNumber rows now
        // that the receipt is actually posting.
        const serialIds = await this.batchSerial.receiveSerials(tenantId, organizationId, line.productId, warehouseId, undefined, GOODS_RECEIPT_TYPE, line.id, tx);
        for (const serialId of serialIds) {
          const movement = await this.inventory.recordMovement(
            tenantId,
            { productId: line.productId, warehouseId, quantity: '1', movementType: 'RECEIPT', businessDate, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: receipt.id, sourceLineId: line.id, batchId: line.batchId, serialId },
            tx,
          );
          await this.costing.processIncomingMovement(
            tenantId,
            { organizationId, productId: line.productId, warehouseId, batchId: line.batchId, currencyId: receipt.currencyId, quantity: '1', unitCost, effectiveDate: businessDate, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: receipt.id, sourceDocumentLineId: line.id, sourceMovementId: movement.id },
            tx,
          );
        }
      } else {
        const movement = await this.inventory.recordMovement(
          tenantId,
          { productId: line.productId, warehouseId, quantity: line.quantity.toString(), movementType: 'RECEIPT', businessDate, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: receipt.id, sourceLineId: line.id, batchId: line.batchId },
          tx,
        );
        await this.costing.processIncomingMovement(
          tenantId,
          { organizationId, productId: line.productId, warehouseId, batchId: line.batchId, currencyId: receipt.currencyId, quantity: line.quantity.toString(), unitCost, effectiveDate: businessDate, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: receipt.id, sourceDocumentLineId: line.id, sourceMovementId: movement.id },
          tx,
        );
      }

      if (line.supplierOrderLineId) {
        const orderLine = await tx.purchaseOrderLine.findFirst({ where: { id: line.supplierOrderLineId, tenantId } });
        if (orderLine) {
          await tx.documentLineLink.create({
            data: {
              tenantId,
              sourceDocumentType: PURCHASE_ORDER_TYPE,
              sourceDocumentId: orderLine.purchaseOrderId,
              sourceLineId: orderLine.id,
              targetDocumentType: GOODS_RECEIPT_TYPE,
              targetDocumentId: receipt.id,
              targetLineId: line.id,
              quantity: line.quantity,
              relationType: RelationTypes.SUPPLIER_ORDER_TO_RECEIPT,
              createdBy: document.postedBy ?? document.createdBy ?? undefined,
            },
          });
        }
      }
    }

    const grniTotal = receipt.lines.reduce((sum, l) => sum.plus(l.lineTotal.toString()), new Decimal(0));
    if (grniTotal.lte(0)) return null; // no informational price on any line — inventory-only receipt, no GRNI value to clear later

    const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    const grni = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_RECEIVED_NOT_INVOICED, businessDate, tx);

    let currencyId = receipt.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) throw new ValidationAppError('Cannot post a goods receipt: no currency on the receipt, organization, or tenant');

    const lines: AccountingPostingLineInput[] = [
      { accountId: inventory.id, side: 'DEBIT', amountBase: grniTotal, description: `Goods received — ${receipt.number ?? receipt.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: receipt.lines[0].productId }, { dimensionCode: 'WAREHOUSE', referenceId: receipt.warehouseId }] },
      {
        accountId: grni.id,
        side: 'CREDIT',
        amountBase: grniTotal,
        description: `Goods received not invoiced — ${receipt.number ?? receipt.id}`,
        dimensions: [
          { dimensionCode: 'PARTNER', referenceId: receipt.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: receipt.counterpartyId },
          { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: receipt.id },
          { dimensionCode: 'CURRENCY', referenceId: currencyId },
        ],
      },
    ];

    return { description: `Goods receipt ${receipt.number ?? receipt.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  /** Symmetric undo (spec section 51): removes the RECEIPT inventory
   * movement and SUPPLIER_ORDER_TO_RECEIPT links this handler wrote.
   * Blocked when a posted PurchaseInvoice or PurchaseReturn already
   * references this receipt — "unpost the dependent document first"
   * (spec section 51's own example is exactly this chain). */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const receiptLineIds = (await tx.goodsReceiptLine.findMany({ where: { tenantId, goodsReceiptId: document.id }, select: { id: true } })).map((l) => l.id);
    const dependentInvoiceLine = receiptLineIds.length
      ? await tx.purchaseInvoiceLine.findFirst({
          where: { tenantId, goodsReceiptLineId: { in: receiptLineIds }, purchaseInvoice: { postingStatus: 'POSTED' } },
        })
      : null;
    if (dependentInvoiceLine) throw new GoodsReceiptHasDownstreamLinksError('a posted Purchase Invoice references this receipt — unpost it first');

    const dependentReturn = await tx.purchaseReturn.findFirst({ where: { tenantId, originalGoodsReceiptId: document.id, postingStatus: 'POSTED' } });
    if (dependentReturn) throw new GoodsReceiptHasDownstreamLinksError('a posted Purchase Return references this receipt — unpost it first');

    // Phase 11 dependency block (spec section 110): a FIFO layer this
    // receipt opened may already have been (partially) consumed by a
    // shipment/write-off/internal-consumption — unposting the receipt out
    // from under it would silently corrupt already-recognized COGS.
    if (await this.costing.hasDownstreamConsumption(tenantId, GOODS_RECEIPT_TYPE, document.id, tx)) {
      throw new GoodsReceiptHasDownstreamLinksError('this receipt\'s cost layer has already been (partially) consumed by a later inventory movement — unpost that movement first');
    }
    await this.costing.reverseIncoming(tenantId, document.organizationId!, GOODS_RECEIPT_TYPE, document.id, document.postingDate ?? document.documentDate, tx);

    await this.inventory.deleteMovementsFor(tenantId, GOODS_RECEIPT_TYPE, document.id, tx);
    await this.batchSerial.undoReceivedSerials(tenantId, GOODS_RECEIPT_TYPE, receiptLineIds, tx);
    await tx.documentLineLink.deleteMany({ where: { tenantId, targetDocumentType: GOODS_RECEIPT_TYPE, targetDocumentId: document.id, relationType: RelationTypes.SUPPLIER_ORDER_TO_RECEIPT } });
  }
}
