import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { TaxRuleAmbiguousError, TaxRuleNotFoundError } from '../common/errors/app-error';
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
      include: { rate: true },
    });

    const matching = candidates.filter(
      (rule) =>
        (!rule.conditionOperationType || rule.conditionOperationType === context.operationType) &&
        (!rule.conditionTaxCategoryCode || rule.conditionTaxCategoryCode === context.taxCategoryCode) &&
        (!rule.conditionTaxpayerSide || rule.conditionTaxpayerSide === context.taxpayerSide),
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

    return winners[0];
  }
}
