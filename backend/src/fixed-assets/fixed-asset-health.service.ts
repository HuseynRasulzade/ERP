import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { FixedAssetBalanceService } from './fixed-asset-balance.service';

export interface FixedAssetHealthIssue {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  assetId: string | null;
  documentType: string | null;
  documentId: string | null;
  message: string;
}

const STALE_DAYS = 30;

/**
 * FixedAssetHealthService (docx spec Phase 16 section 123) — computed
 * live, same principle as every other *HealthService in this codebase.
 * Covers a practical subset of the spec's own checklist (full coverage,
 * including GL mismatch, is FixedAssetReconciliationService's own job and
 * a later Phase 30 health engine's — see docs/FIXED_ASSETS.md).
 */
@Injectable()
export class FixedAssetHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  async check(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ): Promise<FixedAssetHealthIssue[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const issues: FixedAssetHealthIssue[] = [];
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_DAYS * 86_400_000);

    const staleCandidates =
      await this.prisma.fixedAssetAcquisitionCandidate.findMany({
        where: {
          organizationId,
          status: { in: ['NEW', 'UNDER_REVIEW'] },
          createdAt: { lt: staleCutoff },
        },
      });
    for (const c of staleCandidates) {
      issues.push({
        severity: 'WARNING',
        code: 'STALE_UNPROCESSED_CANDIDATE',
        assetId: null,
        documentType: 'FIXED_ASSET_ACQUISITION_CANDIDATE',
        documentId: c.id,
        message: `Acquisition candidate ${c.id} has been unclassified for over ${STALE_DAYS} days`,
      });
    }

    const staleCip = await this.prisma.capitalInvestmentProject.findMany({
      where: {
        organizationId,
        status: { in: ['PLANNED', 'ACTIVE'] },
        createdAt: { lt: staleCutoff },
      },
    });
    for (const p of staleCip) {
      issues.push({
        severity: 'WARNING',
        code: 'STALE_CIP_PROJECT',
        assetId: null,
        documentType: 'CAPITAL_INVESTMENT_PROJECT',
        documentId: p.id,
        message: `CIP project ${p.name} has been open for over ${STALE_DAYS} days without capitalization`,
      });
    }

    const capitalizedCip = await this.prisma.capitalInvestmentProject.findMany({
      where: { organizationId, status: 'CAPITALIZED' },
    });
    for (const p of capitalizedCip) {
      const remaining = await this.balances.getCipBalance(tenantId, p.id, now);
      if (remaining.abs().gt(0.01)) {
        issues.push({
          severity: 'ERROR',
          code: 'CIP_RESIDUAL_AFTER_CLOSURE',
          assetId: null,
          documentType: 'CAPITAL_INVESTMENT_PROJECT',
          documentId: p.id,
          message: `CIP project ${p.name} is CAPITALIZED but still has a residual balance of ${remaining.toFixed(2)}`,
        });
      }
    }

    const acceptedNotCommissioned = await this.prisma.fixedAsset.findMany({
      where: {
        organizationId,
        status: 'ACCEPTED',
        acceptanceDate: { lt: staleCutoff },
      },
    });
    for (const a of acceptedNotCommissioned) {
      issues.push({
        severity: 'WARNING',
        code: 'ACCEPTED_NOT_COMMISSIONED',
        assetId: a.id,
        documentType: 'FIXED_ASSET',
        documentId: a.id,
        message: `Asset ${a.assetNumber ?? a.id} was accepted over ${STALE_DAYS} days ago and still isn't commissioned`,
      });
    }

    const activeAssets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });
    for (const a of activeAssets) {
      if (!a.responsiblePersonId)
        issues.push({
          severity: 'WARNING',
          code: 'MISSING_RESPONSIBLE_PERSON',
          assetId: a.id,
          documentType: 'FIXED_ASSET',
          documentId: a.id,
          message: `Active asset ${a.assetNumber ?? a.id} has no responsible person assigned`,
        });
      if (!a.locationWarehouseId)
        issues.push({
          severity: 'WARNING',
          code: 'MISSING_LOCATION',
          assetId: a.id,
          documentType: 'FIXED_ASSET',
          documentId: a.id,
          message: `Active asset ${a.assetNumber ?? a.id} has no location assigned`,
        });

      const bal = await this.balances.getBalances(tenantId, a.id, now);
      if (bal.netBookValue.lt(-0.01)) {
        issues.push({
          severity: 'ERROR',
          code: 'NEGATIVE_NBV',
          assetId: a.id,
          documentType: 'FIXED_ASSET',
          documentId: a.id,
          message: `Asset ${a.assetNumber ?? a.id} has a negative net book value of ${bal.netBookValue.toFixed(2)}`,
        });
      }
    }

    const disposedAssets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: { in: ['DISPOSED', 'WRITTEN_OFF'] } },
    });
    for (const a of disposedAssets) {
      const bal = await this.balances.getBalances(tenantId, a.id, now);
      if (bal.grossCost.abs().gt(0.01) || bal.netBookValue.abs().gt(0.01)) {
        issues.push({
          severity: 'ERROR',
          code: 'DISPOSED_ASSET_RESIDUAL_BALANCE',
          assetId: a.id,
          documentType: 'FIXED_ASSET',
          documentId: a.id,
          message: `Disposed asset ${a.assetNumber ?? a.id} still carries a residual subledger balance (gross ${bal.grossCost.toFixed(2)}, NBV ${bal.netBookValue.toFixed(2)})`,
        });
      }
    }

    const openInventoryResults =
      await this.prisma.fixedAssetInventoryResult.findMany({
        where: { resolutionStatus: 'OPEN', count: { organizationId } },
        include: { count: false },
      });
    for (const r of openInventoryResults) {
      issues.push({
        severity: r.resultType === 'MISSING' ? 'ERROR' : 'WARNING',
        code: `UNRESOLVED_INVENTORY_${r.resultType}`,
        assetId: r.assetId,
        documentType: 'FIXED_ASSET_INVENTORY_RESULT',
        documentId: r.id,
        message: `Inventory result ${r.resultType} for ${r.assetId ?? 'an unregistered asset'} is still unresolved`,
      });
    }

    return issues;
  }
}
