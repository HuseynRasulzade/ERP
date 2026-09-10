import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { SALES_ORDER_TYPE } from '../sales-documents/sales-order.repository';

export interface LineFulfillment {
  lineId: string;
  productId: string;
  ordered: Decimal;
  cancelled: Decimal;
  fulfilled: Decimal;
  reserved: Decimal;
  planned: Decimal;
  remaining: Decimal;
}

/**
 * OrderFulfillmentService (spec sections 27-28, 83-84). Every quantity here
 * is computed live from the operational sources of truth (`DocumentLineLink`
 * for execution, `StockReservation`, `ShipmentPlanLine`) — never a stored,
 * independently-editable total (spec section 83: "Do not persist manually
 * editable fulfillment totals as source of truth"). Every method accepts
 * an optional `tx` so `ShipmentPostingHandler` (Sales Execution, docx spec
 * Phase 7) can call `recomputeOrderStatuses` from inside the same posting
 * transaction that just wrote the `ORDER_TO_SHIPMENT` links it aggregates
 * — reading through `this.prisma` there would miss the uncommitted write.
 */
@Injectable()
export class OrderFulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(tenantId: string, salesOrderId: string, tx?: PrismaTransactionClient): Promise<LineFulfillment[]> {
    const client = tx ?? this.prisma;
    const order = await client.salesOrder.findFirst({
      where: { id: salesOrderId, tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!order) throw new NotFoundAppError('SalesOrder', salesOrderId);

    const results: LineFulfillment[] = [];
    for (const line of order.lines) {
      const fulfilledLinks = await client.documentLineLink.aggregate({
        where: { tenantId, sourceDocumentType: SALES_ORDER_TYPE, sourceDocumentId: salesOrderId, sourceLineId: line.id, relationType: 'ORDER_TO_SHIPMENT' },
        _sum: { quantity: true },
      });
      const reservations = await client.stockReservation.aggregate({
        where: { tenantId, sourceDocumentType: SALES_ORDER_TYPE, sourceDocumentId: salesOrderId, sourceLineId: line.id, status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] } },
        _sum: { quantity: true },
      });
      const planned = await client.shipmentPlanLine.aggregate({
        where: { tenantId, salesOrderLineId: line.id, shipmentPlan: { status: { not: 'CANCELLED' } } },
        _sum: { plannedQuantity: true },
      });

      const ordered = new Decimal(line.quantity.toString());
      const cancelled = new Decimal(line.cancelledQuantity.toString());
      const fulfilled = new Decimal((fulfilledLinks._sum.quantity ?? 0).toString());
      const reserved = new Decimal((reservations._sum.quantity ?? 0).toString());
      const plannedQty = new Decimal((planned._sum.plannedQuantity ?? 0).toString());

      results.push({
        lineId: line.id,
        productId: line.productId,
        ordered,
        cancelled,
        fulfilled,
        reserved,
        planned: plannedQty,
        remaining: ordered.minus(fulfilled).minus(cancelled),
      });
    }
    return results;
  }

  async remainingForLine(tenantId: string, salesOrderLineId: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const client = tx ?? this.prisma;
    const line = await client.salesOrderLine.findFirst({ where: { id: salesOrderLineId, tenantId } });
    if (!line) throw new NotFoundAppError('SalesOrderLine', salesOrderLineId);
    const fulfilled = await client.documentLineLink.aggregate({
      where: { tenantId, sourceDocumentType: SALES_ORDER_TYPE, sourceLineId: line.id, relationType: 'ORDER_TO_SHIPMENT' },
      _sum: { quantity: true },
    });
    const ordered = new Decimal(line.quantity.toString());
    const cancelled = new Decimal(line.cancelledQuantity.toString());
    const fulfilledQty = new Decimal((fulfilled._sum.quantity ?? 0).toString());
    return ordered.minus(cancelled).minus(fulfilledQty);
  }

  /** Reserved (not yet fulfilled) quantity against one order line — the cap
   * `ReservationService` enforces so it never oversubscribes the order's
   * own remaining quantity (spec section 39 — real physical-stock
   * concurrency safety needs Phase 10 Inventory, not built here). */
  async reservedForLine(tenantId: string, salesOrderLineId: string): Promise<Decimal> {
    const reservations = await this.prisma.stockReservation.aggregate({
      where: { tenantId, sourceLineId: salesOrderLineId, status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] } },
      _sum: { quantity: true },
    });
    return new Decimal((reservations._sum.quantity ?? 0).toString());
  }

  async recomputeOrderStatuses(tenantId: string, salesOrderId: string, tx?: PrismaTransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const lines = await this.forOrder(tenantId, salesOrderId, tx);
    const order = await client.salesOrder.findFirst({ where: { id: salesOrderId, tenantId }, include: { lines: true } });
    if (!order) throw new NotFoundAppError('SalesOrder', salesOrderId);

    const goodsLines = lines.filter((l, i) => !order.lines[i].isService);
    const fulfillmentStatus = deriveFulfillmentStatus(lines);
    const reservationStatus = deriveReservationStatus(goodsLines, order.lines.filter((l) => !l.isService));

    await client.salesOrder.update({
      where: { id: salesOrderId },
      data: { fulfillmentStatus, reservationStatus },
    });
  }
}

function deriveFulfillmentStatus(lines: LineFulfillment[]): string {
  if (lines.every((l) => l.ordered.minus(l.cancelled).lte(0))) return 'CANCELLED';
  if (lines.every((l) => l.fulfilled.gte(l.ordered.minus(l.cancelled)) && l.ordered.minus(l.cancelled).gt(0))) return 'FULFILLED';
  if (lines.some((l) => l.fulfilled.gt(0))) return 'PARTIALLY_FULFILLED';
  return 'NOT_STARTED';
}

function deriveReservationStatus(goodsLines: LineFulfillment[], goodsOrderLines: { reservationPolicy: string }[]): string {
  if (goodsLines.length === 0) return 'RESERVATION_NOT_REQUIRED';
  if (goodsOrderLines.every((l) => l.reservationPolicy === 'NONE')) return 'RESERVATION_NOT_REQUIRED';
  if (goodsLines.every((l) => l.reserved.gte(l.ordered.minus(l.cancelled)))) return 'FULLY_RESERVED';
  if (goodsLines.some((l) => l.reserved.gt(0))) return 'PARTIALLY_RESERVED';
  return 'NOT_RESERVED';
}
