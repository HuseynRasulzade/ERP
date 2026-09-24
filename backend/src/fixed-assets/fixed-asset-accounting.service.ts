import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import {
  AccountingPostingBatch,
  AccountingPostingEngine,
  AccountingPostingLineInput,
} from '../accounting-core/accounting-posting-engine.service';
import { ChartOfAccountsService } from '../accounting-core/chart-of-accounts.service';
import { AZ_DEFAULT_MAPPINGS } from '../accounting-core/az-standard-coa.data';
import { DimensionCodes, MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountMappingNotFoundError } from '../common/errors/app-error';
import { ExpenseType } from './fixed-assets.constants';

const FA_MAPPING_KEYS = Object.values(MappingKeys).filter((k) => k.startsWith('FA_'));

/**
 * Accounting gateway for the fixed-asset module (spec sections 30, 86, 88).
 * Everything resolves through semantic mapping keys (AccountingMappingService)
 * and posts through AccountingPostingEngine — this module never holds an
 * account code. A category's `accountingMappingProfile` (e.g. "BUILDINGS")
 * lets a tenant configure `FA_COST:BUILDINGS` etc.; resolution falls back to
 * the plain key when no profile-specific mapping exists.
 */
@Injectable()
export class FixedAssetAccountingService {
  private readonly logger = new Logger('FixedAssetAccountingService');
  private readonly setupDone = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly engine: AccountingPostingEngine,
    private readonly charts: ChartOfAccountsService,
  ) {}

  /**
   * Idempotent per-tenant setup: adopted chart, the FIXED_ASSET accounting
   * dimension, and the default FA_* mapping keys for a tenant that adopted
   * its chart before this module existed (new tenants get them from
   * AZ_DEFAULT_MAPPINGS at adoption time).
   */
  async ensureSetup(tenantId: string) {
    if (this.setupDone.has(tenantId)) return;
    await this.charts.ensureAdopted(tenantId);

    const dim = await this.prisma.accountingDimensionDefinition.findFirst({ where: { tenantId: null, code: DimensionCodes.FIXED_ASSET } });
    if (!dim) {
      try {
        await this.prisma.accountingDimensionDefinition.create({
          data: { tenantId: null, code: DimensionCodes.FIXED_ASSET, name: 'FIXED ASSET', valueType: 'REFERENCE', referenceEntityType: 'FIXED_ASSET', systemDefined: true },
        });
      } catch {
        // concurrent creation — fine
      }
    }

    const existing = await this.prisma.accountingMapping.findMany({ where: { tenantId, mappingKey: { in: FA_MAPPING_KEYS } }, select: { mappingKey: true } });
    const have = new Set(existing.map((m) => m.mappingKey));
    const missing = FA_MAPPING_KEYS.filter((k) => !have.has(k));
    if (missing.length > 0) {
      const chart = await this.charts.getTenantChart(tenantId);
      for (const key of missing) {
        const code = AZ_DEFAULT_MAPPINGS[key];
        if (!code) continue;
        const account = await this.prisma.account.findFirst({ where: { tenantId, chartOfAccountsId: chart.id, code } });
        if (!account) continue;
        await this.prisma.accountingMapping.create({ data: { tenantId, mappingKey: key, accountId: account.id, validFrom: new Date(0) } });
      }
      this.logger.log(`Backfilled ${missing.length} fixed-asset mapping keys for tenant ${tenantId}`);
    }
    this.setupDone.add(tenantId);
  }

  async resolve(tenantId: string, organizationId: string, key: string, businessDate: Date, profile?: string | null, tx?: PrismaTransactionClient) {
    if (profile) {
      try {
        return await this.mappings.resolve(tenantId, organizationId, `${key}:${profile}`, businessDate, tx);
      } catch (e) {
        if (!(e instanceof AccountMappingNotFoundError)) throw e;
      }
    }
    return this.mappings.resolve(tenantId, organizationId, key, businessDate, tx);
  }

  depreciationExpenseKey(expenseType?: string | null): string {
    switch (expenseType) {
      case ExpenseType.SALES:
        return MappingKeys.FA_DEPRECIATION_EXPENSE_SALES;
      case ExpenseType.PRODUCTION:
        return MappingKeys.FA_DEPRECIATION_EXPENSE_PRODUCTION;
      case ExpenseType.OTHER:
        return MappingKeys.FA_DEPRECIATION_EXPENSE_OTHER;
      default:
        return MappingKeys.FA_DEPRECIATION_EXPENSE;
    }
  }

  /** Posts a balanced batch (zero-amount lines are dropped). Returns null
   * when nothing is left to post. */
  async post(tenantId: string, userId: string, batch: AccountingPostingBatch, tx: PrismaTransactionClient) {
    const lines = batch.lines.filter((l) => new Decimal(l.amountBase).gt(0)).map((l) => ({ ...l, amountBase: new Decimal(l.amountBase).toDecimalPlaces(4) }));
    if (lines.length === 0) return null;
    return this.engine.postBatch(tenantId, userId, { ...batch, lines }, tx);
  }

  async reverse(tenantId: string, journalEntryId: string, userId: string, businessDate: Date, tx: PrismaTransactionClient) {
    const entry = await tx.journalEntry.findFirst({ where: { id: journalEntryId, tenantId } });
    if (!entry || entry.status !== 'POSTED') return null;
    return this.engine.reverse(tenantId, entry.id, userId, entry.version, businessDate, tx);
  }

  line(accountId: string, side: 'DEBIT' | 'CREDIT', amount: Decimal.Value, description: string, dims: { assetId?: string | null; departmentId?: string | null } = {}): AccountingPostingLineInput {
    const dimensions: AccountingPostingLineInput['dimensions'] = [];
    if (dims.assetId) dimensions.push({ dimensionCode: DimensionCodes.FIXED_ASSET, referenceId: dims.assetId });
    if (dims.departmentId) dimensions.push({ dimensionCode: DimensionCodes.DEPARTMENT, referenceId: dims.departmentId });
    return { accountId, side, amountBase: new Decimal(amount), description, dimensions };
  }

  /** GL balance (debit - credit) of one account for an organization as of a date. */
  async accountBalance(tenantId: string, organizationId: string, accountId: string, asOf: Date): Promise<Decimal> {
    const rows = await this.prisma.accountingMovement.groupBy({
      by: ['side'],
      where: { tenantId, organizationId, accountId, businessDate: { lte: asOf } },
      _sum: { amountBase: true },
    });
    let bal = new Decimal(0);
    for (const r of rows) {
      const amt = new Decimal((r._sum.amountBase ?? 0).toString());
      bal = r.side === 'DEBIT' ? bal.plus(amt) : bal.minus(amt);
    }
    return bal;
  }
}
