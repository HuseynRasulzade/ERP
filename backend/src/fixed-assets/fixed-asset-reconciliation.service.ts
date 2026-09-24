import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AssetStatus, Books, CANDIDATE_PENDING_STATUSES, CLOSED_STATUSES, MovementType, dec } from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';

export interface ReconciliationLine {
  area: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  subledger: string;
  gl: string;
  difference: string;
  healthy: boolean;
  breakdown: Record<string, string>;
}

/**
 * FixedAssetReconciliationService (spec sections 77, 124-125, 164): FA
 * subledger vs GL. Subledger measures are mapped onto the GL accounts they
 * post to (via the same semantic mappings the postings use, so a category
 * profile override is honoured) and compared account by account. When two
 * measures share one account (the AZ chart puts accumulated depreciation
 * AND impairment on 112) they are compared together.
 */
@Injectable()
export class FixedAssetReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
  ) {}

  private async subledgerByAccount(tenantId: string, organizationId: string, asOf: Date) {
    await this.accounting.ensureSetup(tenantId);
    const expected = new Map<string, { area: Set<string>; amount: Decimal; breakdown: Record<string, Decimal> }>();
    const add = (accountId: string, area: string, amount: Decimal) => {
      const e = expected.get(accountId) ?? { area: new Set<string>(), amount: new Decimal(0), breakdown: {} };
      e.area.add(area);
      e.amount = e.amount.plus(amount);
      e.breakdown[area] = (e.breakdown[area] ?? new Decimal(0)).plus(amount);
      expected.set(accountId, e);
    };

    const assets = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId }, include: { category: true } });
    const profiles = new Map<string | null, { cost: string; dep: string; imp: string }>();
    const accountsFor = async (profile: string | null) => {
      if (!profiles.has(profile)) {
        profiles.set(profile, {
          cost: (await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_COST, asOf, profile)).id,
          dep: (await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_DEPRECIATION, asOf, profile)).id,
          imp: (await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_IMPAIRMENT, asOf, profile)).id,
        });
      }
      return profiles.get(profile)!;
    };
    for (const a of assets) {
      const b = await this.ledger.balances(tenantId, a.id, { asOf });
      if (b.grossCarrying.isZero() && b.accumulatedDepreciation.isZero() && b.impairment.isZero()) continue;
      const acc = await accountsFor(a.category.accountingMappingProfile);
      add(acc.cost, 'FA_GROSS_COST', b.grossCarrying);
      add(acc.dep, 'ACCUMULATED_DEPRECIATION', b.accumulatedDepreciation.negated());
      add(acc.imp, 'ACCUMULATED_IMPAIRMENT', b.impairment.negated());
    }

    // CIP / acquisition clearing: unprocessed candidates + CIP register +
    // formed-but-not-yet-recognized asset cost components.
    const cipAccount = (await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_CIP, asOf, null)).id;
    const pending = await this.prisma.fixedAssetAcquisitionCandidate.aggregate({
      where: { tenantId, organizationId, glRecognized: true, status: { in: CANDIDATE_PENDING_STATUSES }, sourceDate: { lte: asOf } },
      _sum: { capitalizableAmount: true },
    });
    const register = await this.prisma.capitalInvestmentCost.aggregate({ where: { tenantId, organizationId, businessDate: { lte: asOf } }, _sum: { amount: true } });
    const unrecognized = await this.prisma.fixedAssetCostComponent.aggregate({
      where: { tenantId, recognized: false, released: false, asset: { organizationId, status: { notIn: ['CANCELLED'] } } },
      _sum: { amount: true },
    });
    add(cipAccount, 'CIP_UNPROCESSED_CANDIDATES', dec(pending._sum.capitalizableAmount));
    add(cipAccount, 'CIP_PROJECTS', dec(register._sum.amount));
    add(cipAccount, 'CIP_FORMED_NOT_ACCEPTED', dec(unrecognized._sum.amount));
    return expected;
  }

  async reconcile(tenantId: string, organizationId: string, asOf: Date) {
    const expected = await this.subledgerByAccount(tenantId, organizationId, asOf);
    const lines: ReconciliationLine[] = [];
    for (const [accountId, e] of expected) {
      const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      const gl = await this.accounting.accountBalance(tenantId, organizationId, accountId, asOf);
      const diff = e.amount.minus(gl);
      lines.push({
        area: [...e.area].join('+'),
        accountId,
        accountCode: account.code,
        accountName: account.name,
        subledger: e.amount.toFixed(2),
        gl: gl.toFixed(2),
        difference: diff.toFixed(2),
        healthy: diff.abs().lt(0.005),
        breakdown: Object.fromEntries(Object.entries(e.breakdown).map(([k, v]) => [k, v.toFixed(2)])),
      });
    }
    lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    return { asOf: asOf.toISOString().slice(0, 10), healthy: lines.every((l) => l.healthy), lines };
  }

  async reconcileChecked(tenantId: string, membershipId: string, organizationId: string, asOf: Date) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.reconcile(tenantId, organizationId, asOf);
  }

  async reconcileCostAccounts(tenantId: string, organizationId: string, asOf: Date) {
    return (await this.reconcile(tenantId, organizationId, asOf)).lines.filter((l) => l.area.includes('FA_GROSS_COST'));
  }

  async reconcileAccumulatedDepreciation(tenantId: string, organizationId: string, asOf: Date) {
    return (await this.reconcile(tenantId, organizationId, asOf)).lines.filter((l) => l.area.includes('ACCUMULATED_'));
  }

  async reconcileCIP(tenantId: string, organizationId: string, asOf: Date) {
    return (await this.reconcile(tenantId, organizationId, asOf)).lines.filter((l) => l.area.includes('CIP_'));
  }

  /** Projection drift + lifecycle/status consistency. */
  async reconcileAssetStatus(tenantId: string, organizationId: string) {
    const assets = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId } });
    const issues: { assetId: string; assetNumber: string; issue: string }[] = [];
    for (const a of assets) {
      const b = await this.ledger.balances(tenantId, a.id);
      if (!dec(a.initialCost).eq(b.cost) || !dec(a.accumulatedDepreciation).eq(b.accumulatedDepreciation) || !dec(a.carryingAmount).eq(b.netBookValue)) {
        issues.push({ assetId: a.id, assetNumber: a.assetNumber, issue: 'PROJECTION_DRIFT' });
      }
      if ([AssetStatus.ACTIVE, AssetStatus.ACCEPTED].includes(a.status as any) && b.cost.lte(0)) issues.push({ assetId: a.id, assetNumber: a.assetNumber, issue: 'RECOGNIZED_WITHOUT_COST' });
      if (a.disposalDate && !CLOSED_STATUSES.includes(a.status)) issues.push({ assetId: a.id, assetNumber: a.assetNumber, issue: 'DISPOSED_ASSET_STILL_ACTIVE' });
    }
    return issues;
  }

  /** Disposed / written-off assets must carry no residual subledger balance
   * and no depreciation after their disposal date. */
  async validateDisposals(tenantId: string, organizationId: string) {
    const closed = await this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { in: CLOSED_STATUSES } } });
    const issues: { assetId: string; assetNumber: string; issue: string; detail?: string }[] = [];
    for (const a of closed) {
      const b = await this.ledger.balances(tenantId, a.id);
      if (!b.grossCarrying.isZero() || !b.accumulatedDepreciation.isZero() || !b.impairment.isZero()) {
        issues.push({ assetId: a.id, assetNumber: a.assetNumber, issue: 'DISPOSED_WITH_RESIDUAL_BALANCE', detail: `cost ${b.grossCarrying.toFixed(2)}, acc.dep ${b.accumulatedDepreciation.toFixed(2)}, impairment ${b.impairment.toFixed(2)}` });
      }
      if (a.disposalDate) {
        const late = await this.prisma.fixedAssetMovement.count({ where: { tenantId, assetId: a.id, movementType: MovementType.DEPRECIATION, bookCode: Books.ACCOUNTING_BOOK, businessDate: { gt: a.disposalDate }, reversalOfMovementId: null } });
        if (late > 0) issues.push({ assetId: a.id, assetNumber: a.assetNumber, issue: 'DISPOSED_ASSET_STILL_DEPRECIATING' });
      }
    }
    return issues;
  }
}
