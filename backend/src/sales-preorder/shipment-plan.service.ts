import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { NotFoundAppError, ShipmentPlanExceedsRemainingError, ValidationAppError } from '../common/errors/app-error';
import { CreateShipmentPlanDto } from './dto/sales-preorder.dto';

/**
 * ShipmentPlan (spec sections 45-48) — a planning object. Creating one
 * does NOT change `fulfillmentStatus` (spec section 48: "Shipment planning
 * does not fulfill order") — only an actual Phase 7 Shipment execution
 * would, via a `DocumentLineLink` with `relationType = 'ORDER_TO_SHIPMENT'`
 * that `OrderFulfillmentService` already knows how to aggregate.
 */
@Injectable()
export class ShipmentPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly fulfillment: OrderFulfillmentService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, salesOrderId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.shipmentPlan.findMany({
          where: { tenantId, organizationId, salesOrderId },
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    salesOrderId: string,
    userId: string,
    dto: CreateShipmentPlanDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('SalesOrder', salesOrderId);

    const plan = await this.prisma.runInTransaction(async (tx) => {
      const header = await tx.shipmentPlan.create({
        data: {
          tenantId,
          organizationId,
          salesOrderId,
          plannedDate: new Date(dto.plannedDate),
          warehouseId: dto.warehouseId,
          deliveryAddress: dto.deliveryAddress,
          carrier: dto.carrier,
          notes: dto.notes,
          status: 'PLANNED',
          createdBy: userId,
          updatedBy: userId,
        },
      });

      for (const line of dto.lines) {
        const orderLine = await tx.salesOrderLine.findFirst({ where: { id: line.salesOrderLineId, tenantId, salesOrderId } });
        if (!orderLine) throw new NotFoundAppError('SalesOrderLine', line.salesOrderLineId);
        if (orderLine.isService) throw new ValidationAppError('Service lines do not need shipment planning (spec section 64)');

        const planned = new Decimal(line.plannedQuantity);
        const remaining = await this.fulfillment.remainingForLine(tenantId, orderLine.id);
        const alreadyPlanned = await tx.shipmentPlanLine.aggregate({
          where: { tenantId, salesOrderLineId: orderLine.id, shipmentPlan: { status: { not: 'CANCELLED' } } },
          _sum: { plannedQuantity: true },
        });
        const remainingUnplanned = remaining.minus((alreadyPlanned._sum.plannedQuantity ?? 0).toString());
        if (planned.gt(remainingUnplanned)) {
          throw new ShipmentPlanExceedsRemainingError(remainingUnplanned.toFixed(6), planned.toFixed(6));
        }

        await tx.shipmentPlanLine.create({
          data: {
            tenantId,
            shipmentPlanId: header.id,
            salesOrderLineId: orderLine.id,
            plannedQuantity: planned.toString(),
            warehouseId: line.warehouseId ?? dto.warehouseId,
            plannedDate: line.plannedDate ? new Date(line.plannedDate) : new Date(dto.plannedDate),
          },
        });
      }

      await this.audit.record(
        { tenantId, eventType: 'SHIPMENT_PLAN_CREATED', entityType: 'ShipmentPlan', entityId: header.id, action: 'CREATE', userId, newValues: { salesOrderId, lineCount: dto.lines.length } },
        tx,
      );

      return tx.shipmentPlan.findFirst({ where: { id: header.id }, include: { lines: true } });
    });

    return plan;
  }

  async cancel(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.shipmentPlan.findFirst({ where: { id, tenantId, organizationId } });
    if (!plan) throw new NotFoundAppError('ShipmentPlan', id);

    await this.prisma.shipmentPlan.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'SHIPMENT_PLAN_CANCELLED', entityType: 'ShipmentPlan', entityId: id, action: 'UPDATE', userId });
    return this.prisma.shipmentPlan.findFirst({ where: { id }, include: { lines: true } });
  }
}
