import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface FixedAssetHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  assetId?: string;
  documentId?: string;
  message: string;
}

/**
 * FixedAssetHealthService (spec section 123). Computed live — same
 * "rebuildable projection" pattern as every other health service in this
 * codebase. GL mismatch and asset-inventory-mismatch checks are covered
 * by `FixedAssetReconciliationService`, called alongside this one.
 */
@Injectable()
export class FixedAssetHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<FixedAssetHealthIssue[]> {
    const issues: FixedAssetHealthIssue[] = [];
    const staleThreshold = new Date(Date.now() - 30 * 86_400_000);

    const staleCandidates = await this.prisma.fixedAssetAcquisitionCandidate.count({ where: { tenantId, organizationId, status: { in: ['NEW', 'UNDER_REVIEW'] }, createdAt: { lt: staleThreshold } } });
    if (staleCandidates > 0) issues.push({ code: 'STALE_ACQUISITION_CANDIDATE', severity: 'WARNING', message: `${staleCandidates} acquisition candidate(s) unclassified for over 30 days.` });

    const staleCip = await this.prisma.capitalInvestmentProject.count({ where: { tenantId, organizationId, status: 'ACTIVE', startDate: { lt: new Date(Date.now() - 365 * 86_400_000) } } });
    if (staleCip > 0) issues.push({ code: 'STALE_CIP_PROJECT', severity: 'WARNING', message: `${staleCip} CIP project(s) active for over a year.` });

    const notCommissioned = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: 'ACCEPTED', acceptanceDate: { lt: staleThreshold } } });
    for (const a of notCommissioned) issues.push({ code: 'ACCEPTED_NOT_COMMISSIONED', severity: 'WARNING', assetId: a.id, message: `Asset ${a.assetNumber ?? a.id} accepted over 30 days ago and still not commissioned.` });

    const missingDepreciationSettings = await this.prisma.fixedAsset.count({ where: { tenantId, organizationId, status: 'ACTIVE', OR: [{ usefulLifeMonths: null }, { commissioningDate: null }] } });
    if (missingDepreciationSettings > 0) issues.push({ code: 'MISSING_DEPRECIATION_SETTINGS', severity: 'ERROR', message: `${missingDepreciationSettings} active asset(s) are missing useful life or commissioning date.` });

    const missingResponsible = await this.prisma.fixedAsset.count({ where: { tenantId, organizationId, status: 'ACTIVE', responsiblePersonId: null } });
    if (missingResponsible > 0) issues.push({ code: 'MISSING_RESPONSIBLE_PERSON', severity: 'WARNING', message: `${missingResponsible} active asset(s) have no responsible person assigned.` });

    const missingLocation = await this.prisma.fixedAsset.count({ where: { tenantId, organizationId, status: 'ACTIVE', locationId: null } });
    if (missingLocation > 0) issues.push({ code: 'MISSING_LOCATION', severity: 'WARNING', message: `${missingLocation} active asset(s) have no location recorded.` });

    const errorEntries = await this.prisma.fixedAssetDepreciationEntry.findMany({ where: { tenantId, errorCode: { not: null }, posted: false }, include: { run: true } });
    for (const e of errorEntries) if (e.run.status !== 'POSTED') issues.push({ code: `DEPRECIATION_ERROR_${e.errorCode}`, severity: 'ERROR', assetId: e.assetId, documentId: e.runId, message: `Asset has an unresolved depreciation error: ${e.errorCode}.` });

    const negativeNbv = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF'] } } });
    for (const a of negativeNbv) if (new Decimal(a.carryingAmount.toString()).lt(new Decimal(a.residualValue.toString()).minus('0.01'))) issues.push({ code: 'NEGATIVE_NBV', severity: 'BLOCKING', assetId: a.id, message: `Asset ${a.assetNumber ?? a.id} has a carrying amount below its residual value.` });

    const disposedStillActive = await this.prisma.fixedAssetMovement.findMany({ where: { tenantId, organizationId, movementType: { in: ['FULL_DISPOSAL', 'WRITE_OFF'] }, reversed: false }, distinct: ['assetId'], select: { assetId: true } });
    for (const { assetId } of disposedStillActive) {
      const asset = await this.prisma.fixedAsset.findUnique({ where: { id: assetId } });
      if (asset && !['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) issues.push({ code: 'DISPOSED_ASSET_STILL_ACTIVE', severity: 'BLOCKING', assetId, message: `Asset ${asset.assetNumber ?? assetId} has a disposal movement but is still ${asset.status}.` });
    }

    const uncapitalizedCip = await this.prisma.capitalInvestmentProject.findMany({ where: { tenantId, organizationId, status: 'CAPITALIZED' } });
    for (const p of uncapitalizedCip) {
      const lines = await this.prisma.capitalInvestmentCostLine.findMany({ where: { tenantId, projectId: p.id, capitalizable: true, capitalizedToAssetId: null } });
      const residual = lines.reduce((s, l) => s.plus(l.baseAmount.toString()), new Decimal(0));
      if (residual.abs().gt('0.01')) issues.push({ code: 'CIP_RESIDUAL_AFTER_CLOSURE', severity: 'ERROR', documentId: p.id, message: `CIP project ${p.code} was closed with an uncapitalized residual of ${residual.toString()}.` });
    }

    return issues;
  }
}
