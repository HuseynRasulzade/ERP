import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export interface RecordFixedAssetMovementInput {
  organizationId: string;
  assetId: string;
  valuationBook?: string;
  movementType: string;
  costIncrease?: Decimal;
  costDecrease?: Decimal;
  depreciationIncrease?: Decimal;
  depreciationDecrease?: Decimal;
  impairmentIncrease?: Decimal;
  impairmentDecrease?: Decimal;
  revaluationIncrease?: Decimal;
  revaluationDecrease?: Decimal;
  sourceDocumentType: string;
  sourceDocumentId: string;
  effectiveDate: Date;
}

const ZERO = new Decimal(0);

/**
 * FixedAssetMovementService — the central immutable subledger (spec
 * section 25). `record` both writes the movement row AND updates
 * `FixedAsset`'s own totals (initialCost/accumulatedDepreciation/
 * impairmentBalance/revaluationBalance/carryingAmount) — those fields are
 * a maintained PROJECTION, never authoritative on their own (spec section
 * 26); `recomputeFromMovements` can always rebuild them from this table
 * alone, same "rebuildable projection" convention as every other
 * subledger in this codebase. Only `ACCOUNTING_BOOK` is computed by any
 * caller in this build (see docs/FIXED_ASSETS.md) — `valuationBook` is
 * schema-ready for `TAX_BOOK`/`MANAGEMENT_BOOK` regardless.
 */
@Injectable()
export class FixedAssetMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tenantId: string, input: RecordFixedAssetMovementInput, tx: PrismaTransactionClient) {
    const valuationBook = input.valuationBook ?? 'ACCOUNTING_BOOK';
    const movement = await tx.fixedAssetMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        assetId: input.assetId,
        valuationBook,
        movementType: input.movementType,
        costIncrease: (input.costIncrease ?? ZERO).toString(),
        costDecrease: (input.costDecrease ?? ZERO).toString(),
        depreciationIncrease: (input.depreciationIncrease ?? ZERO).toString(),
        depreciationDecrease: (input.depreciationDecrease ?? ZERO).toString(),
        impairmentIncrease: (input.impairmentIncrease ?? ZERO).toString(),
        impairmentDecrease: (input.impairmentDecrease ?? ZERO).toString(),
        revaluationIncrease: (input.revaluationIncrease ?? ZERO).toString(),
        revaluationDecrease: (input.revaluationDecrease ?? ZERO).toString(),
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        effectiveDate: input.effectiveDate,
      },
    });

    if (valuationBook === 'ACCOUNTING_BOOK') {
      const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id: input.assetId } });
      const initialCost = new Decimal(asset.initialCost.toString()).plus(input.costIncrease ?? ZERO).minus(input.costDecrease ?? ZERO);
      const accumulatedDepreciation = new Decimal(asset.accumulatedDepreciation.toString()).plus(input.depreciationIncrease ?? ZERO).minus(input.depreciationDecrease ?? ZERO);
      const impairmentBalance = new Decimal(asset.impairmentBalance.toString()).plus(input.impairmentIncrease ?? ZERO).minus(input.impairmentDecrease ?? ZERO);
      const revaluationBalance = new Decimal(asset.revaluationBalance.toString()).plus(input.revaluationIncrease ?? ZERO).minus(input.revaluationDecrease ?? ZERO);
      const carryingAmount = initialCost.minus(accumulatedDepreciation).minus(impairmentBalance).plus(revaluationBalance);
      await tx.fixedAsset.update({ where: { id: input.assetId }, data: { initialCost: initialCost.toString(), accumulatedDepreciation: accumulatedDepreciation.toString(), impairmentBalance: impairmentBalance.toString(), revaluationBalance: revaluationBalance.toString(), carryingAmount: carryingAmount.toString() } });
    }

    return movement;
  }

  async reverse(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient) {
    const movements = await tx.fixedAssetMovement.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, reversed: false } });
    for (const m of movements) {
      if (m.valuationBook === 'ACCOUNTING_BOOK') {
        const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id: m.assetId } });
        const initialCost = new Decimal(asset.initialCost.toString()).minus(m.costIncrease.toString()).plus(m.costDecrease.toString());
        const accumulatedDepreciation = new Decimal(asset.accumulatedDepreciation.toString()).minus(m.depreciationIncrease.toString()).plus(m.depreciationDecrease.toString());
        const impairmentBalance = new Decimal(asset.impairmentBalance.toString()).minus(m.impairmentIncrease.toString()).plus(m.impairmentDecrease.toString());
        const revaluationBalance = new Decimal(asset.revaluationBalance.toString()).minus(m.revaluationIncrease.toString()).plus(m.revaluationDecrease.toString());
        const carryingAmount = initialCost.minus(accumulatedDepreciation).minus(impairmentBalance).plus(revaluationBalance);
        await tx.fixedAsset.update({ where: { id: m.assetId }, data: { initialCost: initialCost.toString(), accumulatedDepreciation: accumulatedDepreciation.toString(), impairmentBalance: impairmentBalance.toString(), revaluationBalance: revaluationBalance.toString(), carryingAmount: carryingAmount.toString() } });
      }
    }
    await tx.fixedAssetMovement.updateMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, reversed: false }, data: { reversed: true } });
  }

  /** Rebuilds an asset's four balances purely from its own non-reversed
   * ACCOUNTING_BOOK movement history — the reconciliation/health check's
   * own reference calculation, never used to silently overwrite drift. */
  async recomputeFromMovements(tenantId: string, assetId: string, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const movements = await db.fixedAssetMovement.findMany({ where: { tenantId, assetId, valuationBook: 'ACCOUNTING_BOOK', reversed: false } });
    let initialCost = new Decimal(0);
    let accumulatedDepreciation = new Decimal(0);
    let impairmentBalance = new Decimal(0);
    let revaluationBalance = new Decimal(0);
    for (const m of movements) {
      initialCost = initialCost.plus(m.costIncrease.toString()).minus(m.costDecrease.toString());
      accumulatedDepreciation = accumulatedDepreciation.plus(m.depreciationIncrease.toString()).minus(m.depreciationDecrease.toString());
      impairmentBalance = impairmentBalance.plus(m.impairmentIncrease.toString()).minus(m.impairmentDecrease.toString());
      revaluationBalance = revaluationBalance.plus(m.revaluationIncrease.toString()).minus(m.revaluationDecrease.toString());
    }
    const carryingAmount = initialCost.minus(accumulatedDepreciation).minus(impairmentBalance).plus(revaluationBalance);
    return { initialCost, accumulatedDepreciation, impairmentBalance, revaluationBalance, carryingAmount };
  }
}
