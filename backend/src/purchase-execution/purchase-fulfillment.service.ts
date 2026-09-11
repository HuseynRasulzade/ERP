import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { PURCHASE_ORDER_TYPE } from '../procurement/purchase-order.repository';
import { NotFoundAppError } from '../common/errors/app-error';

export const GOODS_RECEIPT_TYPE = 'GOODS_RECEIPT';
export const PURCHASE_INVOICE_TYPE = 'PURCHASE_INVOICE';

export const RelationTypes = {
  SUPPLIER_ORDER_TO_RECEIPT: 'SUPPLIER_ORDER_TO_RECEIPT',
  RECEIPT_TO_INVOICE: 'RECEIPT_TO_INVOICE',
  SUPPLIER_ORDER_TO_INVOICE: 'SUPPLIER_ORDER_TO_INVOICE',
  RECEIPT_TO_RETURN: 'RECEIPT_TO_RETURN',
  INVOICE_TO_RETURN: 'INVOICE_TO_RETURN',
} as const;

export interface PurchaseOrderLineFulfillment {
  lineId: string;
  productId: string;
  ordered: Decimal;
  cancelled: Decimal;
  received: Decimal;
  invoiced: Decimal;
  remainingToReceive: Decimal;
  remainingToInvoice: Decimal;
}

/**
 * PurchaseFulfillmentService — the spec's `DocumentFulfillmentService`
 * (section 26), scoped to Purchase (mirrors `OrderFulfillmentService`,
 * Phase 6, exactly). Every quantity is computed LIVE from `DocumentLineLink`
 * — never a stored, independently-editable total — so "ordered/received/
 * invoiced/remaining" can never drift from what actually happened.
 *
 * Simplification (disclosed in docs/PURCHASE_EXECUTION.md): `remaining
 * ToReceive` does not add back returned quantity (spec section 4's own
 * formula is ambiguous on this — "ordered − received − returned" would
 * mean a return re-opens the order, which this build treats as a
 * separate, explicit re-order decision instead of an automatic reopening).
 */
@Injectable()
export class PurchaseFulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  async forPurchaseOrder(tenantId: string, purchaseOrderId: string, tx?: PrismaTransactionClient): Promise<PurchaseOrderLineFulfillment[]> {
    const client = tx ?? this.prisma;
    const order = await client.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!order) throw new NotFoundAppError('PurchaseOrder', purchaseOrderId);

    const results: PurchaseOrderLineFulfillment[] = [];
    for (const line of order.lines) {
      const received = await client.documentLineLink.aggregate({
        where: { tenantId, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceLineId: line.id, relationType: RelationTypes.SUPPLIER_ORDER_TO_RECEIPT },
        _sum: { quantity: true },
      });
      const invoicedDirect = await client.documentLineLink.aggregate({
        where: { tenantId, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceLineId: line.id, relationType: RelationTypes.SUPPLIER_ORDER_TO_INVOICE },
        _sum: { quantity: true },
      });

      const ordered = new Decimal(line.quantity.toString());
      const cancelled = new Decimal(line.cancelledQuantity.toString());
      const receivedQty = new Decimal((received._sum.quantity ?? 0).toString());
      const invoicedQty = new Decimal((invoicedDirect._sum.quantity ?? 0).toString());

      results.push({
        lineId: line.id,
        productId: line.productId,
        ordered,
        cancelled,
        received: receivedQty,
        invoiced: invoicedQty,
        remainingToReceive: ordered.minus(cancelled).minus(receivedQty),
        remainingToInvoice: ordered.minus(cancelled).minus(invoicedQty),
      });
    }
    return results;
  }

  async remainingToReceive(tenantId: string, supplierOrderLineId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    const line = await client.purchaseOrderLine.findFirst({ where: { id: supplierOrderLineId, tenantId } });
    if (!line) return new Decimal(0);
    const received = await client.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceLineId: line.id, relationType: RelationTypes.SUPPLIER_ORDER_TO_RECEIPT },
      _sum: { quantity: true },
    });
    const ordered = new Decimal(line.quantity.toString());
    const cancelled = new Decimal(line.cancelledQuantity.toString());
    return ordered.minus(cancelled).minus(new Decimal((received._sum.quantity ?? 0).toString()));
  }

  /** Remaining invoiceable quantity for a source line, whichever kind it
   * is (spec section 7: computed against the RECEIPT when the invoice is
   * receipt-based, against the SUPPLIER ORDER when it is order-based
   * without a receipt). */
  async remainingToInvoice(tenantId: string, sourceType: 'GOODS_RECEIPT_LINE' | 'SUPPLIER_ORDER_LINE', sourceLineId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    let sourceQuantity: Decimal | null = null;
    let relationType: string;
    let sourceDocumentType: string;

    if (sourceType === 'GOODS_RECEIPT_LINE') {
      const line = await client.goodsReceiptLine.findFirst({ where: { id: sourceLineId, tenantId } });
      if (!line) return new Decimal(0);
      sourceQuantity = new Decimal(line.quantity.toString());
      relationType = RelationTypes.RECEIPT_TO_INVOICE;
      sourceDocumentType = GOODS_RECEIPT_TYPE;
    } else {
      const line = await client.purchaseOrderLine.findFirst({ where: { id: sourceLineId, tenantId } });
      if (!line) return new Decimal(0);
      sourceQuantity = new Decimal(line.quantity.toString()).minus(line.cancelledQuantity.toString());
      relationType = RelationTypes.SUPPLIER_ORDER_TO_INVOICE;
      sourceDocumentType = PURCHASE_ORDER_TYPE;
    }

    const alreadyInvoiced = await client.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType, sourceLineId, relationType },
      _sum: { quantity: true },
    });
    return sourceQuantity.minus(new Decimal((alreadyInvoiced._sum.quantity ?? 0).toString()));
  }

  /** Maximum returnable quantity for a receipt or invoice line (spec
   * section 15): received/invoiced minus already-returned. */
  async maxReturnable(tenantId: string, sourceType: 'GOODS_RECEIPT_LINE' | 'PURCHASE_INVOICE_LINE', sourceLineId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    let baseQuantity: Decimal;
    let relationType: string;
    let sourceDocumentType: string;

    if (sourceType === 'GOODS_RECEIPT_LINE') {
      const line = await client.goodsReceiptLine.findFirst({ where: { id: sourceLineId, tenantId } });
      if (!line) return new Decimal(0);
      baseQuantity = new Decimal(line.quantity.toString());
      relationType = RelationTypes.RECEIPT_TO_RETURN;
      sourceDocumentType = GOODS_RECEIPT_TYPE;
    } else {
      const line = await client.purchaseInvoiceLine.findFirst({ where: { id: sourceLineId, tenantId } });
      if (!line) return new Decimal(0);
      baseQuantity = new Decimal(line.quantity.toString());
      relationType = RelationTypes.INVOICE_TO_RETURN;
      sourceDocumentType = PURCHASE_INVOICE_TYPE;
    }

    const alreadyReturned = await client.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType, sourceLineId, relationType },
      _sum: { quantity: true },
    });
    return baseQuantity.minus(new Decimal((alreadyReturned._sum.quantity ?? 0).toString()));
  }
}
