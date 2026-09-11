import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, PurchaseOrderOnHoldError, ValidationAppError } from '../common/errors/app-error';
import { PlacePurchaseOrderHoldDto } from './dto/procurement.dto';

/**
 * PurchaseOrderHold (spec section 83) — a structured hold, never encoded
 * only in a comment. Mirrors OrderHoldService (Phase 6). Multiple holds
 * may coexist; the PO is only confirmable once every ACTIVE hold is
 * RELEASED — enforced by PurchaseOrderPostingHandler.validateForPosting.
 */
@Injectable()
export class PurchaseOrderHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, purchaseOrderId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() => this.prisma.purchaseOrderHold.findMany({ where: { tenantId, purchaseOrderId }, orderBy: { placedAt: 'desc' } }));
  }

  async place(tenantId: string, membershipId: string, organizationId: string, purchaseOrderId: string, userId: string, dto: PlacePurchaseOrderHoldDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const order = await this.prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId, organizationId } });
    if (!order) throw new NotFoundAppError('PurchaseOrder', purchaseOrderId);

    const hold = await this.prisma.purchaseOrderHold.create({
      data: { tenantId, purchaseOrderId, holdType: dto.holdType, reason: dto.reason, status: 'ACTIVE', placedBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'PURCHASE_ORDER_HOLD_PLACED', entityType: 'PurchaseOrderHold', entityId: hold.id, action: 'CREATE', userId, newValues: { holdType: dto.holdType, reason: dto.reason } });
    return hold;
  }

  async release(tenantId: string, membershipId: string, organizationId: string, holdId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const hold = await this.prisma.purchaseOrderHold.findFirst({ where: { id: holdId, tenantId } });
    if (!hold) throw new NotFoundAppError('PurchaseOrderHold', holdId);
    if (hold.status !== 'ACTIVE') throw new ValidationAppError('Hold is not active');

    const released = await this.prisma.purchaseOrderHold.update({ where: { id: holdId }, data: { status: 'RELEASED', releasedAt: new Date(), releasedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'PURCHASE_ORDER_HOLD_RELEASED', entityType: 'PurchaseOrderHold', entityId: holdId, action: 'UPDATE', userId });
    return released;
  }

  async assertNoActiveHolds(tenantId: string, purchaseOrderId: string) {
    const active = await this.prisma.purchaseOrderHold.findMany({ where: { tenantId, purchaseOrderId, status: 'ACTIVE' } });
    if (active.length > 0) throw new PurchaseOrderOnHoldError(active.map((h) => h.holdType));
  }
}
