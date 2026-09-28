import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import {
  AccountingPostingEngine,
  AccountingPostingLineInput,
} from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  FixedAssetBalanceService,
  FIXED_ASSET_MOVEMENT_REGISTER,
} from './fixed-asset-balance.service';
import { CalculateDepreciationDto } from './dto/fixed-asset.dto';

const RUN_TYPE = 'FIXED_ASSET_DEPRECIATION_RUN';
const VALUATION_BOOK = 'ACCOUNTING_BOOK';

/**
 * FixedAssetDepreciationService (docx spec Phase 16 sections 21-38) —
 * Straight-Line only (spec section 21: "Bu Phase-də ən azı Straight Line
 * tam işləməlidir"); DECLINING_BALANCE/UNITS_OF_PRODUCTION/etc. are
 * schema-ready (`FixedAsset.depreciationMethod` is a free string, not an
 * enum) but not implemented — disclosed in docs/FIXED_ASSETS.md.
 *
 * The rate is recomputed FRESH every period from the asset's live NBV
 * (never cached), which is what makes impairment/useful-life-change
 * prospective recalculation and final-period true-up all fall out of the
 * SAME formula rather than needing separate special-case code:
 *
 *   checkpoint      = latest FixedAssetPolicyChange.effectiveDate, else depreciationStartDate
 *   remainingMonths = usefulLifeMonths (current) - (POSTED periods already run since checkpoint's month)
 *   openingNbv      = live NBV as of (period start - 1 day)
 *   depreciableNow  = openingNbv - residualValue (current)
 *   periodAmount    = min(depreciableNow / remainingMonths, depreciableNow), clamped >= 0
 *
 * `remainingMonths <= 0` (fully depreciated) or `depreciableNow <= 0`
 * yields zero — the asset stays ACTIVE, never auto-disposed (spec section
 * 96-97).
 */
@Injectable()
export class FixedAssetDepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
    private readonly balances: FixedAssetBalanceService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.fixedAssetDepreciationRun.findMany({
          where: { organizationId },
          orderBy: { period: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.fixedAssetDepreciationRun.findFirst({
      where: { id, organizationId },
      include: { lines: true },
    });
    if (!row) throw new NotFoundAppError('FixedAssetDepreciationRun', id);
    return row;
  }

  /** Preview/Calculate (spec section 32: preview never writes GL — only
   * `post()` does). Idempotent per (organization, period, book): re-
   * calling replaces this run's own lines with a fresh computation
   * (RECALCULATION), never duplicating the run row itself. */
  async calculate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CalculateDepreciationDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = this.normalizePeriod(dto.period);

    return this.prisma.runInTransaction(async (tx) => {
      let run = await tx.fixedAssetDepreciationRun.findUnique({
        where: {
          organizationId_period_valuationBook: {
            organizationId,
            period,
            valuationBook: VALUATION_BOOK,
          },
        },
      });
      if (run?.status === 'POSTED')
        throw new ValidationAppError(
          `Depreciation for ${period.toISOString().slice(0, 7)} is already posted — reopen the period to recalculate`,
        );

      if (!run) {
        run = await tx.fixedAssetDepreciationRun.create({
          data: {
            tenantId,
            organizationId,
            period,
            valuationBook: VALUATION_BOOK,
            runType: dto.runType ?? 'PERIODIC',
            status: 'DRAFT',
            startedAt: new Date(),
            initiatedBy: userId,
          },
        });
      } else {
        await tx.fixedAssetDepreciationLine.deleteMany({
          where: { runId: run.id },
        });
      }

      const eligibleAssets = await tx.fixedAsset.findMany({
        where: {
          tenantId,
          organizationId,
          status: 'ACTIVE',
          commissioningDate: { not: null },
          depreciationStartDate: { lte: this.endOfMonth(period) },
        },
      });

      let totalAmount = new Decimal(0);
      let assetCount = 0;
      const errors: string[] = [];

      for (const asset of eligibleAssets) {
        if (!asset.usefulLifeMonths) {
          errors.push(
            `Asset ${asset.assetNumber ?? asset.id}: missing useful life`,
          );
          continue;
        }

        const amount = await this.computePeriodDepreciation(
          tenantId,
          organizationId,
          asset,
          period,
          tx,
        );
        if (amount.lte(0)) continue;

        const openingNbv = (
          await this.balances.getBalances(
            tenantId,
            asset.id,
            this.dayBefore(period),
            tx,
          )
        ).netBookValue;
        await tx.fixedAssetDepreciationLine.create({
          data: {
            tenantId,
            runId: run.id,
            assetId: asset.id,
            openingNbv,
            depreciationAmount: amount,
            closingNbv: openingNbv.minus(amount),
          },
        });
        totalAmount = totalAmount.plus(amount);
        assetCount += 1;
      }

      const updated = await tx.fixedAssetDepreciationRun.update({
        where: { id: run.id },
        data: {
          status: 'CALCULATED',
          assetCount,
          calculatedAmount: totalAmount,
          errors: errors.length > 0 ? errors : Prisma.JsonNull,
          completedAt: new Date(),
          version: { increment: run.status === 'DRAFT' ? 0 : 1 },
        },
        include: { lines: true },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_DEPRECIATION_CALCULATED',
          entityType: RUN_TYPE,
          entityId: run.id,
          action: 'UPDATE',
          userId,
          newValues: {
            period: period.toISOString().slice(0, 7),
            assetCount,
            calculatedAmount: totalAmount.toString(),
          },
        },
        tx,
      );
      return updated;
    });
  }

  /** Post (spec section 30) — Dr Depreciation Expense / Cr Accumulated
   * Depreciation, one pair per asset line for full FIXED_ASSET/DEPARTMENT
   * traceability, all under one journal entry per run. Idempotent: the
   * run's own status check plus AccountingPostingEngine.postBatch's
   * per-sourceDocumentId duplicate guard both block a double-post. */
  async post(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = await this.get(tenantId, membershipId, organizationId, id);
    if (run.status === 'POSTED')
      throw new ValidationAppError('This depreciation run is already posted');
    if (run.status !== 'CALCULATED')
      throw new ValidationAppError(
        `Cannot post a run in status ${run.status} — calculate it first`,
      );
    if (run.version !== expectedVersion) throw new ConcurrencyConflictError();
    if (run.lines.length === 0)
      throw new ValidationAppError(
        'Nothing to post — no eligible depreciation for this period',
      );

    return this.prisma.runInTransaction(async (tx) => {
      const expenseAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.DEPRECIATION_EXPENSE,
        run.period,
        tx,
      );
      const accumulatedAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.ACCUMULATED_DEPRECIATION,
        run.period,
        tx,
      );

      const lines: AccountingPostingLineInput[] = [];
      for (const line of run.lines) {
        const asset = await tx.fixedAsset.findUnique({
          where: { id: line.assetId },
        });
        if (!asset) continue;
        const dims = [
          { dimensionCode: 'FIXED_ASSET', referenceId: asset.id },
          ...(asset.departmentId
            ? [{ dimensionCode: 'DEPARTMENT', referenceId: asset.departmentId }]
            : []),
        ];
        lines.push({
          accountId: expenseAccount.id,
          side: 'DEBIT',
          amountBase: new Decimal(line.depreciationAmount.toString()),
          description: `Depreciation ${run.period.toISOString().slice(0, 7)} — ${asset.name}`,
          dimensions: dims,
        });
        lines.push({
          accountId: accumulatedAccount.id,
          side: 'CREDIT',
          amountBase: new Decimal(line.depreciationAmount.toString()),
          description: `Depreciation ${run.period.toISOString().slice(0, 7)} — ${asset.name}`,
          dimensions: [{ dimensionCode: 'FIXED_ASSET', referenceId: asset.id }],
        });

        const sequence = await this.balances.nextSequence(
          tenantId,
          RUN_TYPE,
          run.id,
          tx,
        );
        await tx.registerMovement.create({
          data: {
            tenantId,
            registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
            recorderDocumentType: RUN_TYPE,
            recorderDocumentId: run.id,
            businessDate: run.period,
            movementType: 'DEPRECIATION',
            dimensions: { organizationId, assetId: asset.id },
            resources: {
              depreciationIncrease: line.depreciationAmount.toString(),
            },
            sequence,
          },
        });
      }

      const posted = await this.accountingEngine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate: run.period,
          postingDate: run.period,
          description: `Fixed asset depreciation ${run.period.toISOString().slice(0, 7)}`,
          operationType: 'SYSTEM_DOCUMENT',
          sourceDocumentType: RUN_TYPE,
          sourceDocumentId: run.id,
          lines,
        },
        tx,
      );

      const result = await tx.fixedAssetDepreciationRun.updateMany({
        where: { id, organizationId, version: expectedVersion },
        data: {
          status: 'POSTED',
          journalEntryId: posted?.id,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'FIXED_ASSET_DEPRECIATION_POSTED',
          entityType: RUN_TYPE,
          entityId: id,
          action: 'POST',
          userId,
          newValues: {
            period: run.period.toISOString().slice(0, 7),
            calculatedAmount: run.calculatedAmount.toString(),
          },
        },
        tx,
      );
      return tx.fixedAssetDepreciationRun.findFirst({
        where: { id },
        include: { lines: true },
      });
    });
  }

  private async computePeriodDepreciation(
    tenantId: string,
    organizationId: string,
    asset: {
      id: string;
      usefulLifeMonths: number | null;
      residualValue: any;
      depreciationStartDate: Date | null;
    },
    period: Date,
    tx: PrismaTransactionClient,
  ): Promise<Decimal> {
    if (!asset.usefulLifeMonths || !asset.depreciationStartDate)
      return new Decimal(0);

    const latestChange = await tx.fixedAssetPolicyChange.findFirst({
      where: {
        assetId: asset.id,
        effectiveDate: { lte: this.endOfMonth(period) },
      },
      orderBy: { effectiveDate: 'desc' },
    });
    const checkpointDate =
      latestChange?.effectiveDate ?? asset.depreciationStartDate;
    const checkpointMonth = new Date(
      Date.UTC(
        checkpointDate.getUTCFullYear(),
        checkpointDate.getUTCMonth(),
        1,
      ),
    );

    const priorPeriods = await tx.fixedAssetDepreciationLine.count({
      where: {
        assetId: asset.id,
        run: {
          organizationId,
          valuationBook: VALUATION_BOOK,
          status: 'POSTED',
          period: { gte: checkpointMonth, lt: period },
        },
      },
    });
    const remainingMonths = asset.usefulLifeMonths - priorPeriods;
    if (remainingMonths <= 0) return new Decimal(0);

    const openingNbv = (
      await this.balances.getBalances(
        tenantId,
        asset.id,
        this.dayBefore(period),
        tx,
      )
    ).netBookValue;
    const depreciableNow = openingNbv.minus(
      new Decimal(asset.residualValue.toString()),
    );
    if (depreciableNow.lte(0)) return new Decimal(0);

    const raw = depreciableNow.div(remainingMonths);
    const amount = Decimal.min(raw, depreciableNow);
    return amount.lt(0) ? new Decimal(0) : new Decimal(amount.toFixed(2));
  }

  private normalizePeriod(value: string): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
      throw new ValidationAppError('Invalid period');
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  private endOfMonth(period: Date): Date {
    return new Date(
      Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0),
    );
  }

  private dayBefore(period: Date): Date {
    const d = new Date(period);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
}
