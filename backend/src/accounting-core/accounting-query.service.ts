import { Injectable } from '@nestjs/common';
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
