import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * FixedAssetCategoryService (spec section 78). Category defaults only
 * seed a NEW asset's parameters (spec section 79) — changing a category's
 * defaults later never rewrites an existing asset's frozen settings.
 */
@Injectable()
export class FixedAssetCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetCategory.findMany({ where: { organizationId, active: true }, orderBy: { code: 'asc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetCategory.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('FixedAssetCategory', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { code: string; name: string; defaultUsefulLifeMonths?: number; defaultDepreciationMethod?: string; defaultResidualValue?: number; capitalizationThreshold?: number; accountingMappingProfile?: string; taxCategory?: string; componentizationAllowed?: boolean; revaluationModel?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetCategory.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        defaultUsefulLifeMonths: dto.defaultUsefulLifeMonths,
        defaultDepreciationMethod: dto.defaultDepreciationMethod ?? 'STRAIGHT_LINE',
        defaultResidualValue: (dto.defaultResidualValue ?? 0).toString(),
        capitalizationThreshold: dto.capitalizationThreshold?.toString(),
        accountingMappingProfile: dto.accountingMappingProfile,
        taxCategory: dto.taxCategory,
        componentizationAllowed: dto.componentizationAllowed ?? false,
        revaluationModel: dto.revaluationModel ?? 'COST_MODEL',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_CATEGORY_CREATED', entityType: 'FIXED_ASSET_CATEGORY', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code, name: dto.name } });
    return row;
  }
}
