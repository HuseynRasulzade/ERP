import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export interface EffectiveSettlementPolicy {
  settlementDimensionType: string;
  autoAllocationStrategy: string;
  allowCrossContractOffset: boolean;
  allowCrossCurrencySettlement: boolean;
  overdueCreditBlockPolicy: string;
  smallBalanceWriteOffTolerance: string | null;
}

const DEFAULT_POLICY: EffectiveSettlementPolicy = {
  settlementDimensionType: 'BY_DOCUMENT',
  autoAllocationStrategy: 'FIFO_BY_DUE_DATE',
  allowCrossContractOffset: false,
  allowCrossCurrencySettlement: false,
  overdueCreditBlockPolicy: 'WARNING',
  smallBalanceWriteOffTolerance: null,
};

/**
 * SettlementPolicyService (spec section 8). Resolves the most specific
 * effective row: counterparty-specific over organization-wide default,
 * both effective-dated. Only `BY_DOCUMENT` has real behavior elsewhere in
 * this build (see schema file header) — other modes are stored and
 * returned here honestly, but `OpenItemService` treats them the same as
 * `BY_DOCUMENT` today.
 */
@Injectable()
export class SettlementPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, organizationId: string, counterpartyId: string, date: Date, client?: PrismaTransactionClient): Promise<EffectiveSettlementPolicy> {
    const db = client ?? this.prisma;
    const specific = await db.settlementPolicy.findFirst({
      where: { tenantId, organizationId, counterpartyId, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (specific) return this.toEffective(specific);

    const general = await db.settlementPolicy.findFirst({
      where: { tenantId, organizationId, counterpartyId: null, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (general) return this.toEffective(general);

    return DEFAULT_POLICY;
  }

  private toEffective(row: { settlementDimensionType: string; autoAllocationStrategy: string; allowCrossContractOffset: boolean; allowCrossCurrencySettlement: boolean; overdueCreditBlockPolicy: string; smallBalanceWriteOffTolerance: unknown }): EffectiveSettlementPolicy {
    return {
      settlementDimensionType: row.settlementDimensionType,
      autoAllocationStrategy: row.autoAllocationStrategy,
      allowCrossContractOffset: row.allowCrossContractOffset,
      allowCrossCurrencySettlement: row.allowCrossCurrencySettlement,
      overdueCreditBlockPolicy: row.overdueCreditBlockPolicy,
      smallBalanceWriteOffTolerance: row.smallBalanceWriteOffTolerance?.toString() ?? null,
    };
  }

  async list(tenantId: string, organizationId: string) {
    return this.prisma.settlementPolicy.findMany({ where: { tenantId, organizationId }, orderBy: { effectiveFrom: 'desc' } });
  }

  async create(tenantId: string, organizationId: string, userId: string, input: { counterpartyId?: string; effectiveFrom: string; settlementDimensionType?: string; autoAllocationStrategy?: string; allowCrossContractOffset?: boolean; allowCrossCurrencySettlement?: boolean; overdueCreditBlockPolicy?: string; smallBalanceWriteOffTolerance?: number }) {
    return this.prisma.runInTransaction(async (tx) => {
      const previous = await tx.settlementPolicy.findFirst({ where: { tenantId, organizationId, counterpartyId: input.counterpartyId ?? null, status: 'ACTIVE', effectiveTo: null } });
      if (previous) await tx.settlementPolicy.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED', effectiveTo: new Date(input.effectiveFrom) } });
      return tx.settlementPolicy.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: input.counterpartyId,
          effectiveFrom: new Date(input.effectiveFrom),
          settlementDimensionType: input.settlementDimensionType ?? 'BY_DOCUMENT',
          autoAllocationStrategy: input.autoAllocationStrategy ?? 'FIFO_BY_DUE_DATE',
          allowCrossContractOffset: input.allowCrossContractOffset ?? false,
          allowCrossCurrencySettlement: input.allowCrossCurrencySettlement ?? false,
          overdueCreditBlockPolicy: input.overdueCreditBlockPolicy ?? 'WARNING',
          smallBalanceWriteOffTolerance: input.smallBalanceWriteOffTolerance?.toString(),
          status: 'ACTIVE',
          createdBy: userId,
        },
      });
    });
  }
}
