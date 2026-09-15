import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FixedAssetMovementService } from './fixed-asset-movement.service';

const DEPRECIATION_SOURCE_TYPE = 'FIXED_ASSET_DEPRECIATION_RUN';

/**
 * FixedAssetDepreciationService — the month-close entry point (spec
 * section 93: `calculateFixedAssetDepreciation(period)` then
 * `validateFixedAssetClose(period)`), mirroring `InventoryCostCalculationRun`'s
 * own calculate-then-post shape (Phase 11) rather than the generic
 * DocumentFramework (a run touches many assets at once, not one document).
 * Only STRAIGHT_LINE is computed (spec section 21's own "bu Phase-də ən
 * azı Straight Line tam işləməlidir"); other `depreciationMethod` values
 * are accepted on `FixedAsset` but produce a `UNSUPPORTED_METHOD` error
 * entry instead of a silently-wrong number. Only `ACCOUNTING_BOOK` is
 * computed (disclosed simplification, see docs/FIXED_ASSETS.md).
 */
@Injectable()
export class FixedAssetDepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
    private readonly movements: FixedAssetMovementService,
  ) {}

  /** Preview never posts GL and never writes movements (spec section 32)
   * — it re-uses the same per-asset calculation as `calculate`, just
   * without persisting a run. */
  async preview(tenantId: string, membershipId: string, organizationId: string, period: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = this.periodStart(period);
    const assets = await this.eligibleAssets(tenantId, organizationId, periodStart);
    return assets.map((asset) => this.calculateForAsset(asset, periodStart));
  }

  /** Calculates and persists a DRAFT->CALCULATED run with one entry per
   * eligible asset — idempotent per spec section 33's own logical key
   * (asset + valuationBook + period + runType), enforced by the run's own
   * DB unique constraint plus the entry's `@@unique([runId, assetId])`. */
  async calculate(tenantId: string, membershipId: string, organizationId: string, userId: string, period: string, runType: 'PERIODIC' | 'RECALCULATION' = 'PERIODIC') {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = this.periodStart(period);
    const existing = await this.prisma.fixedAssetDepreciationRun.findUnique({ where: { tenantId_organizationId_period_valuationBook_runType: { tenantId, organizationId, period: periodStart, valuationBook: 'ACCOUNTING_BOOK', runType } } });
    if (existing && existing.status === 'POSTED') throw new ValidationAppError(`Depreciation for ${period} is already posted for this organization — use RECALCULATION explicitly if you intend to adjust it.`);

    const assets = await this.eligibleAssets(tenantId, organizationId, periodStart);
    const results = assets.map((asset) => this.calculateForAsset(asset, periodStart));
    const totalAmount = results.reduce((s, r) => s.plus(r.depreciationAmount), new Decimal(0));

    return this.prisma.runInTransaction(async (tx) => {
      const run = existing
        ? await tx.fixedAssetDepreciationRun.update({ where: { id: existing.id }, data: { status: 'CALCULATED', startedAt: new Date(), assetCount: results.length, calculatedAmount: totalAmount.toString(), initiatedBy: userId } })
        : await tx.fixedAssetDepreciationRun.create({ data: { tenantId, organizationId, period: periodStart, valuationBook: 'ACCOUNTING_BOOK', runType, status: 'CALCULATED', startedAt: new Date(), assetCount: results.length, calculatedAmount: totalAmount.toString(), initiatedBy: userId } });
      if (existing) await tx.fixedAssetDepreciationEntry.deleteMany({ where: { runId: existing.id } });
      for (const r of results) {
        await tx.fixedAssetDepreciationEntry.create({ data: { tenantId, runId: run.id, assetId: r.assetId, openingNbv: r.openingNbv.toString(), depreciationAmount: r.depreciationAmount.toString(), closingNbv: r.closingNbv.toString(), errorCode: r.errorCode } });
      }
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_DEPRECIATION_CALCULATED', entityType: 'FIXED_ASSET_DEPRECIATION_RUN', entityId: run.id, action: existing ? 'UPDATE' : 'CREATE', userId, newValues: { period, assetCount: results.length, totalAmount: totalAmount.toString() } }, tx);
      return run;
    });
  }

  /** Posts a CALCULATED run: writes one DEPRECIATION movement per
   * error-free entry and one consolidated GL batch (Dr Depreciation
   * Expense / Cr Accumulated Depreciation) for the whole run — mirrors
   * `AccountingPostingEngine.postBatch`'s own standalone-batch contract
   * (this run is not itself a DocumentFramework document). Blocks
   * entirely if ANY entry still carries an error (spec section 93's own
   * "Month Close cannot finalize if blocking depreciation errors exist"). */
  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, runId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { id: runId, tenantId, organizationId } });
    if (!run) throw new ValidationAppError('Depreciation run not found');
    if (run.status === 'POSTED') throw new ValidationAppError('Run is already posted');
    if (run.status !== 'CALCULATED') throw new ValidationAppError(`Run must be CALCULATED before posting (currently ${run.status})`);

    const entries = await this.prisma.fixedAssetDepreciationEntry.findMany({ where: { runId } });
    const blocking = entries.filter((e) => e.errorCode);
    if (blocking.length > 0) throw new ValidationAppError(`Cannot post — ${blocking.length} asset(s) have a depreciation error: ${blocking.map((e) => e.errorCode).join(', ')}`);

    const postable = entries.filter((e) => new Decimal(e.depreciationAmount.toString()).gt(0));
    const businessDate = new Date(Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth() + 1, 0)); // last day of the period month

    return this.prisma.runInTransaction(async (tx) => {
      for (const entry of postable) {
        await this.movements.record(tenantId, { organizationId, assetId: entry.assetId, movementType: 'DEPRECIATION', depreciationIncrease: new Decimal(entry.depreciationAmount.toString()), sourceDocumentType: DEPRECIATION_SOURCE_TYPE, sourceDocumentId: run.id, effectiveDate: businessDate }, tx);
        await tx.fixedAsset.update({ where: { id: entry.assetId }, data: { remainingUsefulLifeMonths: { decrement: 1 } } });
        await tx.fixedAssetDepreciationEntry.update({ where: { id: entry.id }, data: { posted: true } });
      }

      const expenseAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.DEPRECIATION_EXPENSE, businessDate, tx).catch(() => null);
      const accumulatedAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.ACCUMULATED_DEPRECIATION, businessDate, tx).catch(() => null);
      let postingBatchId: string | null = null;
      const totalAmount = postable.reduce((s, e) => s.plus(e.depreciationAmount.toString()), new Decimal(0));
      if (expenseAccount && accumulatedAccount && totalAmount.gt(0)) {
        const asset = postable.length === 1 ? await tx.fixedAsset.findUnique({ where: { id: postable[0].assetId } }) : null;
        const batch = await this.postingEngine.postBatch(
          tenantId,
          userId,
          {
            organizationId,
            businessDate,
            description: `Fixed asset depreciation ${run.period.toISOString().slice(0, 7)}`,
            operationType: 'SYSTEM_DOCUMENT',
            sourceDocumentType: DEPRECIATION_SOURCE_TYPE,
            sourceDocumentId: run.id,
            lines: [
              { accountId: expenseAccount.id, side: 'DEBIT', amountBase: totalAmount, description: 'Depreciation expense', dimensions: asset ? [{ dimensionCode: 'FIXED_ASSET', referenceId: asset.id }] : [] },
              { accountId: accumulatedAccount.id, side: 'CREDIT', amountBase: totalAmount, description: 'Accumulated depreciation', dimensions: asset ? [{ dimensionCode: 'FIXED_ASSET', referenceId: asset.id }] : [] },
            ],
          },
          tx,
        );
        postingBatchId = batch.id;
      }

      const posted = await tx.fixedAssetDepreciationRun.update({ where: { id: runId }, data: { status: 'POSTED', completedAt: new Date(), postingBatchId } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_DEPRECIATION_POSTED', entityType: 'FIXED_ASSET_DEPRECIATION_RUN', entityId: runId, action: 'UPDATE', userId, newValues: { totalAmount: totalAmount.toString(), assetCount: postable.length } }, tx);
      return posted;
    });
  }

  /** Period reopen path (spec section 34) — reverses every DEPRECIATION
   * movement this run wrote and flips the run back to CALCULATED so it
   * can be recalculated/re-posted; history is preserved in
   * FixedAssetMovement (reversed=true), never deleted. */
  async reverse(tenantId: string, membershipId: string, organizationId: string, userId: string, runId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { id: runId, tenantId, organizationId } });
    if (!run) throw new ValidationAppError('Depreciation run not found');
    if (run.status !== 'POSTED') throw new ValidationAppError('Only a POSTED run can be reversed');

    return this.prisma.runInTransaction(async (tx) => {
      await this.movements.reverse(tenantId, DEPRECIATION_SOURCE_TYPE, runId, tx);
      const entries = await tx.fixedAssetDepreciationEntry.findMany({ where: { runId, posted: true } });
      for (const entry of entries) {
        await tx.fixedAsset.update({ where: { id: entry.assetId }, data: { remainingUsefulLifeMonths: { increment: 1 } } });
        await tx.fixedAssetDepreciationEntry.update({ where: { id: entry.id }, data: { posted: false } });
      }
      const reopened = await tx.fixedAssetDepreciationRun.update({ where: { id: runId }, data: { status: 'CALCULATED', postingBatchId: null } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_DEPRECIATION_REVERSED', entityType: 'FIXED_ASSET_DEPRECIATION_RUN', entityId: runId, action: 'UPDATE', userId, newValues: {} }, tx);
      return reopened;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.fixedAssetDepreciationRun.findMany({ where: { tenantId, organizationId }, orderBy: { period: 'desc' } }));
  }

  async entries(tenantId: string, membershipId: string, organizationId: string, runId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetDepreciationEntry.findMany({ where: { runId }, include: { asset: true } });
  }

  /** DEPRECIATION_ERROR register (spec section 94) checked per-asset,
   * inline with calculation rather than a separate scan. */
  private calculateForAsset(asset: any, periodStart: Date): { assetId: string; openingNbv: Decimal; depreciationAmount: Decimal; closingNbv: Decimal; errorCode: string | null } {
    const openingNbv = new Decimal(asset.carryingAmount.toString());
    const residual = new Decimal(asset.residualValue.toString());

    if (!asset.usefulLifeMonths) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: 'MISSING_USEFUL_LIFE' };
    if (!asset.commissioningDate) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: 'MISSING_COMMISSIONING_DATE' };
    if (residual.lt(0)) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: 'INVALID_RESIDUAL_VALUE' };
    if (asset.depreciationMethod !== 'STRAIGHT_LINE') return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: 'UNSUPPORTED_METHOD' };
    if (['DISPOSED', 'WRITTEN_OFF'].includes(asset.status)) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: 'DISPOSED_ASSET_STILL_DEPRECIATING' };
    if (!asset.depreciationEligible) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: null }; // suspended with PAUSE_DEPRECIATION — not an error, just zero
    if (!this.hasStarted(asset, periodStart)) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: null };

    const depreciableAmount = new Decimal(asset.initialCost.toString()).minus(residual);
    const monthly = asset.usefulLifeMonths > 0 ? depreciableAmount.dividedBy(asset.usefulLifeMonths) : new Decimal(0);
    const remainingMonths = asset.remainingUsefulLifeMonths ?? 0;
    const remainingDepreciable = openingNbv.minus(residual);
    if (remainingDepreciable.lte(0)) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: null }; // spec section 96/97 — fully depreciated, stays ACTIVE, just no more expense

    // Final-period true-up (spec section 98): the last month absorbs any
    // rounding remainder so accumulated depreciation lands exactly on the
    // depreciable amount rather than drifting a cent short/over.
    const amount = remainingMonths <= 1 ? remainingDepreciable : Decimal.min(monthly, remainingDepreciable);
    const closingNbv = openingNbv.minus(amount);
    if (closingNbv.lt(residual.minus('0.01'))) return { assetId: asset.id, openingNbv, depreciationAmount: new Decimal(0), closingNbv: openingNbv, errorCode: 'NEGATIVE_NBV' };

    return { assetId: asset.id, openingNbv, depreciationAmount: amount, closingNbv, errorCode: null };
  }

  /** Depreciation start rule (spec section 20) applied against the
   * period being calculated. */
  private hasStarted(asset: any, periodStart: Date): boolean {
    if (!asset.commissioningDate) return false;
    const commissioning: Date = asset.commissioningDate;
    let startDate: Date;
    switch (asset.depreciationStartRule) {
      case 'FROM_COMMISSIONING_DATE':
        startDate = commissioning;
        break;
      case 'NEXT_DAY':
        startDate = new Date(commissioning.getTime() + 86_400_000);
        break;
      case 'NEXT_MONTH':
      case 'FIRST_DAY_NEXT_MONTH':
      default:
        startDate = new Date(commissioning.getFullYear(), commissioning.getMonth() + 1, 1);
        break;
    }
    return startDate <= new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
  }

  private async eligibleAssets(tenantId: string, organizationId: string, periodStart: Date) {
    return this.prisma.fixedAsset.findMany({ where: { tenantId, organizationId, status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'ACQUISITION', 'UNDER_CONSTRUCTION'] }, commissioningDate: { not: null, lte: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0)) } } });
  }

  private periodStart(period: string): Date {
    const date = new Date(`${period}-01T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('period must be YYYY-MM');
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
}
