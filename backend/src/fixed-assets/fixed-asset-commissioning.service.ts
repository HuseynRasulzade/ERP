import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FixedAssetCommissioningService (spec sections 18-20). Acceptance
 * (ACCEPTED, set by `FixedAssetCapitalizationPostingHandler`) and
 * commissioning are deliberately different events (spec section 19's own
 * worked example) — depreciation eligibility only starts here, and even
 * then only from `depreciationStartRule` applied to `commissioningDate`,
 * never from the moment this call runs.
 */
@Injectable()
export class FixedAssetCommissioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async commission(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    assetId: string,
    dto: { commissioningDate: string; departmentId?: string; locationId?: string; responsiblePersonId?: string; usefulLifeMonths: number; depreciationMethod?: string; residualValue?: number; depreciationStartRule?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundAppError('FixedAsset', assetId);
    if (asset.status !== 'ACCEPTED' && asset.status !== 'NOT_COMMISSIONED') throw new ValidationAppError(`Asset must be ACCEPTED or NOT_COMMISSIONED to commission (currently ${asset.status})`);
    if (dto.usefulLifeMonths <= 0) throw new ValidationAppError('usefulLifeMonths must be positive');
    const commissioningDate = this.parseDate(dto.commissioningDate);

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.fixedAsset.update({
        where: { id: assetId },
        data: {
          status: 'ACTIVE',
          commissioningDate,
          departmentId: dto.departmentId ?? asset.departmentId,
          locationId: dto.locationId ?? asset.locationId,
          responsiblePersonId: dto.responsiblePersonId ?? asset.responsiblePersonId,
          usefulLifeMonths: dto.usefulLifeMonths,
          remainingUsefulLifeMonths: dto.usefulLifeMonths,
          depreciationMethod: dto.depreciationMethod ?? asset.depreciationMethod,
          residualValue: dto.residualValue !== undefined ? dto.residualValue.toString() : undefined,
          depreciationStartRule: dto.depreciationStartRule ?? asset.depreciationStartRule,
        },
      });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_COMMISSIONED', entityType: 'FIXED_ASSET', entityId: assetId, action: 'UPDATE', userId, newValues: { commissioningDate, usefulLifeMonths: dto.usefulLifeMonths } }, tx);
      return row;
    });
  }

  /** Marks an accepted-but-not-yet-commissioned asset explicitly, for the
   * "Assets Not Commissioned" report (spec section 119) — a no-op status
   * flip callable independently of `commission` itself. */
  async markNotCommissioned(tenantId: string, membershipId: string, organizationId: string, userId: string, assetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, organizationId, status: 'ACCEPTED' } });
    if (!asset) throw new NotFoundAppError('FixedAsset', assetId);
    return this.prisma.fixedAsset.update({ where: { id: assetId }, data: { status: 'NOT_COMMISSIONED' } });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid commissioning date');
    return date;
  }
}
