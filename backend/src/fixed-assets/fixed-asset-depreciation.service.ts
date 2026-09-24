import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PeriodService } from '../period/period.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountMappingNotFoundError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import {
  AssetStatus,
  BOOK_CODES,
  Books,
  FaDocumentType,
  FaSourceType,
  IN_USE_STATUSES,
  MovementType,
  dec,
  formatPeriodLabel,
  periodBounds,
} from './fixed-assets.constants';
import { FixedAssetLedgerService } from './fixed-asset-ledger.service';
import { FixedAssetAccountingService } from './fixed-asset-accounting.service';
import { FixedAssetDocumentService } from './fixed-asset-document.service';
import { FixedAssetHistoryService } from './fixed-asset-history.service';
import { DepreciationPolicyService } from './depreciation-policy.service';
import { DepreciationStrategyRegistry } from './depreciation/depreciation-strategies';
import { UnsupportedDepreciationMethodError } from './depreciation/depreciation-strategy';
import { DepreciationDuplicateError, DepreciationStaleError, FixedAssetInvalidStateError } from './fixed-asset.errors';

/** Depreciation error register codes (spec section 94). */
export const DepreciationErrorCode = {
  MISSING_USEFUL_LIFE: 'MISSING_USEFUL_LIFE',
  MISSING_COMMISSIONING_DATE: 'MISSING_COMMISSIONING_DATE',
  INVALID_RESIDUAL_VALUE: 'INVALID_RESIDUAL_VALUE',
  MISSING_ACCOUNT_MAPPING: 'MISSING_ACCOUNT_MAPPING',
  DISPOSED_ASSET_DEPRECIATING: 'DISPOSED_ASSET_DEPRECIATING',
  DUPLICATED_DEPRECIATION: 'DUPLICATED_DEPRECIATION',
  NEGATIVE_NBV: 'NEGATIVE_NBV',
  EXPIRED_USEFUL_LIFE_WITH_RESIDUAL_COST: 'EXPIRED_USEFUL_LIFE_WITH_RESIDUAL_COST',
  INVALID_EFFECTIVE_PARAMETER: 'INVALID_EFFECTIVE_PARAMETER',
  UNSUPPORTED_METHOD: 'UNSUPPORTED_METHOD',
} as const;

export interface ComputedLine {
  assetId: string;
  assetNumber: string;
  assetName: string;
  status: 'CALCULATED' | 'SKIPPED' | 'ERROR';
  skipReason?: string;
  errorCode?: string;
  errorMessage?: string;
  openingCost: Decimal;
  openingAccumulatedDepreciation: Decimal;
  openingImpairment: Decimal;
  openingNbv: Decimal;
  residualValue: Decimal;
  usefulLifeMonths: number | null;
  remainingLifeBefore: number | null;
  depreciationAmount: Decimal;
  closingAccumulatedDepreciation: Decimal;
  closingNbv: Decimal;
  method: string | null;
  prorationFactor: Decimal | null;
  departmentId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  expenseType: string | null;
  expenseAccountId: string | null;
  accumulatedAccountId: string | null;
  basisSequence: bigint;
}

/**
 * FixedAssetDepreciationService (spec sections 28-34, 92-100, 110, 162):
 * preview (no GL), versioned calculation runs, posting with balanced
 * journal entries (Dr depreciation expense by department / expense type,
 * Cr accumulated depreciation), controlled reversal after a period reopen,
 * period finalization and the month-close hooks for Phase 22.
 */
@Injectable()
export class FixedAssetDepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly periods: PeriodService,
    private readonly orgAccess: OrganizationAccessService,
    private readonly ledger: FixedAssetLedgerService,
    private readonly accounting: FixedAssetAccountingService,
    private readonly documents: FixedAssetDocumentService,
    private readonly history: FixedAssetHistoryService,
    private readonly policies: DepreciationPolicyService,
    private readonly strategies: DepreciationStrategyRegistry,
  ) {}

  private validatePeriod(period: string, book: string) {
    try {
      periodBounds(period);
    } catch {
      throw new ValidationAppError(`Invalid period ${period}; expected YYYY-MM`);
    }
    if (!BOOK_CODES.includes(book as any)) throw new ValidationAppError(`Unknown valuation book ${book}`);
  }

  /** Pure calculation for one period (spec section 29 checks). */
  async compute(tenantId: string, organizationId: string, period: string, book: string, client?: PrismaTransactionClient): Promise<ComputedLine[]> {
    const c = client ?? this.prisma;
    const { start, end } = periodBounds(period);
    const assets = await c.fixedAsset.findMany({
      where: {
        tenantId,
        organizationId,
        status: { in: IN_USE_STATUSES },
        ...(book !== Books.ACCOUNTING_BOOK ? { bookPolicies: { some: { bookCode: book, reversed: false } } } : {}),
      },
      include: { category: true },
      orderBy: { assetNumber: 'asc' },
    });
    const out: ComputedLine[] = [];
    for (const asset of assets) {
      const base: ComputedLine = {
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        assetName: asset.name,
        status: 'CALCULATED',
        openingCost: new Decimal(0),
        openingAccumulatedDepreciation: new Decimal(0),
        openingImpairment: new Decimal(0),
        openingNbv: new Decimal(0),
        residualValue: new Decimal(0),
        usefulLifeMonths: null,
        remainingLifeBefore: null,
        depreciationAmount: new Decimal(0),
        closingAccumulatedDepreciation: new Decimal(0),
        closingNbv: new Decimal(0),
        method: null,
        prorationFactor: null,
        departmentId: null,
        costCenterId: null,
        projectId: null,
        expenseType: null,
        expenseAccountId: null,
        accumulatedAccountId: null,
        basisSequence: 0n,
      };
      const err = (code: string, message: string): ComputedLine => ({ ...base, status: 'ERROR', errorCode: code, errorMessage: message });
      const skip = (reason: string, extra: Partial<ComputedLine> = {}): ComputedLine => ({ ...base, ...extra, status: 'SKIPPED', skipReason: reason });

      if (!asset.commissioningDate || !asset.depreciationStartDate) {
        out.push(err(DepreciationErrorCode.MISSING_COMMISSIONING_DATE, `Asset ${asset.assetNumber} is ${asset.status} but has no commissioning / depreciation start date.`));
        continue;
      }
      if (asset.depreciationStartDate.getTime() > end.getTime()) continue; // not yet eligible
      const posted = await c.fixedAssetDepreciationLine.count({ where: { tenantId, assetId: asset.id, bookCode: book, period, status: 'POSTED' } });
      if (posted > 1) {
        out.push(err(DepreciationErrorCode.DUPLICATED_DEPRECIATION, `Asset ${asset.assetNumber} has ${posted} posted depreciations for ${period}.`));
        continue;
      }
      if (posted === 1) {
        out.push(skip('ALREADY_DEPRECIATED'));
        continue;
      }
      const policy = await this.policies.resolvePolicy(tenantId, organizationId, asset.categoryId, end, book, c);
      if (asset.status === AssetStatus.SUSPENDED || asset.status === AssetStatus.CONSERVED) {
        const statusDoc = await c.fixedAssetDocument.findFirst({
          where: { tenantId, documentType: FaDocumentType.STATUS_CHANGE, reversedAt: null, operationKind: asset.status, lines: { some: { assetId: asset.id } } },
          orderBy: { createdAt: 'desc' },
        });
        const p = ((statusDoc?.payload as any)?.depreciationPolicy as string | null) ?? policy.suspensionDepreciationPolicy;
        if (p !== 'CONTINUE_DEPRECIATION') {
          out.push(skip(`${asset.status}_PAUSED`));
          continue;
        }
      }
      if (asset.status === AssetStatus.HELD_FOR_SALE && !policy.heldForSaleDepreciates) {
        out.push(skip('HELD_FOR_SALE'));
        continue;
      }
      if (asset.status === AssetStatus.UNDER_MODERNIZATION && !policy.modernizationDepreciates) {
        out.push(skip('UNDER_MODERNIZATION'));
        continue;
      }

      const bp = await this.policies.effectiveBookPolicy(tenantId, asset.id, book, period, c);
      if (!bp) {
        out.push(err(DepreciationErrorCode.INVALID_EFFECTIVE_PARAMETER, `Asset ${asset.assetNumber} has no ${book} depreciation parameters effective for ${period}.`));
        continue;
      }
      if (!bp.usefulLifeMonths || bp.remainingLifeMonths === null) {
        out.push(err(DepreciationErrorCode.MISSING_USEFUL_LIFE, `Depreciation cannot be calculated because useful life is not defined (asset ${asset.assetNumber}).`));
        continue;
      }
      const remaining = (await this.policies.remainingLifeAt(tenantId, asset.id, book, bp, period, c)) ?? 0;
      const b = await this.ledger.balances(tenantId, asset.id, { asOf: end, book, tx: c });
      const residual = dec(bp.residualValue);
      const costBasis = bp.costBasisOverride ? dec(bp.costBasisOverride) : b.grossCarrying;
      Object.assign(base, {
        openingCost: b.grossCarrying,
        openingAccumulatedDepreciation: b.accumulatedDepreciation,
        openingImpairment: b.impairment,
        openingNbv: b.netBookValue,
        residualValue: residual,
        usefulLifeMonths: bp.usefulLifeMonths,
        remainingLifeBefore: remaining,
        method: bp.depreciationMethod,
        closingAccumulatedDepreciation: b.accumulatedDepreciation,
        closingNbv: b.netBookValue,
      });
      if (residual.lt(0) || residual.gte(costBasis)) {
        out.push(err(DepreciationErrorCode.INVALID_RESIDUAL_VALUE, `Residual value ${residual.toFixed(2)} of asset ${asset.assetNumber} is invalid for cost ${costBasis.toFixed(2)}.`));
        continue;
      }
      if (b.netBookValue.lt(0)) {
        out.push(err(DepreciationErrorCode.NEGATIVE_NBV, `Asset ${asset.assetNumber} has a negative net book value (${b.netBookValue.toFixed(2)}).`));
        continue;
      }
      const depreciable = costBasis.minus(b.accumulatedDepreciation).minus(b.impairment).minus(residual);
      if (depreciable.lte(0)) {
        // Fully depreciated but still in use: no further depreciation, the
        // asset is NOT disposed and stays ACTIVE (spec sections 96-97).
        out.push(skip('FULLY_DEPRECIATED'));
        continue;
      }
      if (remaining <= 0) {
        out.push(err(DepreciationErrorCode.EXPIRED_USEFUL_LIFE_WITH_RESIDUAL_COST, `Useful life of asset ${asset.assetNumber} has expired but ${depreciable.toFixed(2)} remains undepreciated above residual value.`));
        continue;
      }
      // Partial-period rule only bites in the period depreciation starts in.
      const factor = this.policies.prorationFactor(period, asset.depreciationStartDate, bp.partialPeriodRule);
      let amount: Decimal;
      try {
        amount = this.strategies
          .get(bp.depreciationMethod)
          .calculate({
            costBasis,
            accumulatedDepreciation: b.accumulatedDepreciation,
            impairment: b.impairment,
            residualValue: residual,
            remainingPeriods: remaining,
            usefulLifeMonths: bp.usefulLifeMonths,
            ratePercent: bp.depreciationRate ? dec(bp.depreciationRate) : null,
            prorationFactor: factor,
            precision: policy.roundingPrecision,
          }).amount;
      } catch (e) {
        if (e instanceof UnsupportedDepreciationMethodError) {
          out.push(err(DepreciationErrorCode.UNSUPPORTED_METHOD, `${e.message} (asset ${asset.assetNumber}).`));
          continue;
        }
        throw e;
      }
      if (amount.lte(0)) {
        out.push(skip('ZERO_AMOUNT'));
        continue;
      }
      const assignmentDate = policy.transferExpenseRule === 'PERIOD_START_ASSIGNMENT' ? start : end;
      const assignment = (await this.history.assignmentAt(tenantId, asset.id, assignmentDate, c)) ?? (await this.history.currentAssignment(tenantId, asset.id, c));
      const expenseType = assignment?.expenseType ?? asset.expenseType ?? asset.category.defaultExpenseType;
      let expenseAccountId: string | null = null;
      let accumulatedAccountId: string | null = null;
      if (book === Books.ACCOUNTING_BOOK) {
        try {
          expenseAccountId = (await this.accounting.resolve(tenantId, organizationId, this.accounting.depreciationExpenseKey(expenseType), end, asset.category.accountingMappingProfile, c)).id;
          accumulatedAccountId = (await this.accounting.resolve(tenantId, organizationId, MappingKeys.FA_ACCUMULATED_DEPRECIATION, end, asset.category.accountingMappingProfile, c)).id;
        } catch (e) {
          if (e instanceof AccountMappingNotFoundError) {
            out.push(err(DepreciationErrorCode.MISSING_ACCOUNT_MAPPING, `${e.message} (asset ${asset.assetNumber}).`));
            continue;
          }
          throw e;
        }
      }
      out.push({
        ...base,
        depreciationAmount: amount,
        closingAccumulatedDepreciation: b.accumulatedDepreciation.plus(amount),
        closingNbv: b.netBookValue.minus(amount),
        prorationFactor: factor,
        departmentId: assignment?.departmentId ?? asset.departmentId,
        costCenterId: assignment?.costCenterId ?? asset.costCenterId,
        projectId: assignment?.projectId ?? asset.projectId,
        expenseType,
        expenseAccountId,
        accumulatedAccountId,
        basisSequence: await this.ledger.latestSequence(c, tenantId, asset.id),
      });
    }
    return out;
  }

  private summarize(lines: ComputedLine[]) {
    const calc = lines.filter((l) => l.status === 'CALCULATED');
    return {
      eligibleAssets: lines.length,
      calculated: calc.length,
      skipped: lines.filter((l) => l.status === 'SKIPPED').length,
      errors: lines.filter((l) => l.status === 'ERROR').length,
      totalDepreciation: calc.reduce((s, l) => s.plus(l.depreciationAmount), new Decimal(0)).toString(),
    };
  }

  private present(l: ComputedLine) {
    return {
      assetId: l.assetId,
      assetNumber: l.assetNumber,
      assetName: l.assetName,
      status: l.status,
      skipReason: l.skipReason ?? null,
      errorCode: l.errorCode ?? null,
      errorMessage: l.errorMessage ?? null,
      openingCost: l.openingCost.toString(),
      openingAccumulatedDepreciation: l.openingAccumulatedDepreciation.toString(),
      openingNbv: l.openingNbv.toString(),
      usefulLifeMonths: l.usefulLifeMonths,
      remainingLifeBefore: l.remainingLifeBefore,
      periodDepreciation: l.depreciationAmount.toString(),
      accumulatedDepreciation: l.closingAccumulatedDepreciation.toString(),
      closingNbv: l.closingNbv.toString(),
      departmentId: l.departmentId,
      expenseType: l.expenseType,
    };
  }

  /** Preview (spec section 32): never writes anything, never touches GL. */
  async preview(tenantId: string, membershipId: string, organizationId: string, period: string, book: string = Books.ACCOUNTING_BOOK) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    this.validatePeriod(period, book);
    await this.accounting.ensureSetup(tenantId);
    const lines = await this.compute(tenantId, organizationId, period, book);
    return { period, bookCode: book, runType: 'PREVIEW', ...this.summarize(lines), lines: lines.map((l) => this.present(l)) };
  }

  private async lockPeriod(tx: PrismaTransactionClient, tenantId: string, organizationId: string, book: string, period: string) {
    await tx.fixedAssetDepreciationPeriod.upsert({
      where: { tenantId_organizationId_bookCode_period: { tenantId, organizationId, bookCode: book, period } },
      create: { tenantId, organizationId, bookCode: book, period },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM fixed_asset_depreciation_periods WHERE tenant_id = ${tenantId} AND organization_id = ${organizationId} AND book_code = ${book} AND period = ${period} FOR UPDATE`;
    return tx.fixedAssetDepreciationPeriod.findUniqueOrThrow({ where: { tenantId_organizationId_bookCode_period: { tenantId, organizationId, bookCode: book, period } } });
  }

  async calculate(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { period: string; bookCode?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.calculateInternal(tenantId, organizationId, userId, dto.period, dto.bookCode ?? Books.ACCOUNTING_BOOK);
  }

  async calculateInternal(tenantId: string, organizationId: string, userId: string, period: string, book: string) {
    this.validatePeriod(period, book);
    await this.accounting.ensureSetup(tenantId);
    await this.documents.ensureSequence(tenantId, 'FA_DEPRECIATION_RUN');
    const { start, end } = periodBounds(period);
    const runId = await this.prisma.runInTransaction(async (tx) => {
      const p = await this.lockPeriod(tx, tenantId, organizationId, book, period);
      if (p.status === 'FINALIZED') throw new FixedAssetInvalidStateError(`Depreciation for ${formatPeriodLabel(period)} is finalized; reopen it first.`);
      const lines = await this.compute(tenantId, organizationId, period, book, tx);
      const prev = await tx.fixedAssetDepreciationRun.aggregate({ where: { tenantId, organizationId, bookCode: book, period }, _max: { runVersion: true } });
      const runVersion = (prev._max.runVersion ?? 0) + 1;
      await tx.fixedAssetDepreciationRun.updateMany({ where: { tenantId, organizationId, bookCode: book, period, status: 'CALCULATED' }, data: { status: 'SUPERSEDED' } });
      const summary = this.summarize(lines);
      const errors = lines.filter((l) => l.status === 'ERROR').map((l) => ({ assetId: l.assetId, assetNumber: l.assetNumber, code: l.errorCode, message: l.errorMessage }));
      const number = await this.documents.allocate(tx, tenantId, 'FA_DEPRECIATION_RUN', end);
      const run = await tx.fixedAssetDepreciationRun.create({
        data: {
          tenantId,
          organizationId,
          number,
          period,
          periodStart: start,
          periodEnd: end,
          bookCode: book,
          runType: runVersion > 1 ? 'RECALCULATION' : 'PERIODIC',
          runVersion,
          status: 'CALCULATED',
          completedAt: new Date(),
          initiatedBy: userId,
          assetCount: summary.calculated,
          errorCount: summary.errors,
          calculatedAmount: summary.totalDepreciation,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
      for (const l of lines) {
        await tx.fixedAssetDepreciationLine.create({
          data: {
            tenantId,
            runId: run.id,
            assetId: l.assetId,
            bookCode: book,
            period,
            status: l.status,
            errorCode: l.errorCode ?? (l.skipReason ? l.skipReason : null),
            errorMessage: l.errorMessage,
            openingCost: l.openingCost.toString(),
            openingAccumulatedDepreciation: l.openingAccumulatedDepreciation.toString(),
            openingImpairment: l.openingImpairment.toString(),
            openingNbv: l.openingNbv.toString(),
            residualValue: l.residualValue.toString(),
            usefulLifeMonths: l.usefulLifeMonths,
            remainingLifeBefore: l.remainingLifeBefore,
            depreciationAmount: l.depreciationAmount.toString(),
            closingAccumulatedDepreciation: l.closingAccumulatedDepreciation.toString(),
            closingNbv: l.closingNbv.toString(),
            method: l.method,
            prorationFactor: l.prorationFactor?.toString(),
            departmentId: l.departmentId,
            costCenterId: l.costCenterId,
            projectId: l.projectId,
            expenseType: l.expenseType,
            expenseAccountId: l.expenseAccountId,
            accumulatedAccountId: l.accumulatedAccountId,
            basisSequence: l.basisSequence,
          },
        });
      }
      await tx.fixedAssetDepreciationPeriod.update({ where: { id: p.id }, data: { status: summary.errors > 0 ? 'ERROR' : 'CALCULATED', lastRunId: run.id, version: { increment: 1 } } });
      await this.audit.record(
        { tenantId, eventType: 'FixedAssetDepreciationCalculated', entityType: 'FixedAssetDepreciationRun', entityId: run.id, action: 'CALCULATE', userId, newValues: { period, bookCode: book, runVersion, ...summary } },
        tx,
      );
      return run.id;
    });
    return this.getRun(tenantId, organizationId, runId);
  }

  async getRun(tenantId: string, organizationId: string, runId: string) {
    const run = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { id: runId, tenantId, organizationId }, include: { lines: { orderBy: { createdAt: 'asc' } } } });
    if (!run) throw new NotFoundAppError('FixedAssetDepreciationRun', runId);
    const assets = await this.prisma.fixedAsset.findMany({ where: { id: { in: run.lines.map((l) => l.assetId) } }, select: { id: true, assetNumber: true, name: true } });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return { ...run, lines: run.lines.map((l) => ({ ...l, assetNumber: byId.get(l.assetId)?.assetNumber, assetName: byId.get(l.assetId)?.name })) };
  }

  async getRunChecked(tenantId: string, membershipId: string, organizationId: string, runId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.getRun(tenantId, organizationId, runId);
  }

  async listRuns(tenantId: string, membershipId: string, organizationId: string, filter: { period?: string; bookCode?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.fixedAssetDepreciationRun.findMany({
      where: { tenantId, organizationId, ...(filter.period ? { period: filter.period } : {}), ...(filter.bookCode ? { bookCode: filter.bookCode } : {}) },
      orderBy: [{ period: 'desc' }, { runVersion: 'desc' }],
      take: 200,
    });
  }

  /**
   * Posting (spec sections 30-31, 33, 162). Idempotent: re-posting an
   * already POSTED run returns it unchanged. The period row is locked so
   * two posts for the same period serialize; each line must still match
   * the register state it was calculated on (else: recalculate), and the
   * unique postedKey (asset:book:period) makes a second posted depreciation
   * for the same asset/period impossible at the database level.
   */
  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, runId: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    return this.postInternal(tenantId, organizationId, userId, runId);
  }

  async postInternal(tenantId: string, organizationId: string, userId: string, runId: string) {
    await this.accounting.ensureSetup(tenantId);
    const pre = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { id: runId, tenantId, organizationId } });
    if (!pre) throw new NotFoundAppError('FixedAssetDepreciationRun', runId);
    if (pre.status === 'POSTED') return this.getRun(tenantId, organizationId, runId);
    try {
      await this.prisma.runInTransaction(async (tx) => {
        const p = await this.lockPeriod(tx, tenantId, organizationId, pre.bookCode, pre.period);
        const run = await tx.fixedAssetDepreciationRun.findUniqueOrThrow({ where: { id: runId }, include: { lines: true } });
        if (run.status === 'POSTED') return; // concurrent retry already posted it
        if (run.status !== 'CALCULATED') throw new FixedAssetInvalidStateError(`Depreciation run ${run.number} is ${run.status}; only the latest CALCULATED run can be posted.`);
        if (p.status === 'FINALIZED') throw new FixedAssetInvalidStateError(`Depreciation for ${formatPeriodLabel(run.period)} is finalized.`);
        await this.periods.assertDateIsOpen(tenantId, run.periodEnd, organizationId);

        const toPost = run.lines.filter((l) => l.status === 'CALCULATED' && dec(l.depreciationAmount).gt(0));
        for (const l of toPost) {
          await this.ledger.lockAsset(tx, tenantId, l.assetId);
          const seq = await this.ledger.latestSequence(tx, tenantId, l.assetId);
          if (l.basisSequence !== null && seq !== l.basisSequence) {
            const a = await tx.fixedAsset.findUnique({ where: { id: l.assetId } });
            throw new DepreciationStaleError(`Asset ${a?.assetNumber ?? l.assetId} changed after depreciation run ${run.number} was calculated; recalculate the run before posting.`);
          }
        }

        let journalEntryId: string | null = null;
        if (run.bookCode === Books.ACCOUNTING_BOOK && toPost.length > 0) {
          const lines: AccountingPostingLineInput[] = [];
          const assets = await tx.fixedAsset.findMany({ where: { id: { in: toPost.map((l) => l.assetId) } }, select: { id: true, assetNumber: true } });
          const num = new Map(assets.map((a) => [a.id, a.assetNumber]));
          for (const l of toPost) {
            if (!l.expenseAccountId || !l.accumulatedAccountId) throw new FixedAssetInvalidStateError(`Depreciation line for asset ${num.get(l.assetId)} has no resolved accounts; recalculate.`);
            lines.push(this.accounting.line(l.expenseAccountId, 'DEBIT', dec(l.depreciationAmount), `Depreciation ${run.period} ${num.get(l.assetId)}`, { departmentId: l.departmentId }));
            lines.push(this.accounting.line(l.accumulatedAccountId, 'CREDIT', dec(l.depreciationAmount), `Accumulated depreciation ${run.period} ${num.get(l.assetId)}`, { assetId: l.assetId }));
          }
          const je = await this.accounting.post(
            tenantId,
            userId,
            { organizationId, businessDate: run.periodEnd, description: `Fixed asset depreciation ${formatPeriodLabel(run.period)} (${run.number})`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: FaSourceType.DEPRECIATION_RUN, sourceDocumentId: run.id, lines },
            tx,
          );
          journalEntryId = je?.id ?? null;
        }

        for (const l of toPost) {
          const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id: l.assetId } });
          const m = await this.ledger.write(tx, {
            tenantId,
            organizationId,
            assetId: l.assetId,
            bookCode: run.bookCode,
            movementType: MovementType.DEPRECIATION,
            businessDate: run.periodEnd,
            depreciationIncrease: dec(l.depreciationAmount),
            departmentId: l.departmentId,
            locationId: asset.locationId,
            sourceDocumentType: FaSourceType.DEPRECIATION_RUN,
            sourceDocumentId: run.id,
            sourceDocumentLineId: l.id,
            journalEntryId,
            description: `Depreciation ${run.period}`,
            createdBy: userId,
          });
          await tx.fixedAssetDepreciationLine.update({ where: { id: l.id }, data: { status: 'POSTED', movementId: m.id, postedKey: `${l.assetId}:${run.bookCode}:${run.period}` } });
          if (run.bookCode === Books.ACCOUNTING_BOOK) {
            await this.ledger.refreshProjection(tx, tenantId, l.assetId);
            await this.policies.reprojectParameters(tx, tenantId, l.assetId);
          }
        }
        await tx.fixedAssetDepreciationRun.update({ where: { id: run.id }, data: { status: 'POSTED', postedAt: new Date(), postedBy: userId, postingBatchId: journalEntryId, version: { increment: 1 } } });
        await tx.fixedAssetDepreciationPeriod.update({ where: { id: p.id }, data: { status: run.errorCount > 0 ? 'ERROR' : 'POSTED', lastRunId: run.id, version: { increment: 1 } } });
        await this.audit.record(
          { tenantId, eventType: 'FixedAssetDepreciationPosted', entityType: 'FixedAssetDepreciationRun', entityId: run.id, action: 'POST', userId, newValues: { period: run.period, bookCode: run.bookCode, lines: toPost.length, amount: run.calculatedAmount.toString(), journalEntryId } },
          tx,
        );
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DepreciationDuplicateError(`Depreciation for ${formatPeriodLabel(pre.period)} has already been posted for at least one asset of run ${pre.number}.`);
      }
      throw e;
    }
    return this.getRun(tenantId, organizationId, runId);
  }

  /** Controlled reversal after a period reopen (spec section 34): the
   * run's movements get compensating DEPRECIATION_REVERSAL rows, its JE is
   * reversed (never deleted), and the period becomes REOPENED for a
   * recalculation. Blocked while later operations exist on its assets. */
  async reverse(tenantId: string, membershipId: string, organizationId: string, userId: string, runId: string, reason?: string) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    await this.accounting.ensureSetup(tenantId);
    const pre = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { id: runId, tenantId, organizationId } });
    if (!pre) throw new NotFoundAppError('FixedAssetDepreciationRun', runId);
    await this.prisma.runInTransaction(async (tx) => {
      const p = await this.lockPeriod(tx, tenantId, organizationId, pre.bookCode, pre.period);
      const run = await tx.fixedAssetDepreciationRun.findUniqueOrThrow({ where: { id: runId }, include: { lines: true } });
      if (run.status !== 'POSTED') throw new FixedAssetInvalidStateError(`Depreciation run ${run.number} is ${run.status}; only a POSTED run can be reversed.`);
      if (p.status === 'FINALIZED') throw new FixedAssetInvalidStateError(`Depreciation for ${formatPeriodLabel(run.period)} is finalized; reopen the depreciation period first.`);
      await this.periods.assertDateIsOpen(tenantId, run.periodEnd, organizationId);
      const posted = run.lines.filter((l) => l.status === 'POSTED');
      for (const l of posted) {
        await this.ledger.lockAsset(tx, tenantId, l.assetId);
        await this.ledger.assertLatestOperation(tx, tenantId, l.assetId, FaSourceType.DEPRECIATION_RUN, run.id, `Depreciation run ${run.number}`);
      }
      let reversalJe: string | null = null;
      if (run.postingBatchId) reversalJe = (await this.accounting.reverse(tenantId, run.postingBatchId, userId, run.periodEnd, tx))?.id ?? null;
      await this.ledger.reverseSource(tx, tenantId, FaSourceType.DEPRECIATION_RUN, run.id, run.periodEnd, userId, reversalJe);
      for (const l of posted) {
        await tx.fixedAssetDepreciationLine.update({ where: { id: l.id }, data: { status: 'REVERSED', postedKey: null } });
        if (run.bookCode === Books.ACCOUNTING_BOOK) {
          await this.ledger.refreshProjection(tx, tenantId, l.assetId);
          await this.policies.reprojectParameters(tx, tenantId, l.assetId);
        }
      }
      await tx.fixedAssetDepreciationRun.update({ where: { id: run.id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, reversalReason: reason, reversalJournalEntryId: reversalJe, version: { increment: 1 } } });
      await tx.fixedAssetDepreciationPeriod.update({ where: { id: p.id }, data: { status: 'REOPENED', version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_DEPRECIATION_REVERSED', entityType: 'FixedAssetDepreciationRun', entityId: run.id, action: 'REVERSE', userId, newValues: { period: run.period, reversalJournalEntryId: reversalJe, lines: posted.length }, reason }, tx);
    });
    return this.getRun(tenantId, organizationId, runId);
  }

  /** Month-close validation (spec sections 93-94): blocking errors prevent
   * finalization. Internal API validateFixedAssetClose(period). */
  async validateClose(tenantId: string, organizationId: string, period: string, book: string = Books.ACCOUNTING_BOOK) {
    this.validatePeriod(period, book);
    await this.accounting.ensureSetup(tenantId);
    const lines = await this.compute(tenantId, organizationId, period, book);
    const blocking: { code: string; assetId?: string; assetNumber?: string; message: string }[] = [];
    for (const l of lines) {
      if (l.status === 'ERROR') blocking.push({ code: l.errorCode!, assetId: l.assetId, assetNumber: l.assetNumber, message: l.errorMessage! });
      if (l.status === 'CALCULATED') blocking.push({ code: 'DEPRECIATION_NOT_POSTED', assetId: l.assetId, assetNumber: l.assetNumber, message: `Commissioned asset ${l.assetNumber} has no posted depreciation for ${period}.` });
    }
    const pending = await this.prisma.fixedAssetDepreciationRun.count({ where: { tenantId, organizationId, bookCode: book, period, status: 'CALCULATED' } });
    if (pending > 0) blocking.push({ code: 'RUN_NOT_POSTED', message: `${pending} calculated depreciation run(s) for ${period} are not posted.` });
    const periodRow = await this.prisma.fixedAssetDepreciationPeriod.findUnique({ where: { tenantId_organizationId_bookCode_period: { tenantId, organizationId, bookCode: book, period } } });
    return { period, bookCode: book, status: periodRow?.status ?? 'OPEN', canClose: blocking.length === 0, blockingErrors: blocking, summary: this.summarize(lines) };
  }

  async finalize(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { period: string; bookCode?: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const book = dto.bookCode ?? Books.ACCOUNTING_BOOK;
    const v = await this.validateClose(tenantId, organizationId, dto.period, book);
    if (!v.canClose) throw new FixedAssetInvalidStateError(`Depreciation for ${formatPeriodLabel(dto.period)} cannot be finalized: ${v.blockingErrors.map((b) => b.message).join(' ')}`);
    return this.prisma.runInTransaction(async (tx) => {
      const p = await this.lockPeriod(tx, tenantId, organizationId, book, dto.period);
      const updated = await tx.fixedAssetDepreciationPeriod.update({ where: { id: p.id }, data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_DEPRECIATION_PERIOD_FINALIZED', entityType: 'FixedAssetDepreciationPeriod', entityId: p.id, action: 'FINALIZE', userId, oldValues: { status: p.status }, newValues: { status: 'FINALIZED' } }, tx);
      return updated;
    });
  }

  async reopen(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { period: string; bookCode?: string; reason: string }) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    const book = dto.bookCode ?? Books.ACCOUNTING_BOOK;
    this.validatePeriod(dto.period, book);
    return this.prisma.runInTransaction(async (tx) => {
      const p = await this.lockPeriod(tx, tenantId, organizationId, book, dto.period);
      if (p.status !== 'FINALIZED') throw new FixedAssetInvalidStateError(`Depreciation period ${dto.period} is ${p.status}, not FINALIZED.`);
      const updated = await tx.fixedAssetDepreciationPeriod.update({ where: { id: p.id }, data: { status: 'REOPENED', finalizedAt: null, finalizedBy: null, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'FIXED_ASSET_DEPRECIATION_PERIOD_REOPENED', entityType: 'FixedAssetDepreciationPeriod', entityId: p.id, action: 'REOPEN', userId, oldValues: { status: 'FINALIZED' }, newValues: { status: 'REOPENED' }, reason: dto.reason }, tx);
      return updated;
    });
  }

  /** Depreciation workbench header (spec section 110). */
  async status(tenantId: string, membershipId: string, organizationId: string, period: string, book: string = Books.ACCOUNTING_BOOK) {
    await this.orgAccess.assertAccess(tenantId, membershipId, organizationId);
    this.validatePeriod(period, book);
    const [periodRow, runs] = await Promise.all([
      this.prisma.fixedAssetDepreciationPeriod.findUnique({ where: { tenantId_organizationId_bookCode_period: { tenantId, organizationId, bookCode: book, period } } }),
      this.prisma.fixedAssetDepreciationRun.findMany({ where: { tenantId, organizationId, bookCode: book, period }, orderBy: { runVersion: 'desc' } }),
    ]);
    return { period, bookCode: book, status: periodRow?.status ?? 'OPEN', finalizedAt: periodRow?.finalizedAt ?? null, runs };
  }

  /** Internal API getDepreciationForPeriod. */
  async getDepreciationForPeriod(tenantId: string, assetId: string, period: string, book: string = Books.ACCOUNTING_BOOK) {
    const line = await this.prisma.fixedAssetDepreciationLine.findFirst({ where: { tenantId, assetId, bookCode: book, period, status: 'POSTED' } });
    return line ? dec(line.depreciationAmount) : new Decimal(0);
  }
}
