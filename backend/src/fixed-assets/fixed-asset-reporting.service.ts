import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { FixedAssetBalanceService } from './fixed-asset-balance.service';

/**
 * FixedAssetReportingService (docx spec Phase 16 sections 114-122) —
 * covers the Fixed Asset Register (live balances per asset) and per-asset
 * Depreciation Schedule explicitly; CIP/Disposals/Modernizations/Not-
 * Commissioned/Fully-Depreciated are already fully servable from each
 * document's own `list()` endpoint (CapitalInvestmentProjectController,
 * FixedAssetDisposalController, etc.) filtered client-side or by status
 * query param — not duplicated here as separate report endpoints.
 */
@Injectable()
export class FixedAssetReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  async register(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId },
      orderBy: { assetNumber: 'asc' },
    });
    const rows = [];
    for (const asset of assets) {
      const bal = await this.balances.getBalances(tenantId, asset.id);
      rows.push({
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        name: asset.name,
        categoryId: asset.categoryId,
        commissioningDate: asset.commissioningDate,
        initialCost: asset.initialCost.toFixed(2),
        grossCost: bal.grossCost.toFixed(2),
        accumulatedDepreciation: bal.accumulatedDepreciation.toFixed(2),
        accumulatedImpairment: bal.accumulatedImpairment.toFixed(2),
        netBookValue: bal.netBookValue.toFixed(2),
        departmentId: asset.departmentId,
        responsiblePersonId: asset.responsiblePersonId,
        status: asset.status,
      });
    }
    return rows;
  }

  async depreciationSchedule(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    assetId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const lines = await this.prisma.fixedAssetDepreciationLine.findMany({
      where: { assetId, run: { organizationId, status: 'POSTED' } },
      include: { run: true },
      orderBy: { run: { period: 'asc' } },
    });
    return lines.map((l) => ({
      period: l.run.period,
      openingNbv: l.openingNbv.toFixed(2),
      depreciationAmount: l.depreciationAmount.toFixed(2),
      closingNbv: l.closingNbv.toFixed(2),
    }));
  }

  async fullyDepreciatedActiveAssets(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });
    const rows = [];
    for (const asset of assets) {
      const bal = await this.balances.getBalances(tenantId, asset.id);
      if (
        bal.grossCost.gt(0) &&
        bal.netBookValue.lte(asset.residualValue.toString())
      ) {
        rows.push({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          name: asset.name,
          netBookValue: bal.netBookValue.toFixed(2),
          residualValue: asset.residualValue.toFixed(2),
        });
      }
    }
    return rows;
  }

  async assetsNotCommissioned(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: 'ACCEPTED' },
      orderBy: { acceptanceDate: 'asc' },
    });
    const now = Date.now();
    return assets.map((a) => ({
      assetId: a.id,
      assetNumber: a.assetNumber,
      name: a.name,
      acquisitionDate: a.acquisitionDate,
      initialCost: a.initialCost.toFixed(2),
      daysPending: a.acceptanceDate
        ? Math.floor((now - a.acceptanceDate.getTime()) / 86_400_000)
        : null,
      departmentId: a.departmentId,
      responsiblePersonId: a.responsiblePersonId,
    }));
  }
}
