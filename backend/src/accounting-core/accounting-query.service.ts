import { Injectable } from '@nestjs/common';
import { AccountClass } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  openingDebit: string;
  openingCredit: string;
  turnoverDebit: string;
  turnoverCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface FinancialStatementRow {
  accountId: string;
  code: string;
  name: string;
  sectionCode: string | null;
  sectionName: string | null;
  groupCode: string | null;
  groupName: string | null;
  amount: string; // signed per the account's own normalBalance — never re-signed by the caller
}

const REVENUE_CLASSES: AccountClass[] = ['REVENUE', 'CONTRA_REVENUE'];
const EXPENSE_CLASSES: AccountClass[] = ['EXPENSE', 'TAX_EXPENSE'];
const ASSET_CLASSES: AccountClass[] = ['ASSET', 'CONTRA_ASSET'];
const LIABILITY_CLASSES: AccountClass[] = ['LIABILITY', 'CONTRA_LIABILITY'];
const EQUITY_CLASSES: AccountClass[] = ['EQUITY', 'CONTRA_EQUITY'];

/**
 * Accounting balance query engine (spec sections 67-72) — Trial Balance,
 * General Ledger and Account Card, all reading exclusively from the
 * immutable AccountingMovement register (never a cached balance column).
 * Polished reporting UI is explicitly Phase 23's job (spec section 71/72);
 * this is the correct-data/query-API layer Phase 23 will sit on top of.
 */
@Injectable()
export class AccountingQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async trialBalance(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    params: { fromDate: Date; toDate: Date; accountId?: string },
  ): Promise<TrialBalanceRow[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const accountIds = params.accountId
      ? await this.descendantIdsIncludingSelf(tenantId, params.accountId)
      : (await this.prisma.account.findMany({ where: { tenantId }, select: { id: true } })).map((a) => a.id);

    const accounts = await this.prisma.account.findMany({ where: { id: { in: accountIds } }, orderBy: { code: 'asc' } });

    const opening = await this.prisma.accountingMovement.groupBy({
      by: ['accountId', 'side'],
      where: { tenantId, organizationId, accountId: { in: accountIds }, businessDate: { lt: params.fromDate } },
      _sum: { amountBase: true },
    });
    const turnover = await this.prisma.accountingMovement.groupBy({
      by: ['accountId', 'side'],
      where: {
        tenantId,
        organizationId,
        accountId: { in: accountIds },
        businessDate: { gte: params.fromDate, lte: params.toDate },
      },
      _sum: { amountBase: true },
    });

    const openingMap = groupToMap(opening);
    const turnoverMap = groupToMap(turnover);

    return accounts.map((account) => {
      const o = openingMap.get(account.id) ?? { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
      const t = turnoverMap.get(account.id) ?? { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
      const net = o.DEBIT.minus(o.CREDIT).plus(t.DEBIT).minus(t.CREDIT);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        openingDebit: o.DEBIT.toFixed(2),
        openingCredit: o.CREDIT.toFixed(2),
        turnoverDebit: t.DEBIT.toFixed(2),
        turnoverCredit: t.CREDIT.toFixed(2),
        closingDebit: net.gte(0) ? net.toFixed(2) : '0.00',
        closingCredit: net.lt(0) ? net.neg().toFixed(2) : '0.00',
      };
    });
  }

  async generalLedger(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    params: { fromDate: Date; toDate: Date; accountId?: string; limit?: number; offset?: number },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const movements = await this.prisma.accountingMovement.findMany({
      where: {
        tenantId,
        organizationId,
        businessDate: { gte: params.fromDate, lte: params.toDate },
        ...(params.accountId ? { accountId: params.accountId } : {}),
      },
      include: {
        account: true,
        journalEntry: { select: { journalNumber: true, description: true, sourceDocumentType: true, sourceDocumentId: true } },
        dimensions: true,
      },
      orderBy: [{ businessDate: 'asc' }, { postingSequence: 'asc' }],
      take: params.limit ?? 200,
      skip: params.offset ?? 0,
    });
    return movements;
  }

  async accountCard(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    accountId: string,
    params: { fromDate: Date; toDate: Date },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const account = await this.prisma.account.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new NotFoundAppError('Account', accountId);

    const openingAgg = await this.prisma.accountingMovement.groupBy({
      by: ['side'],
      where: { tenantId, organizationId, accountId, businessDate: { lt: params.fromDate } },
      _sum: { amountBase: true },
    });
    const openingDebit = new Decimal(openingAgg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0);
    const openingCredit = new Decimal(openingAgg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0);
    const openingBalance = openingDebit.minus(openingCredit);
    let running = openingBalance;

    const movements = await this.prisma.accountingMovement.findMany({
      where: { tenantId, organizationId, accountId, businessDate: { gte: params.fromDate, lte: params.toDate } },
      include: {
        journalEntry: { select: { journalNumber: true, description: true, sourceDocumentType: true, sourceDocumentId: true } },
        dimensions: true,
      },
      orderBy: [{ businessDate: 'asc' }, { postingSequence: 'asc' }],
    });

    const rows = movements.map((m) => {
      running = m.side === 'DEBIT' ? running.plus(m.amountBase) : running.minus(m.amountBase);
      return { ...m, runningBalance: running.toFixed(2) };
    });

    return {
      account,
      openingBalance: openingBalance.toFixed(2),
      movements: rows,
      closingBalance: running.toFixed(2),
    };
  }

  /**
   * Income Statement (Mənfəət və Zərər haqqında hesabat) — period-only
   * turnover (no opening balance: revenue/expense accounts don't carry
   * one across periods) over REVENUE/CONTRA_REVENUE/EXPENSE/TAX_EXPENSE
   * accounts, signed per each account's own `normalBalance` (never a
   * hardcoded debit/credit assumption — a CONTRA_REVENUE account like
   * Sales Returns has NormalBalance DEBIT and nets against revenue
   * automatically this way). Reuses the exact groupBy(['accountId','side'])
   * pattern `trialBalance` already established over AccountingMovement.
   */
  async incomeStatement(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    params: { fromDate: Date; toDate: Date },
  ): Promise<{ rows: FinancialStatementRow[]; totalRevenue: string; totalExpense: string; netIncome: string }> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, accountClass: { in: [...REVENUE_CLASSES, ...EXPENSE_CLASSES] } },
      include: { section: true, group: true },
      orderBy: { code: 'asc' },
    });
    const accountIds = accounts.map((a) => a.id);

    const turnover = await this.prisma.accountingMovement.groupBy({
      by: ['accountId', 'side'],
      where: { tenantId, organizationId, accountId: { in: accountIds }, businessDate: { gte: params.fromDate, lte: params.toDate } },
      _sum: { amountBase: true },
    });
    const turnoverMap = groupToMap(turnover);

    let totalRevenue = new Decimal(0);
    let totalExpense = new Decimal(0);
    const rows: FinancialStatementRow[] = accounts.map((account) => {
      const t = turnoverMap.get(account.id) ?? { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
      const amount = account.normalBalance === 'CREDIT' ? t.CREDIT.minus(t.DEBIT) : t.DEBIT.minus(t.CREDIT);
      if (REVENUE_CLASSES.includes(account.accountClass)) totalRevenue = totalRevenue.plus(amount);
      else totalExpense = totalExpense.plus(amount);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        sectionCode: account.section?.code ?? null,
        sectionName: account.section?.name ?? null,
        groupCode: account.group?.code ?? null,
        groupName: account.group?.name ?? null,
        amount: amount.toFixed(2),
      };
    });

    return { rows, totalRevenue: totalRevenue.toFixed(2), totalExpense: totalExpense.toFixed(2), netIncome: totalRevenue.minus(totalExpense).toFixed(2) };
  }

  /**
   * Balance Sheet (Balans Hesabatı) as of a single date — cumulative
   * since inception (no `fromDate` floor, unlike Trial Balance's period
   * window) over ASSET/LIABILITY/EQUITY accounts, same signing
   * convention as `incomeStatement`. Because this build never runs a
   * period-close journal entry sweeping P&L into Retained Earnings (no
   * such handler exists anywhere in this codebase — confirmed), the
   * current cumulative net income is folded in as a single synthetic
   * EQUITY line ("Cari mənfəət/zərər") computed live from the same
   * Income Statement query, exactly so Assets = Liabilities + Equity
   * actually holds — never a stored closing entry, consistent with
   * every other report here reading live from AccountingMovement only.
   */
  async balanceSheet(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    params: { asOfDate: Date },
  ): Promise<{ rows: FinancialStatementRow[]; totalAssets: string; totalLiabilities: string; totalEquity: string; currentPeriodNetIncome: string }> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, accountClass: { in: [...ASSET_CLASSES, ...LIABILITY_CLASSES, ...EQUITY_CLASSES] } },
      include: { section: true, group: true },
      orderBy: { code: 'asc' },
    });
    const accountIds = accounts.map((a) => a.id);

    const cumulative = await this.prisma.accountingMovement.groupBy({
      by: ['accountId', 'side'],
      where: { tenantId, organizationId, accountId: { in: accountIds }, businessDate: { lte: params.asOfDate } },
      _sum: { amountBase: true },
    });
    const cumulativeMap = groupToMap(cumulative);

    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalEquity = new Decimal(0);
    const rows: FinancialStatementRow[] = accounts.map((account) => {
      const c = cumulativeMap.get(account.id) ?? { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
      const amount = account.normalBalance === 'CREDIT' ? c.CREDIT.minus(c.DEBIT) : c.DEBIT.minus(c.CREDIT);
      if (ASSET_CLASSES.includes(account.accountClass)) totalAssets = totalAssets.plus(amount);
      else if (LIABILITY_CLASSES.includes(account.accountClass)) totalLiabilities = totalLiabilities.plus(amount);
      else totalEquity = totalEquity.plus(amount);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        sectionCode: account.section?.code ?? null,
        sectionName: account.section?.name ?? null,
        groupCode: account.group?.code ?? null,
        groupName: account.group?.name ?? null,
        amount: amount.toFixed(2),
      };
    });

    const tenantStart = new Date(0);
    const income = await this.incomeStatement(tenantId, membershipId, organizationId, { fromDate: tenantStart, toDate: params.asOfDate });
    const currentPeriodNetIncome = new Decimal(income.netIncome);
    totalEquity = totalEquity.plus(currentPeriodNetIncome);

    return {
      rows,
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiabilities.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      currentPeriodNetIncome: currentPeriodNetIncome.toFixed(2),
    };
  }

  /** "Mühasibat yazılışlarına bax" — every document's own accounting-
   * entries viewer, generic across document types (same shape as
   * /document-links and /approval-steps): every AccountingMovement this
   * document's posting produced, grouped by JournalEntry so the UI can
   * show one balanced entry per posting/repost generation rather than a
   * flat movement list. Reads AccountingMovement directly (it already
   * carries sourceDocumentType/sourceDocumentId) rather than joining
   * through JournalEntryLine. */
  async journalEntriesForDocument(tenantId: string, membershipId: string, organizationId: string, sourceDocumentType: string, sourceDocumentId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const movements = await this.prisma.accountingMovement.findMany({
      where: { tenantId, organizationId, sourceDocumentType, sourceDocumentId },
      include: { account: true, dimensions: { include: { dimension: true } } },
      orderBy: [{ journalEntryId: 'asc' }, { postingSequence: 'asc' }],
    });
    if (movements.length === 0) return [];

    const journalEntryIds = Array.from(new Set(movements.map((m) => m.journalEntryId)));
    const journalEntries = await this.prisma.journalEntry.findMany({ where: { id: { in: journalEntryIds } } });
    const byId = new Map(journalEntries.map((j) => [j.id, j]));

    const grouped = new Map<string, typeof movements>();
    for (const m of movements) {
      const list = grouped.get(m.journalEntryId) ?? [];
      list.push(m);
      grouped.set(m.journalEntryId, list);
    }

    return Array.from(grouped.entries()).map(([journalEntryId, lines]) => ({
      journalEntry: byId.get(journalEntryId),
      lines,
    }));
  }

  private async descendantIdsIncludingSelf(tenantId: string, accountId: string): Promise<string[]> {
    const ids = [accountId];
    let frontier = [accountId];
    // Chart depth is shallow (account -> subaccount, spec section 19-20),
    // but loop generically rather than assuming exactly one level.
    for (let i = 0; i < 5 && frontier.length > 0; i++) {
      const children = await this.prisma.account.findMany({
        where: { tenantId, parentAccountId: { in: frontier } },
        select: { id: true },
      });
      if (children.length === 0) break;
      frontier = children.map((c) => c.id);
      ids.push(...frontier);
    }
    return ids;
  }
}

function groupToMap(
  rows: Array<{ accountId: string; side: string; _sum: { amountBase: Decimal | null } }>,
): Map<string, { DEBIT: Decimal; CREDIT: Decimal }> {
  const map = new Map<string, { DEBIT: Decimal; CREDIT: Decimal }>();
  for (const row of rows) {
    const entry = map.get(row.accountId) ?? { DEBIT: new Decimal(0), CREDIT: new Decimal(0) };
    entry[row.side as 'DEBIT' | 'CREDIT'] = new Decimal(row._sum.amountBase ?? 0);
    map.set(row.accountId, entry);
  }
  return map;
}
