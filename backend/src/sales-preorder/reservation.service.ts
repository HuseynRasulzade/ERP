import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { ConflictAppError, NotFoundAppError, ReservationExceedsRemainingError, ValidationAppError } from '../common/errors/app-error';
import { SALES_ORDER_TYPE } from '../sales-documents/sales-order.repository';
import { CreateReservationDto } from './dto/sales-preorder.dto';

/**
 * StockReservation (spec sections 37-42) — a planning/commitment object,
 * never a physical inventory movement (no StockMovement is written; no
 * Phase 10 Inventory Register exists to write one against). Availability
 * here is checked only against the order's OWN remaining orderable
 * quantity, not real warehouse stock (spec section 35's
 * `StockAvailabilityService` interface — see docs/SALES_PREORDER.md for
 * why a real implementation is out of scope). The concurrency contract
 * this build DOES provide (spec section 39): two concurrent reservation
 * requests against the same line cannot together exceed that line's
 * remaining quantity, enforced by re-checking inside the same transaction
 * that creates the row.
 */
@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly fulfillment: OrderFulfillmentService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, salesOrderId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.stockReservation.findMany({
      where: { tenantId, organizationId, sourceDocumentType: SALES_ORDER_TYPE, sourceDocumentId: salesOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    salesOrderId: string,
    userId: string,
    dto: CreateReservationDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('SalesOrder', salesOrderId);

    const created = await this.prisma.runInTransaction(async (tx) => {
      const rows = [];
      for (const line of dto.lines) {
        const orderLine = await tx.salesOrderLine.findFirst({ where: { id: line.salesOrderLineId, tenantId, salesOrderId } });
        if (!orderLine) throw new NotFoundAppError('SalesOrderLine', line.salesOrderLineId);
        if (orderLine.isService) throw new ValidationAppError('Service lines do not support reservation (spec section 64)');
        if (orderLine.reservationPolicy === 'NONE') {
          throw new ValidationAppError(`Line ${line.salesOrderLineId} has reservation policy NONE`);
        }

        const requested = new Decimal(line.quantity);
        if (requested.lte(0)) throw new ValidationAppError('Reservation quantity must be positive');

        // Re-check inside the transaction (row-locked via the aggregate
        // query running against already-committed rows plus this
        // transaction's own isolation level) so two concurrent requests
        // against the same line cannot together reserve more than remains.
        const alreadyReserved = await tx.stockReservation.aggregate({
          where: { tenantId, sourceLineId: orderLine.id, status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] } },
          _sum: { quantity: true },
        });
        const remainingOrderable = new Decimal(orderLine.quantity.toString())
          .minus(orderLine.cancelledQuantity.toString())
          .minus((alreadyReserved._sum.quantity ?? 0).toString());
        if (requested.gt(remainingOrderable)) {
          throw new ReservationExceedsRemainingError(remainingOrderable.toFixed(6), requested.toFixed(6));
        }

        const row = await tx.stockReservation.create({
          data: {
            tenantId,
            organizationId,
            sourceDocumentType: SALES_ORDER_TYPE,
            sourceDocumentId: salesOrderId,
            sourceLineId: orderLine.id,
            productId: orderLine.productId,
            warehouseId: line.warehouseId,
            quantity: requested.toString(),
            status: 'ACTIVE',
            validUntil: line.validUntil ? new Date(line.validUntil) : undefined,
            createdBy: userId,
          },
        });
        rows.push(row);

        await this.audit.record(
          {
            tenantId,
            eventType: 'RESERVATION_CREATED',
            entityType: 'StockReservation',
            entityId: row.id,
            action: 'CREATE',
            userId,
            newValues: { salesOrderLineId: orderLine.id, quantity: requested.toString() },
          },
          tx,
        );
      }
      return rows;
    });

    await this.fulfillment.recomputeOrderStatuses(tenantId, salesOrderId);
    return created;
  }

  async release(tenantId: string, membershipId: string, organizationId: string, reservationId: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const reservation = await this.prisma.stockReservation.findFirst({ where: { id: reservationId, tenantId, organizationId } });
    if (!reservation) throw new NotFoundAppError('StockReservation', reservationId);
    if (reservation.version !== expectedVersion) throw new ConflictAppError('The reservation has been changed by another user');
    if (reservation.status !== 'ACTIVE' && reservation.status !== 'PARTIALLY_RELEASED') {
      throw new ValidationAppError(`Cannot release a reservation in status ${reservation.status}`);
    }

    const result = await this.prisma.stockReservation.updateMany({
      where: { id: reservationId, tenantId, version: expectedVersion },
      data: { status: 'RELEASED', releasedAt: new Date(), releasedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConflictAppError('The reservation has been changed by another user');

    await this.audit.record({ tenantId, eventType: 'RESERVATION_RELEASED', entityType: 'StockReservation', entityId: reservationId, action: 'UPDATE', userId });
    await this.fulfillment.recomputeOrderStatuses(tenantId, reservation.sourceDocumentId);

    return this.prisma.stockReservation.findUnique({ where: { id: reservationId } });
  }

  /**
   * Reservation consumption (Sales Execution spec section 15): called by
   * `ShipmentPostingHandler` inside its own posting transaction when a
   * Shipment line executes against a reserved order line. Reduces the
   * oldest ACTIVE/PARTIALLY_RELEASED reservations first (FIFO) by the
   * shipped quantity — never below zero, and never releases more than was
   * actually reserved. Quantity actually consumed (which may be less than
   * requested if the line wasn't fully reserved) is returned so the
   * caller never assumes full consumption succeeded.
   */
  async consumeForLine(tenantId: string, salesOrderLineId: string, quantity: Decimal, tx: PrismaTransactionClient): Promise<Decimal> {
    const active = await tx.stockReservation.findMany({
      where: { tenantId, sourceLineId: salesOrderLineId, status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] } },
      orderBy: { createdAt: 'asc' },
    });

    let remaining = quantity;
    let consumed = new Decimal(0);
    for (const reservation of active) {
      if (remaining.lte(0)) break;
      const reservedQty = new Decimal(reservation.quantity.toString());
      const take = Decimal.min(reservedQty, remaining);
      const left = reservedQty.minus(take);

      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: left.gt(0)
          ? { quantity: left.toString(), status: 'PARTIALLY_RELEASED' }
          : { quantity: '0', status: 'CONSUMED' },
      });

      remaining = remaining.minus(take);
      consumed = consumed.plus(take);
    }
    return consumed;
  }
}
