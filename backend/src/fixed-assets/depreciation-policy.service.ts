import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  Books,
  DEFAULT_NON_CAPITALIZABLE_COMPONENTS,
  DepreciationStartRule,
  PartialPeriodRule,
  addDays,
  dec,
  periodBounds,
  periodOf,
} from './fixed-assets.constants';

export interface EffectivePolicy {
  id: string | null;
  minCapitalizationThreshold: Decimal;
  minUsefulLifeMonths: number;
  nonCapitalizableCostComponents: string[];
  depreciationStartRule: string;
  partialPeriodRule: string;
  roundingPrecision: number;
  suspensionDepreciationPolicy: string;
  heldForSaleDepreciates: boolean;
  modernizationDepreciates: boolean;
  transferExpenseRule: string;
  impairmentReversalAllowed: boolean;
  requirePriorPeriodDepreciationForDisposal: boolean;
}

/** System fallback used ONLY when a tenant has no FixedAssetPolicy row at
 * all — every value is overridable per tenant/organization/category/book
 * through configuration (spec section 7: no hard-coded threshold). */
const SYSTEM_DEFAULT_POLICY: EffectivePolicy = {
  id: null,
  minCapitalizationThreshold: new Decimal(0),
  minUsefulLifeMonths: 12,
  nonCapitalizableCostComponents: DEFAULT_NON_CAPITALIZABLE_COMPONENTS,
  depreciationStartRule: DepreciationStartRule.FIRST_DAY_NEXT_MONTH,
  partialPeriodRule: PartialPeriodRule.FULL_MONTH,
  roundingPrecision: 2,
  suspensionDepreciationPolicy: 'PAUSE_DEPRECIATION',
  heldForSaleDepreciates: false,
  modernizationDepreciates: true,
  transferExpenseRule: 'PERIOD_END_ASSIGNMENT',
  impairmentReversalAllowed: true,
  requirePriorPeriodDepreciationForDisposal: true,
};

/**
 * DepreciationPolicyService (spec sections 7, 20, 23-24, 35-37, 99, 137):
 * policy resolution + the effective-dated per-asset book parameters.
 */
@Injectable()
export class DepreciationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Most specific active policy row: organization+category > organization >
   * category > tenant-wide; latest validFrom wins within the same rank. */
  async resolvePolicy(
    tenantId: string,
    organizationId: string,
    categoryId: string | null,
    date: Date,
    book: string = Books.ACCOUNTING_BOOK,
    tx?: PrismaTransactionClient,
  ): Promise<EffectivePolicy> {
    const client = tx ?? this.prisma;
    const rows = await client.fixedAssetPolicy.findMany({
      where: {
        tenantId,
        active: true,
        bookCode: book,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
        AND: [{ OR: [{ organizationId }, { organizationId: null }] }, { OR: [{ categoryId: categoryId ?? '__none__' }, { categoryId: null }] }],
      },
    });
    if (rows.length === 0) return SYSTEM_DEFAULT_POLICY;
    const score = (r: (typeof rows)[number]) => (r.organizationId ? 2 : 0) + (r.categoryId ? 1 : 0);
    rows.sort((a, b) => score(b) - score(a) || b.validFrom.getTime() - a.validFrom.getTime());
    const p = rows[0];
    return {
      id: p.id,
      minCapitalizationThreshold: dec(p.minCapitalizationThreshold),
      minUsefulLifeMonths: p.minUsefulLifeMonths,
      nonCapitalizableCostComponents: p.nonCapitalizableCostComponents,
      depreciationStartRule: p.depreciationStartRule,
      partialPeriodRule: p.partialPeriodRule,
      roundingPrecision: p.roundingPrecision,
      suspensionDepreciationPolicy: p.suspensionDepreciationPolicy,
      heldForSaleDepreciates: p.heldForSaleDepreciates,
      modernizationDepreciates: p.modernizationDepreciates,
      transferExpenseRule: p.transferExpenseRule,
      impairmentReversalAllowed: p.impairmentReversalAllowed,
      requirePriorPeriodDepreciationForDisposal: p.requirePriorPeriodDepreciationForDisposal,
    };
  }

  /** Depreciation start date from the commissioning date (spec section 20). */
  depreciationStartDate(commissioningDate: Date, rule: string): Date {
    switch (rule) {
      case DepreciationStartRule.FROM_COMMISSIONING_DATE:
        return commissioningDate;
      case DepreciationStartRule.NEXT_DAY:
        return addDays(commissioningDate, 1);
      case DepreciationStartRule.NEXT_MONTH: {
        const y = commissioningDate.getUTCFullYear();
        const m = commissioningDate.getUTCMonth() + 1;
        const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        return new Date(Date.UTC(y, m, Math.min(commissioningDate.getUTCDate(), lastDay)));
      }
      case DepreciationStartRule.LOCALIZATION_DEFINED: // AZ localization: first day of the following month
      case DepreciationStartRule.FIRST_DAY_NEXT_MONTH:
      default:
        return new Date(Date.UTC(commissioningDate.getUTCFullYear(), commissioningDate.getUTCMonth() + 1, 1));
    }
  }

  /** Partial-period factor for the period in which depreciation starts
   * (spec sections 99-100). Uses actual calendar days — no hard-coded 365. */
  prorationFactor(period: string, depreciationStart: Date, rule: string): Decimal {
    const { start, end, days } = periodBounds(period);
    if (depreciationStart.getTime() <= start.getTime()) return new Decimal(1);
    if (depreciationStart.getTime() > end.getTime()) return new Decimal(0);
    switch (rule) {
      case PartialPeriodRule.DAILY_PRORATA: {
        const usable = Math.round((end.getTime() - depreciationStart.getTime()) / 86_400_000) + 1;
        return new Decimal(usable).div(days);
      }
      case PartialPeriodRule.HALF_MONTH:
        return depreciationStart.getUTCDate() <= 15 ? new Decimal(1) : new Decimal(0.5);
      case PartialPeriodRule.LOCALIZATION_RULE:
      case PartialPeriodRule.FULL_MONTH:
      default:
        return new Decimal(1);
    }
  }

  /** Book policy version in force for a period (latest non-reversed row
   * whose effective period is <= the period). */
  async effectiveBookPolicy(tenantId: string, assetId: string, book: string, period: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.fixedAssetBookPolicy.findFirst({
      where: { tenantId, assetId, bookCode: book, reversed: false, effectivePeriod: { lte: period } },
      orderBy: [{ effectivePeriod: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async latestBookPolicy(tenantId: string, assetId: string, book: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.fixedAssetBookPolicy.findFirst({
      where: { tenantId, assetId, bookCode: book, reversed: false },
      orderBy: [{ effectivePeriod: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Remaining life at the START of `period` under a given policy version:
   * the remaining life recorded at its effective period minus every period
   * already depreciated (posted) since then. */
  async remainingLifeAt(tenantId: string, assetId: string, book: string, policy: { effectivePeriod: string; remainingLifeMonths: number | null }, period: string, tx?: PrismaTransactionClient) {
    if (policy.remainingLifeMonths === null || policy.remainingLifeMonths === undefined) return null;
    const client = tx ?? this.prisma;
    const used = await client.fixedAssetDepreciationLine.count({
      where: { tenantId, assetId, bookCode: book, status: 'POSTED', period: { gte: policy.effectivePeriod, lt: period } },
    });
    return policy.remainingLifeMonths - used;
  }

  async createBookPolicy(
    tx: PrismaTransactionClient,
    input: {
      tenantId: string;
      assetId: string;
      bookCode?: string;
      effectiveDate: Date;
      effectivePeriod?: string;
      usefulLifeMonths: number | null;
      remainingLifeMonths: number | null;
      residualValue: Decimal.Value;
      depreciationMethod: string;
      depreciationRate?: Decimal.Value | null;
      depreciationStartRule: string;
      partialPeriodRule: string;
      changeReason?: string;
      sourceDocumentType?: string;
      sourceDocumentId?: string;
      createdBy?: string;
    },
  ) {
    return tx.fixedAssetBookPolicy.create({
      data: {
        tenantId: input.tenantId,
        assetId: input.assetId,
        bookCode: input.bookCode ?? Books.ACCOUNTING_BOOK,
        effectiveDate: input.effectiveDate,
        effectivePeriod: input.effectivePeriod ?? periodOf(input.effectiveDate),
        usefulLifeMonths: input.usefulLifeMonths,
        remainingLifeMonths: input.remainingLifeMonths,
        residualValue: dec(input.residualValue).toString(),
        depreciationMethod: input.depreciationMethod,
        depreciationRate: input.depreciationRate !== undefined && input.depreciationRate !== null ? dec(input.depreciationRate).toString() : null,
        depreciationStartRule: input.depreciationStartRule,
        partialPeriodRule: input.partialPeriodRule,
        changeReason: input.changeReason,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        createdBy: input.createdBy,
      },
    });
  }

  /** Re-projects the asset's current parameter columns from its latest
   * active ACCOUNTING_BOOK policy (after a change or a reversal). */
  async reprojectParameters(tx: PrismaTransactionClient, tenantId: string, assetId: string) {
    const p = await this.latestBookPolicy(tenantId, assetId, Books.ACCOUNTING_BOOK, tx);
    const remaining = p ? await this.remainingLifeAt(tenantId, assetId, Books.ACCOUNTING_BOOK, p, '9999-12', tx) : null;
    await tx.fixedAsset.update({
      where: { id: assetId },
      data: {
        usefulLifeMonths: p?.usefulLifeMonths ?? null,
        remainingUsefulLifeMonths: remaining,
        depreciationMethod: p?.depreciationMethod ?? null,
        residualValue: p ? p.residualValue : 0,
        depreciationRate: p?.depreciationRate ?? null,
      },
    });
  }
}
