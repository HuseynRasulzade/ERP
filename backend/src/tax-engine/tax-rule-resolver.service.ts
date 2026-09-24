import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { TaxRateNotFoundError, TaxRuleAmbiguousError, TaxRuleNotFoundError } from '../common/errors/app-error';
import { TaxContext } from './tax-context';

/**
 * TaxRuleResolver (spec sections 32-33, 92). Deterministic: identical
 * TaxContext + identical rule configuration always returns the identical
 * rule — never depends on row order, `created_at`, or the current wall
 * clock (only on `taxPointDate` from the context, spec section 73).
 */
@Injectable()
export class TaxRuleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(context: TaxContext, taxTypeCode = 'VAT', tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const jurisdiction = context.jurisdiction ?? 'AZ';

    const taxType = await client.taxType.findUnique({ where: { code: taxTypeCode } });
    if (!taxType) throw new TaxRuleNotFoundError(`unknown tax type ${taxTypeCode}`);

    const candidates = await client.taxRule.findMany({
      where: {
        taxTypeId: taxType.id,
        status: 'ACTIVE',
        active: true,
        effectiveFrom: { lte: context.taxPointDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: context.taxPointDate } }],
        AND: [{ OR: [{ tenantId: context.tenantId }, { tenantId: null }] }],
      },
      include: { rate: true, legalSource: true },
    });

    const date = context.taxPointDate;
    const matching = candidates.filter(
      (rule) =>
        (!rule.conditionOperationType || rule.conditionOperationType === context.operationType) &&
        (!rule.conditionTaxCategoryCode || rule.conditionTaxCategoryCode === context.taxCategoryCode) &&
        (!rule.conditionTaxpayerSide || rule.conditionTaxpayerSide === context.taxpayerSide) &&
        legalSourceInForce(rule.legalSource, date),
    );

    if (matching.length === 0) {
      throw new TaxRuleNotFoundError(
        `${taxTypeCode}/${jurisdiction} category=${context.taxCategoryCode} operation=${context.operationType} date=${context.taxPointDate.toISOString().slice(0, 10)}`,
      );
    }

    // Tenant-specific rule beats a system default at the same priority tier.
    const tenantSpecific = matching.filter((r) => r.tenantId === context.tenantId);
    const pool = tenantSpecific.length > 0 ? tenantSpecific : matching;

    const maxPriority = Math.max(...pool.map((r) => r.priority));
    const winners = pool.filter((r) => r.priority === maxPriority);
    if (winners.length > 1) {
      throw new TaxRuleAmbiguousError(winners.map((w) => w.code).join(', '));
    }

    const winner = winners[0];

    // The rate a rule points at is itself effective-dated legal
    // configuration (spec sections 14, 72): it must be in force on the tax
    // point date, and a rate-bearing treatment without a usable rate is a
    // configuration error — never silently computed as 0% (spec 133).
    if (winner.rate) {
      const r = winner.rate;
      const inWindow = r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date);
      if (!inWindow || r.status === 'REPEALED') {
        throw new TaxRateNotFoundError(
          `rule ${winner.code} points at rate ${r.code}, which is not in force on ${date.toISOString().slice(0, 10)}`,
        );
      }
    } else if (RATE_BEARING_TREATMENTS.has(winner.treatment)) {
      throw new TaxRateNotFoundError(`rule ${winner.code} (${winner.treatment}) has no tax rate configured`);
    }

    return winner;
  }
}

/** Treatments whose tax amount is `base x rate` — a missing rate there can
 * only be a configuration gap. ZERO_RATED/EXEMPT/OUT_OF_SCOPE legitimately
 * carry no rate (or a 0% one). */
const RATE_BEARING_TREATMENTS = new Set<string>(['STANDARD_RATE', 'SPECIAL_RATE', 'REVERSE_CHARGE']);

/**
 * Struck-through / repealed law guard (spec sections 1, 11, 114): a rule
 * can never apply outside the validity window of the legal source it cites.
 * A REPEALED/SUPERSEDED source with an end date still governs dates up to
 * that end date (historical transactions stay reproducible); a
 * REPEALED/SUPERSEDED/DRAFT source with no end date cannot back any
 * calculation at all. Rules without a linked source are unaffected.
 */
function legalSourceInForce(
  source: { status: string; effectiveFrom: Date | null; effectiveTo: Date | null } | null,
  date: Date,
): boolean {
  if (!source) return true;
  if (source.effectiveFrom && source.effectiveFrom > date) return false;
  if (source.effectiveTo && source.effectiveTo < date) return false;
  if (source.status === 'DRAFT') return false;
  if ((source.status === 'REPEALED' || source.status === 'SUPERSEDED') && !source.effectiveTo) return false;
  return true;
}
