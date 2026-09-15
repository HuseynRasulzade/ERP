import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface ResolvedMapping {
  mappingId: string;
  reportRowId: string;
  strategy: string;
  accountIds: string[];
  balanceSide: string | null;
  movementType: string;
  signMultiplier: number;
}

/**
 * FinancialReportMappingService (docx spec Phase 23, sections 13-20).
 * The account-to-report-row mapping engine. Mappings are versioned by
 * their own `effectiveFrom`/`effectiveTo` + `frameworkVersionId`/
 * `statementVersionId` rather than a separate `FinancialReportMappingVersion`
 * table (disclosed simplification, docs/FINANCIAL_REPORTING.md section A)
 * — a historical report always resolves mappings AS OF its own reporting
 * date against the frameworkVersion/statementVersion it was generated
 * under, which are themselves immutable once ACTIVE, so section 14's own
 * "2026 must still use 2026 mapping" requirement holds without a second
 * version table.
 */
@Injectable()
export class FinancialReportMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: {
      frameworkVersionId: string;
      statementVersionId: string;
      reportRowId: string;
      strategy: string;
      accountId?: string;
      accountCodeFrom?: string;
      accountCodeTo?: string;
      accountTag?: string;
      dimensionFilter?: Record<string, unknown>;
      organizationId?: string;
      balanceSide?: string;
      movementType?: string;
      signMultiplier?: number;
      effectiveFrom: string;
      effectiveTo?: string;
      mappingPriority?: number;
    },
  ) {
    const mapping = await this.prisma.financialReportMapping.create({
      data: {
        tenantId,
        frameworkVersionId: dto.frameworkVersionId,
        statementVersionId: dto.statementVersionId,
        reportRowId: dto.reportRowId,
        strategy: dto.strategy,
        accountId: dto.accountId,
        accountCodeFrom: dto.accountCodeFrom,
        accountCodeTo: dto.accountCodeTo,
        accountTag: dto.accountTag,
        dimensionFilter: dto.dimensionFilter as object | undefined,
        organizationId: dto.organizationId,
        balanceSide: dto.balanceSide,
        movementType: dto.movementType ?? 'BALANCE',
        signMultiplier: dto.signMultiplier ?? 1,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        mappingPriority: dto.mappingPriority ?? 100,
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'FINANCIAL_REPORT_MAPPING_CREATED', entityType: 'FinancialReportMapping', entityId: mapping.id, action: 'CREATE', userId, newValues: { strategy: dto.strategy, reportRowId: dto.reportRowId } });
    return mapping;
  }

  async approve(tenantId: string, userId: string, id: string) {
    const mapping = await this.get(tenantId, id);
    const updated = await this.prisma.financialReportMapping.update({ where: { id: mapping.id }, data: { approvedBy: userId, approvedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'FINANCIAL_REPORT_MAPPING_APPROVED', entityType: 'FinancialReportMapping', entityId: mapping.id, action: 'UPDATE', userId });
    return updated;
  }

  list(tenantId: string, statementVersionId: string) {
    return this.prisma.financialReportMapping.findMany({ where: { tenantId, statementVersionId }, orderBy: { mappingPriority: 'asc' } });
  }

  /** Resolves every ACTIVE mapping applicable as of `asOfDate`, expanding
   * each mapping's strategy into a concrete set of account ids (spec
   * section 15). `ACCOUNT_TREE` walks `Account.parentAccountId`
   * descendants; `ACCOUNT_TAG` matches `Account.reportingTags`;
   * `ACCOUNT_RANGE` matches `code` lexicographically between the two
   * bounds; `DIMENSION_FILTER`/`FORMULA` mappings are returned with an
   * empty `accountIds` set — the caller (`RowAmountResolverService`)
   * handles `DIMENSION_FILTER` itself via the movement's own dimensions,
   * and `FORMULA` rows never resolve accounts at all. `EXCLUSION`
   * mappings return their own account set for the caller to SUBTRACT. */
  async resolveActiveMappings(tenantId: string, statementVersionId: string, asOfDate: Date): Promise<ResolvedMapping[]> {
    const mappings = await this.prisma.financialReportMapping.findMany({
      where: {
        tenantId,
        statementVersionId,
        status: 'ACTIVE',
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { mappingPriority: 'asc' },
    });

    const resolved: ResolvedMapping[] = [];
    for (const m of mappings) {
      let accountIds: string[] = [];
      switch (m.strategy) {
        case 'EXACT_ACCOUNT':
          accountIds = m.accountId ? [m.accountId] : [];
          break;
        case 'ACCOUNT_TREE':
          accountIds = m.accountId ? await this.descendantIds(tenantId, m.accountId) : [];
          break;
        case 'ACCOUNT_RANGE': {
          const accounts = await this.prisma.account.findMany({ where: { tenantId, code: { gte: m.accountCodeFrom ?? '', lte: m.accountCodeTo ?? '￿' } }, select: { id: true } });
          accountIds = accounts.map((a) => a.id);
          break;
        }
        case 'ACCOUNT_TAG': {
          const accounts = await this.prisma.account.findMany({ where: { tenantId, reportingTags: { has: m.accountTag ?? '' } }, select: { id: true } });
          accountIds = accounts.map((a) => a.id);
          break;
        }
        case 'DIMENSION_FILTER':
        case 'FORMULA':
        case 'EXCLUSION':
          accountIds = m.accountId ? [m.accountId] : [];
          break;
        default:
          break;
      }
      resolved.push({ mappingId: m.id, reportRowId: m.reportRowId, strategy: m.strategy, accountIds, balanceSide: m.balanceSide, movementType: m.movementType, signMultiplier: m.signMultiplier });
    }
    return resolved;
  }

  /** Coverage report (spec section 20) — GL balance scope vs. mapped vs.
   * unmapped vs. duplicate-mapped. Duplicate = the same account matched
   * by ACTIVE mappings pointing at more than one DISTINCT report row for
   * this statement version (spec sections 18, 172). */
  async coverage(tenantId: string, organizationId: string, statementVersionId: string, asOfDate: Date) {
    const resolved = await this.resolveActiveMappings(tenantId, statementVersionId, asOfDate);
    const accountToRows = new Map<string, Set<string>>();
    for (const m of resolved) {
      if (m.strategy === 'EXCLUSION' || m.strategy === 'FORMULA') continue;
      for (const accountId of m.accountIds) {
        if (!accountToRows.has(accountId)) accountToRows.set(accountId, new Set());
        accountToRows.get(accountId)!.add(m.reportRowId);
      }
    }
    const duplicates = Array.from(accountToRows.entries()).filter(([, rows]) => rows.size > 1).map(([accountId, rows]) => ({ accountId, rowIds: Array.from(rows) }));

    const balances = await this.prisma.accountingMovement.groupBy({ by: ['accountId', 'side'], where: { tenantId, organizationId, businessDate: { lte: asOfDate } }, _sum: { amountBase: true } });
    const nonZeroAccountIds = new Set<string>();
    const netByAccount = new Map<string, number>();
    for (const row of balances) {
      const amount = Number(row._sum.amountBase ?? 0) * (row.side === 'DEBIT' ? 1 : -1);
      netByAccount.set(row.accountId, (netByAccount.get(row.accountId) ?? 0) + amount);
    }
    for (const [accountId, net] of netByAccount) if (Math.abs(net) > 0.01) nonZeroAccountIds.add(accountId);

    const mappedAccountIds = new Set(accountToRows.keys());
    const unmapped = Array.from(nonZeroAccountIds).filter((id) => !mappedAccountIds.has(id));

    return {
      accountsWithBalance: nonZeroAccountIds.size,
      mappedAccounts: mappedAccountIds.size,
      unmappedAccounts: unmapped,
      duplicateMappedAccounts: duplicates,
      coveragePercent: nonZeroAccountIds.size === 0 ? 100 : Math.round(((nonZeroAccountIds.size - unmapped.length) / nonZeroAccountIds.size) * 100),
    };
  }

  private async descendantIds(tenantId: string, accountId: string): Promise<string[]> {
    const ids = [accountId];
    let frontier = [accountId];
    for (let i = 0; i < 6 && frontier.length > 0; i++) {
      const children = await this.prisma.account.findMany({ where: { tenantId, parentAccountId: { in: frontier } }, select: { id: true } });
      if (children.length === 0) break;
      frontier = children.map((c) => c.id);
      ids.push(...frontier);
    }
    return ids;
  }

  private async get(tenantId: string, id: string) {
    const mapping = await this.prisma.financialReportMapping.findFirst({ where: { id, tenantId } });
    if (!mapping) throw new NotFoundAppError('FinancialReportMapping', id);
    return mapping;
  }
}
