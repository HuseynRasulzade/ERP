import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FixedAssetInventoryService (spec sections 59-64) — applies Phase 12's
 * physical-inventory principles to fixed assets. `recordLine` NEVER
 * writes off a MISSING asset or auto-creates an UNREGISTERED_ASSET card
 * (spec sections 63-64's own explicit prohibitions) — a WRONG_LOCATION
 * result only suggests a `FixedAssetTransfer`, both left to a separate,
 * human-triggered follow-up action outside this count.
 */
@Injectable()
export class FixedAssetInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async start(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { countDate: string; scopeDepartmentId?: string; scopeCategoryId?: string; notes?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetInventoryCount.create({ data: { tenantId, organizationId, countDate: this.parseDate(dto.countDate), scopeDepartmentId: dto.scopeDepartmentId, scopeCategoryId: dto.scopeCategoryId, notes: dto.notes, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_INVENTORY_STARTED', entityType: 'FIXED_ASSET_INVENTORY_COUNT', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async recordLine(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    countId: string,
    dto: { assetId?: string; expectedLocationId?: string; foundLocationId?: string; expectedResponsiblePersonId?: string; foundResponsiblePersonId?: string; result: string; condition?: string; description?: string; notes?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.fixedAssetInventoryCount.findFirst({ where: { id: countId, tenantId, organizationId, status: 'IN_PROGRESS' } });
    if (!count) throw new NotFoundAppError('FixedAssetInventoryCount', countId);
    if (dto.result !== 'UNREGISTERED_ASSET' && !dto.assetId) throw new ValidationAppError('assetId is required unless result is UNREGISTERED_ASSET');

    const line = await this.prisma.fixedAssetInventoryLine.create({
      data: {
        tenantId,
        countId,
        assetId: dto.assetId,
        expectedLocationId: dto.expectedLocationId,
        foundLocationId: dto.foundLocationId,
        expectedResponsiblePersonId: dto.expectedResponsiblePersonId,
        foundResponsiblePersonId: dto.foundResponsiblePersonId,
        result: dto.result,
        condition: dto.condition,
        description: dto.description,
        notes: dto.notes,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_INVENTORY_RESULT_RECORDED', entityType: 'FIXED_ASSET_INVENTORY_LINE', entityId: line.id, action: 'CREATE', userId, newValues: { result: dto.result, assetId: dto.assetId } });
    return line;
  }

  async complete(tenantId: string, membershipId: string, organizationId: string, userId: string, countId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.fixedAssetInventoryCount.findFirst({ where: { id: countId, tenantId, organizationId } });
    if (!count) throw new NotFoundAppError('FixedAssetInventoryCount', countId);
    const row = await this.prisma.fixedAssetInventoryCount.update({ where: { id: countId }, data: { status: 'COMPLETED' } });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_INVENTORY_COMPLETED', entityType: 'FIXED_ASSET_INVENTORY_COUNT', entityId: countId, action: 'UPDATE', userId, newValues: {} });
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetInventoryCount.findMany({ where: { tenantId, organizationId }, orderBy: { countDate: 'desc' } }));
  }

  /** REPORT — Asset Inventory Differences (spec section 120). */
  async differences(tenantId: string, membershipId: string, organizationId: string, countId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetInventoryLine.findMany({ where: { tenantId, countId, result: { not: 'FOUND' } }, include: { asset: true } });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid count date');
    return date;
  }
}
