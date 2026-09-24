import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';
import { Books, MovementType, dec, formatPeriodLabel, periodOf } from './fixed-assets.constants';
import { FixedAssetReversalBlockedError } from './fixed-asset.errors';

export interface AssetBalances {
  cost: Decimal;
  revaluation: Decimal;
  accumulatedDepreciation: Decimal;
  impairment: Decimal;
  grossCarrying: Decimal;
  netBookValue: Decimal;
  quantity: Decimal;
}

export interface MovementInput {
  tenantId: string;
  organizationId: string;
  assetId: string;
  bookCode?: string;
  movementType: string;
  businessDate: Date;
  costIncrease?: Decimal.Value;
  costDecrease?: Decimal.Value;
  depreciationIncrease?: Decimal.Value;
  depreciationDecrease?: Decimal.Value;
  impairmentIncrease?: Decimal.Value;
  impairmentDecrease?: Decimal.Value;
  revaluationIncrease?: Decimal.Value;
  revaluationDecrease?: Decimal.Value;
  quantityChange?: Decimal.Value;
  departmentId?: string | null;
  locationId?: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  journalEntryId?: string | null;
  description?: string;
  createdBy?: string | null;
}

const MEASURES = [
  ['costIncrease', 'costDecrease'],
  ['depreciationIncrease', 'depreciationDecrease'],
  ['impairmentIncrease', 'impairmentDecrease'],
  ['revaluationIncrease', 'revaluationDecrease'],
] as const;

/**
 * FixedAssetMovementRegister access (spec sections 25-27). The register is
 * append-only and is the authoritative source of every financial value of
 * an asset; the FixedAsset money columns are projections refreshed here.
 */
@Injectable()
export class FixedAssetLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async lockAsset(tx: PrismaTransactionClient, tenantId: string, assetId: string) {
    await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${assetId} AND tenant_id = ${tenantId} FOR UPDATE`;
    const asset = await tx.fixedAsset.findFirst({ where: { id: assetId, tenantId }, include: { category: true } });
    if (!asset) throw new NotFoundAppError('FixedAsset', assetId);
    return asset;
  }

  /** Balances from the register. Cost / revaluation / quantity always come
   * from the shared ACCOUNTING_BOOK cost movements; depreciation and
   * impairment from the requested book. `asOf` is inclusive. */
  async balances(tenantId: string, assetId: string, opts: { asOf?: Date; book?: string; tx?: PrismaTransactionClient } = {}): Promise<AssetBalances> {
    const client = opts.tx ?? this.prisma;
    const book = opts.book ?? Books.ACCOUNTING_BOOK;
    const dateFilter = opts.asOf ? { businessDate: { lte: opts.asOf } } : {};
    const [costAgg, bookAgg] = await Promise.all([
      client.fixedAssetMovement.aggregate({
        where: { tenantId, assetId, bookCode: Books.ACCOUNTING_BOOK, ...dateFilter },
        _sum: { costIncrease: true, costDecrease: true, revaluationIncrease: true, revaluationDecrease: true, quantityChange: true },
      }),
      client.fixedAssetMovement.aggregate({
        where: { tenantId, assetId, bookCode: book, ...dateFilter },
        _sum: { depreciationIncrease: true, depreciationDecrease: true, impairmentIncrease: true, impairmentDecrease: true },
      }),
    ]);
    const cost = dec(costAgg._sum.costIncrease).minus(dec(costAgg._sum.costDecrease));
    const revaluation = dec(costAgg._sum.revaluationIncrease).minus(dec(costAgg._sum.revaluationDecrease));
    const accumulatedDepreciation = dec(bookAgg._sum.depreciationIncrease).minus(dec(bookAgg._sum.depreciationDecrease));
    const impairment = dec(bookAgg._sum.impairmentIncrease).minus(dec(bookAgg._sum.impairmentDecrease));
    const grossCarrying = cost.plus(revaluation);
    return {
      cost,
      revaluation,
      accumulatedDepreciation,
      impairment,
      grossCarrying,
      netBookValue: grossCarrying.minus(accumulatedDepreciation).minus(impairment),
      quantity: dec(costAgg._sum.quantityChange),
    };
  }

  async write(tx: PrismaTransactionClient, input: MovementInput) {
    return tx.fixedAssetMovement.create({
      data: {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        assetId: input.assetId,
        bookCode: input.bookCode ?? Books.ACCOUNTING_BOOK,
        movementType: input.movementType,
        businessDate: input.businessDate,
        period: periodOf(input.businessDate),
        costIncrease: dec(input.costIncrease).toString(),
        costDecrease: dec(input.costDecrease).toString(),
        depreciationIncrease: dec(input.depreciationIncrease).toString(),
        depreciationDecrease: dec(input.depreciationDecrease).toString(),
        impairmentIncrease: dec(input.impairmentIncrease).toString(),
        impairmentDecrease: dec(input.impairmentDecrease).toString(),
        revaluationIncrease: dec(input.revaluationIncrease).toString(),
        revaluationDecrease: dec(input.revaluationDecrease).toString(),
        quantityChange: dec(input.quantityChange).toString(),
        departmentId: input.departmentId ?? null,
        locationId: input.locationId ?? null,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? null,
        journalEntryId: input.journalEntryId ?? null,
        description: input.description,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  /** Movements of a source document not yet neutralized by a reversal. */
  async activeMovementsOfSource(tx: PrismaTransactionClient, tenantId: string, sourceType: string, sourceId: string, assetId?: string) {
    const rows = await tx.fixedAssetMovement.findMany({
      where: { tenantId, sourceDocumentType: sourceType, sourceDocumentId: sourceId, reversalOfMovementId: null, ...(assetId ? { assetId } : {}) },
      orderBy: { sequence: 'asc' },
    });
    if (rows.length === 0) return rows;
    const reversed = await tx.fixedAssetMovement.findMany({ where: { tenantId, reversalOfMovementId: { in: rows.map((r) => r.id) } }, select: { reversalOfMovementId: true } });
    const reversedIds = new Set(reversed.map((r) => r.reversalOfMovementId));
    return rows.filter((r) => !reversedIds.has(r.id));
  }

  /**
   * Dependency-safe reversal guard (spec sections 132-135): an operation
   * may only be reversed while it is still the LATEST effective operation
   * on each asset it touched — anything recorded afterwards (depreciation,
   * transfer, disposal ...) has to be reversed first.
   */
  async assertLatestOperation(tx: PrismaTransactionClient, tenantId: string, assetId: string, sourceType: string, sourceId: string, what: string) {
    const candidates = await tx.fixedAssetMovement.findMany({
      where: { tenantId, assetId, reversalOfMovementId: null },
      orderBy: { sequence: 'desc' },
      take: 50,
    });
    const ids = candidates.map((c) => c.id);
    const reversed = ids.length
      ? await tx.fixedAssetMovement.findMany({ where: { tenantId, reversalOfMovementId: { in: ids } }, select: { reversalOfMovementId: true } })
      : [];
    const reversedIds = new Set(reversed.map((r) => r.reversalOfMovementId));
    const latest = candidates.find((c) => !reversedIds.has(c.id));
    if (!latest) return;
    if (latest.sourceDocumentType === sourceType && latest.sourceDocumentId === sourceId) return;
    const asset = await tx.fixedAsset.findUnique({ where: { id: assetId } });
    if (latest.movementType === MovementType.DEPRECIATION) {
      throw new FixedAssetReversalBlockedError(
        `${what} cannot be reversed because depreciation has already been posted for ${formatPeriodLabel(latest.period)} on asset ${asset?.assetNumber ?? assetId}. Reverse that depreciation first.`,
      );
    }
    throw new FixedAssetReversalBlockedError(
      `${what} cannot be reversed because a later ${latest.movementType} operation (${latest.sourceDocumentType}, ${latest.businessDate.toISOString().slice(0, 10)}) exists on asset ${asset?.assetNumber ?? assetId}. Reverse it first.`,
    );
  }

  /** Writes compensating movements for every active movement of a source. */
  async reverseSource(
    tx: PrismaTransactionClient,
    tenantId: string,
    sourceType: string,
    sourceId: string,
    businessDate: Date,
    userId: string,
    journalEntryId?: string | null,
    assetId?: string,
  ) {
    const active = await this.activeMovementsOfSource(tx, tenantId, sourceType, sourceId, assetId);
    const created = [];
    for (const m of active) {
      const data: Record<string, string> = {};
      for (const [inc, decKey] of MEASURES) {
        data[inc] = (m as any)[decKey].toString();
        data[decKey] = (m as any)[inc].toString();
      }
      created.push(
        await tx.fixedAssetMovement.create({
          data: {
            tenantId,
            organizationId: m.organizationId,
            assetId: m.assetId,
            bookCode: m.bookCode,
            movementType: m.movementType === MovementType.DEPRECIATION ? MovementType.DEPRECIATION_REVERSAL : m.movementType,
            businessDate,
            period: periodOf(businessDate),
            ...data,
            quantityChange: dec(m.quantityChange).negated().toString(),
            departmentId: m.departmentId,
            locationId: m.locationId,
            sourceDocumentType: m.sourceDocumentType,
            sourceDocumentId: m.sourceDocumentId,
            sourceDocumentLineId: m.sourceDocumentLineId,
            journalEntryId: journalEntryId ?? null,
            reversalOfMovementId: m.id,
            description: `Reversal of ${m.movementType}`,
            createdBy: userId,
          },
        }),
      );
    }
    return created;
  }

  /** Refreshes the FixedAsset projection columns from the register. */
  async refreshProjection(tx: PrismaTransactionClient, tenantId: string, assetId: string) {
    const b = await this.balances(tenantId, assetId, { tx });
    await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        initialCost: b.cost.toString(),
        accumulatedDepreciation: b.accumulatedDepreciation.toString(),
        impairmentBalance: b.impairment.toString(),
        revaluationBalance: b.revaluation.toString(),
        carryingAmount: b.netBookValue.toString(),
        version: { increment: 1 },
      },
    });
    return b;
  }

  async latestSequence(tx: PrismaTransactionClient, tenantId: string, assetId: string): Promise<bigint> {
    const agg = await tx.fixedAssetMovement.aggregate({ where: { tenantId, assetId }, _max: { sequence: true } });
    return agg._max.sequence ?? 0n;
  }

  /** Posted, non-reversed depreciation periods for an asset/book (ascending). */
  async depreciatedPeriods(tenantId: string, assetId: string, book: string, client?: PrismaTransactionClient): Promise<string[]> {
    const c = client ?? this.prisma;
    const lines = await c.fixedAssetDepreciationLine.findMany({ where: { tenantId, assetId, bookCode: book, status: 'POSTED' }, select: { period: true }, orderBy: { period: 'asc' } });
    return lines.map((l) => l.period);
  }
}
