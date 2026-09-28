import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';

export const FIXED_ASSET_MOVEMENT_REGISTER = 'FIXED_ASSET_MOVEMENT_REGISTER';

export interface FixedAssetBalances {
  grossCost: Decimal;
  accumulatedDepreciation: Decimal;
  accumulatedImpairment: Decimal;
  netBookValue: Decimal;
}

/**
 * FixedAssetBalanceService — the single place a fixed asset's gross cost,
 * accumulated depreciation, accumulated impairment, and Net Book Value are
 * computed (docx spec Phase 16 section 26: "Mutable master field
 * authoritative source olmasın"). Reads the immutable RegisterMovement
 * ledger under FIXED_ASSET_MOVEMENT_REGISTER — the fourth reuse of this
 * codebase's Truth Engine principle (Stock/Cash/Bank came first). Every
 * cost/depreciation/impairment/disposal event writes its own movement
 * there; FixedAsset.initialCost is a display convenience only, never read
 * back as authoritative (see class doc on FixedAsset itself).
 */
@Injectable()
export class FixedAssetBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalances(
    tenantId: string,
    assetId: string,
    asOfDate: Date = new Date(),
    client: PrismaTransactionClient | PrismaService = this.prisma,
    /** Exclude movements already written under this recorder (spec-safe
     * for a handler whose own buildMovements() runs, and writes to the
     * register, BEFORE buildAccountingBatch() is called in the SAME
     * transaction — without this, a live balance re-read inside
     * buildAccountingBatch would see its own not-yet-finalized movement
     * and compute the wrong pre-posting amount). */
    excludeRecorder?: {
      recorderDocumentType: string;
      recorderDocumentId: string;
    },
  ): Promise<FixedAssetBalances> {
    const movements = await client.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate: { lte: asOfDate },
        dimensions: { path: ['assetId'], equals: assetId },
        ...(excludeRecorder
          ? {
              NOT: {
                recorderDocumentType: excludeRecorder.recorderDocumentType,
                recorderDocumentId: excludeRecorder.recorderDocumentId,
              },
            }
          : {}),
      },
    });

    let grossCost = new Decimal(0);
    let accumulatedDepreciation = new Decimal(0);
    let accumulatedImpairment = new Decimal(0);

    for (const m of movements) {
      const r = m.resources as Record<string, string | undefined> | null;
      if (!r) continue;
      if (r.costIncrease) grossCost = grossCost.plus(r.costIncrease);
      if (r.costDecrease) grossCost = grossCost.minus(r.costDecrease);
      if (r.depreciationIncrease)
        accumulatedDepreciation = accumulatedDepreciation.plus(
          r.depreciationIncrease,
        );
      if (r.depreciationDecrease)
        accumulatedDepreciation = accumulatedDepreciation.minus(
          r.depreciationDecrease,
        );
      if (r.impairmentIncrease)
        accumulatedImpairment = accumulatedImpairment.plus(
          r.impairmentIncrease,
        );
      if (r.impairmentDecrease)
        accumulatedImpairment = accumulatedImpairment.minus(
          r.impairmentDecrease,
        );
    }

    return {
      grossCost,
      accumulatedDepreciation,
      accumulatedImpairment,
      netBookValue: grossCost
        .minus(accumulatedDepreciation)
        .minus(accumulatedImpairment),
    };
  }

  /** CIP projects use the SAME register, dimensioned by `cipProjectId`
   * instead of `assetId` — costIncrease as costs are assigned to the
   * project, costDecrease as portions are capitalized out into one or
   * more finished assets (spec section 90: "CIP balance... Remaining
   * CIP"). Never a mutable field on CapitalInvestmentProject either. */
  async getCipBalance(
    tenantId: string,
    cipProjectId: string,
    asOfDate: Date = new Date(),
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Decimal> {
    const movements = await client.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        businessDate: { lte: asOfDate },
        dimensions: { path: ['cipProjectId'], equals: cipProjectId },
      },
    });
    return movements.reduce((sum, m) => {
      const r = m.resources as Record<string, string | undefined> | null;
      if (!r) return sum;
      let next = sum;
      if (r.costIncrease) next = next.plus(r.costIncrease);
      if (r.costDecrease) next = next.minus(r.costDecrease);
      return next;
    }, new Decimal(0));
  }

  /** Concurrency-safe CIP capitalization guard — acquires an advisory
   * lock on `tenantId:cipProjectId` BEFORE the remaining balance is read.
   * The caller (CapitalInvestmentProjectService.capitalize) must call
   * this first, inside the same transaction that then reads the balance
   * and writes the capitalization, so two concurrent capitalize() calls
   * can never both read the same remaining balance and jointly over-
   * consume it — the same advisory-lock-lifecycle lesson this codebase
   * already learned (and had to fix) for bank-statement matching and
   * cash-desk negative-balance control. */
  async lockCip(
    tenantId: string,
    cipProjectId: string,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${cipProjectId}`}))`;
  }

  /** Next sequence for a manually-appended movement on this asset's own
   * recorder document (bespoke commands like depreciation runs, disposal,
   * modernization — anything outside the generic document-posting flow's
   * own sequence counter). */
  async nextSequence(
    tenantId: string,
    recorderDocumentType: string,
    recorderDocumentId: string,
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<bigint> {
    const count = await client.registerMovement.count({
      where: {
        tenantId,
        registerCode: FIXED_ASSET_MOVEMENT_REGISTER,
        recorderDocumentType,
        recorderDocumentId,
      },
    });
    return BigInt(count + 1);
  }
}
