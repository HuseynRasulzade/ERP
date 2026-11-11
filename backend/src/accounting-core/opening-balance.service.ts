import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { AccountingPostingEngine } from './accounting-posting-engine.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const BALANCE_SHEET_CLASSES = ['ASSET', 'CONTRA_ASSET', 'LIABILITY', 'CONTRA_LIABILITY', 'EQUITY', 'CONTRA_EQUITY'];

/**
 * Opening Balance (spec sections 51-52's sibling: entering a balance-sheet
 * account's starting balance, same as a Manual Operation but restricted to
 * balance-sheet accounts and tagged `isOpeningBalance`/`operationType:
 * 'OPENING_BALANCE'` so reports can tell the two apart). Reuses
 * AccountingPostingEngine exactly like ManualOperationService — still no
 * second ledger engine (spec section 51).
 */
@Injectable()
export class OpeningBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly charts: ChartOfAccountsService,
    private readonly engine: AccountingPostingEngine,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.journalEntry.findMany({
      where: { tenantId, organizationId, isOpeningBalance: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, tenantId, organizationId, isOpeningBalance: true },
      include: { lines: { include: { dimensions: true }, orderBy: { sequence: 'asc' } } },
    });
    if (!entry) throw new NotFoundAppError('OpeningBalance', id);
    return entry;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { businessDate: string; description?: string; lines: Array<{
      accountId: string;
      side: 'DEBIT' | 'CREDIT';
      amountBase: string;
      transactionCurrencyId?: string;
      amountTransaction?: string;
      exchangeRate?: string;
      quantity?: string;
      quantityUnitId?: string;
      description?: string;
      dimensions?: { dimensionCode: string; referenceId: string }[];
    }> },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.charts.ensureAdopted(tenantId);
    await this.assertBalanceSheetAccounts(tenantId, dto.lines.map((l) => l.accountId));

    return this.engine.createDraft(tenantId, organizationId, userId, {
      businessDate: parseDate(dto.businessDate),
      description: dto.description,
      lines: dto.lines,
      operationType: 'OPENING_BALANCE',
      generatedBy: 'OPENING_BALANCE',
      isManual: false,
      isOpeningBalance: true,
    });
  }

  async post(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.engine.postDraft(tenantId, id, userId, expectedVersion);
  }

  async unpost(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.engine.unpost(tenantId, id, userId, expectedVersion);
  }

  async reverse(tenantId: string, membershipId: string, organizationId: string, id: string, userId: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.engine.reverse(tenantId, id, userId, expectedVersion);
  }

  private async assertBalanceSheetAccounts(tenantId: string, accountIds: string[]) {
    const unique = [...new Set(accountIds)];
    const accounts = await this.prisma.account.findMany({ where: { id: { in: unique } } });
    for (const accountId of unique) {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) continue; // AccountingPostingEngine reports the real not-found error at post time
      if (!BALANCE_SHEET_CLASSES.includes(account.accountClass)) {
        throw new ValidationAppError(
          `Opening balances may only be entered for balance-sheet accounts; ${account.code} (${account.name}) is a ${account.accountClass} account`,
        );
      }
    }
  }
}

function parseDate(s: string): Date {
  const d = new Date(s + (s.length === 10 ? 'T00:00:00.000Z' : ''));
  return d;
}
