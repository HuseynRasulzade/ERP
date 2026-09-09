import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountMappingAmbiguousError, AccountMappingNotFoundError, NotFoundAppError } from '../common/errors/app-error';

/**
 * Semantic Account Mapping resolver (spec sections 39-43). Business modules
 * never hold a literal account code — they ask `resolve(tenantId,
 * organizationId, 'SALES_REVENUE', businessDate)` and get back the Account
 * that applies for that organization/date.
 *
 * Precedence (spec section 43): organization-specific row beats a
 * tenant-wide (organizationId=null) default; within the same specificity,
 * higher `priority` wins; an exact tie is a configuration error rather
 * than a silently-picked row.
 */
@Injectable()
export class AccountingMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolve(
    tenantId: string,
    organizationId: string,
    mappingKey: string,
    businessDate: Date,
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const candidates = await client.accountingMapping.findMany({
      where: {
        tenantId,
        mappingKey,
        active: true,
        validFrom: { lte: businessDate },
        OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
        AND: [{ OR: [{ organizationId }, { organizationId: null }] }],
      },
    });
    if (candidates.length === 0) throw new AccountMappingNotFoundError(mappingKey);

    const orgSpecific = candidates.filter((c) => c.organizationId === organizationId);
    const pool = orgSpecific.length > 0 ? orgSpecific : candidates;

    const maxPriority = Math.max(...pool.map((c) => c.priority));
    const winners = pool.filter((c) => c.priority === maxPriority);
    if (winners.length > 1) throw new AccountMappingAmbiguousError(mappingKey);

    const account = await client.account.findUnique({ where: { id: winners[0].accountId } });
    if (!account) throw new NotFoundAppError('Account', winners[0].accountId);
    return account;
  }

  list(tenantId: string, organizationId?: string) {
    return this.prisma.accountingMapping.findMany({
      where: { tenantId, ...(organizationId ? { organizationId } : {}) },
      include: { account: true },
      orderBy: [{ mappingKey: 'asc' }, { priority: 'desc' }],
    });
  }

  async upsert(
    tenantId: string,
    userId: string,
    input: { mappingKey: string; accountId: string; organizationId?: string; priority?: number; validFrom?: Date },
  ) {
    const account = await this.prisma.account.findFirst({ where: { id: input.accountId, tenantId } });
    if (!account) throw new NotFoundAppError('Account', input.accountId);

    const mapping = await this.prisma.accountingMapping.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        mappingKey: input.mappingKey,
        accountId: input.accountId,
        priority: input.priority ?? 0,
        validFrom: input.validFrom ?? new Date(),
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'ACCOUNT_MAPPING_CHANGED',
      entityType: 'AccountingMapping',
      entityId: mapping.id,
      action: 'CREATE',
      userId,
      newValues: { mappingKey: input.mappingKey, accountId: input.accountId, organizationId: input.organizationId },
    });

    return mapping;
  }
}
