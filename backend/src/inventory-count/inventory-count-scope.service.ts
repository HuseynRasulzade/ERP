import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountScopeImmutableError, NotFoundAppError } from '../common/errors/app-error';
import { CreateInventoryCountScopeDto } from './dto/inventory-count-plan.dto';

/**
 * InventoryCountScopeService (spec section 4-5) — a plan's scope rows
 * define WHICH stock a count covers (INCLUDE/EXCLUDE by warehouse,
 * location(+subtree), product, product group, batch, serial, ownership,
 * quality status). Freely editable while the plan sits in DRAFT; frozen
 * the moment any session has been started against the plan (a session
 * that has left DRAFT), because `InventorySnapshotService` has by then
 * already — or is about to — read the scope to build an immutable
 * snapshot, and a scope change afterward would silently disagree with
 * what was actually counted.
 */
@Injectable()
export class InventoryCountScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  private async assertMutable(tenantId: string, organizationId: string, planId: string) {
    const plan = await this.prisma.inventoryCountPlan.findFirst({ where: { id: planId, tenantId, organizationId } });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', planId);
    const startedSession = await this.prisma.inventoryCountSession.findFirst({ where: { tenantId, inventoryCountPlanId: planId, status: { not: 'DRAFT' } } });
    if (startedSession) throw new CountScopeImmutableError();
    return plan;
  }

  async list(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.inventoryCountPlan.findFirst({ where: { id: planId, tenantId, organizationId } });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', planId);
    return this.prisma.inventoryCountScope.findMany({ where: { tenantId, inventoryCountPlanId: planId }, orderBy: { createdAt: 'asc' } });
  }

  async add(tenantId: string, membershipId: string, organizationId: string, userId: string, planId: string, dto: CreateInventoryCountScopeDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertMutable(tenantId, organizationId, planId);

    const scope = await this.prisma.inventoryCountScope.create({
      data: {
        tenantId,
        inventoryCountPlanId: planId,
        includeExclude: dto.includeExclude ?? 'INCLUDE',
        warehouseId: dto.warehouseId,
        locationId: dto.locationId,
        locationSubtree: dto.locationSubtree ?? false,
        productId: dto.productId,
        productGroupId: dto.productGroupId,
        batchId: dto.batchId,
        serialId: dto.serialId,
        ownershipType: dto.ownershipType,
        qualityStatus: dto.qualityStatus,
      },
    });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SCOPE_ADDED', entityType: 'INVENTORY_COUNT_SCOPE', entityId: scope.id, action: 'CREATE', userId, newValues: { planId, ...dto } });
    return scope;
  }

  async remove(tenantId: string, membershipId: string, organizationId: string, userId: string, planId: string, scopeId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertMutable(tenantId, organizationId, planId);
    const scope = await this.prisma.inventoryCountScope.findFirst({ where: { id: scopeId, tenantId, inventoryCountPlanId: planId } });
    if (!scope) throw new NotFoundAppError('InventoryCountScope', scopeId);
    await this.prisma.inventoryCountScope.delete({ where: { id: scopeId } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SCOPE_REMOVED', entityType: 'INVENTORY_COUNT_SCOPE', entityId: scopeId, action: 'DELETE', userId, oldValues: { planId } });
  }
}
