import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/** FixedAssetService — read-only asset-card surface. Creation only
 * happens through `FixedAssetCapitalizationService`/
 * `FixedAssetOpeningBalanceService` (spec section 15's own "not a
 * standalone create form" framing — an asset is always the RESULT of a
 * capitalization or migration event, never a bare row). */
@Injectable()
export class FixedAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, status?: string, categoryId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAsset.findMany({ where: { organizationId, status, categoryId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAsset.findFirst({ where: { id, organizationId }, include: { components: true, movements: { orderBy: { effectiveDate: 'desc' }, take: 50 } } });
    if (!row) throw new NotFoundAppError('FixedAsset', id);
    return row;
  }

  async movements(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', id);
    return this.prisma.fixedAssetMovement.findMany({ where: { tenantId, assetId: id, reversed: false }, orderBy: { effectiveDate: 'asc' } });
  }

  /** Registers a component as a child FixedAsset (spec sections 38-40) —
   * componentization must be allowed by the parent's category. */
  async attachComponent(tenantId: string, membershipId: string, organizationId: string, parentAssetId: string, componentAssetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const parent = await this.prisma.fixedAsset.findFirst({ where: { id: parentAssetId, organizationId }, include: { category: true } });
    if (!parent) throw new NotFoundAppError('FixedAsset', parentAssetId);
    if (!parent.category.componentizationAllowed) throw new ValidationAppError(`Category ${parent.category.name} does not allow componentization`);
    return this.prisma.fixedAsset.update({ where: { id: componentAssetId }, data: { parentAssetId } });
  }
}
