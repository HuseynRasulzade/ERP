import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, OrderOnHoldError, ValidationAppError } from '../common/errors/app-error';
import { PlaceOrderHoldDto } from './dto/sales-preorder.dto';

/**
 * OrderHold (spec sections 85-87) — structured, never just a comment.
 * Multiple holds may coexist; the order is actionable only once every
 * ACTIVE hold is released. `SalesOrderPostingHandler.validateForPosting`
 * calls `assertNoActiveHolds` before allowing confirmation.
 */
@Injectable()
export class OrderHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, salesOrderId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.orderHold.findMany({ where: { tenantId, salesOrderId }, orderBy: { placedAt: 'desc' } }));
  }

  async place(tenantId: string, membershipId: string, organizationId: string, salesOrderId: string, userId: string, dto: PlaceOrderHoldDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('SalesOrder', salesOrderId);

    const hold = await this.prisma.orderHold.create({
      data: { tenantId, salesOrderId, holdType: dto.holdType, reason: dto.reason, status: 'ACTIVE', placedBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'ORDER_HOLD_PLACED', entityType: 'OrderHold', entityId: hold.id, action: 'CREATE', userId, newValues: { holdType: dto.holdType, reason: dto.reason } });
    return hold;
  }

  async release(tenantId: string, membershipId: string, organizationId: string, holdId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const hold = await this.prisma.orderHold.findFirst({ where: { id: holdId, tenantId } });
    if (!hold) throw new NotFoundAppError('OrderHold', holdId);
    if (hold.status !== 'ACTIVE') throw new ValidationAppError('Hold is not active');

    const released = await this.prisma.orderHold.update({
      where: { id: holdId },
      data: { status: 'RELEASED', releasedAt: new Date(), releasedBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'ORDER_HOLD_RELEASED', entityType: 'OrderHold', entityId: holdId, action: 'UPDATE', userId });
    return released;
  }

  async assertNoActiveHolds(tenantId: string, salesOrderId: string) {
    const active = await this.prisma.orderHold.findMany({ where: { tenantId, salesOrderId, status: 'ACTIVE' } });
    if (active.length > 0) {
      throw new OrderOnHoldError(active.map((h) => h.holdType));
    }
  }
}
