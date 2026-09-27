import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  CashBalanceService,
  CASH_MOVEMENT_REGISTER,
} from './cash-balance.service';

/**
 * CashReportingService (docx spec Phase 15, sections 42-44/96-103) — read
 * models only, every number derived live from RegisterMovement/document
 * tables, never a separate reporting table. Covers Cash Book, Cash
 * Balance Report, Cashier Turnover Report, Difference Report and Transfer
 * Report; the Accountable Person Report is AccountablePersonService's own
 * `getBalance`/`ageing` (already exposed via AccountablePersonController)
 * — not duplicated here.
 */
@Injectable()
export class CashReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly cashBalance: CashBalanceService,
  ) {}

  /** Cash Book — opening balance + every movement in range + running balance. */
  async cashBook(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId: string,
    fromDate: Date,
    toDate: Date,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const dayBeforeFrom = new Date(fromDate);
    dayBeforeFrom.setUTCDate(dayBeforeFrom.getUTCDate() - 1);
    const openingBalance = await this.cashBalance.getBookBalance(
      tenantId,
      cashboxId,
      dayBeforeFrom,
    );

    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: CASH_MOVEMENT_REGISTER,
        businessDate: { gte: fromDate, lte: toDate },
        dimensions: { path: ['cashboxId'], equals: cashboxId },
      },
      orderBy: [{ businessDate: 'asc' }, { sequence: 'asc' }],
    });

    let running = openingBalance;
    const rows = movements.map((m) => {
      const resources = m.resources as {
        amount?: string;
        direction?: string;
      } | null;
      const amount = new Decimal(resources?.amount ?? '0');
      const isOutflow =
        resources?.direction === 'PAYMENT' ||
        resources?.direction === 'OUTFLOW';
      running = isOutflow ? running.minus(amount) : running.plus(amount);
      return {
        businessDate: m.businessDate,
        movementType: m.movementType,
        recorderDocumentType: m.recorderDocumentType,
        recorderDocumentId: m.recorderDocumentId,
        direction: isOutflow ? 'OUTFLOW' : 'INFLOW',
        amount: amount.toFixed(2),
        runningBalance: running.toFixed(2),
      };
    });

    return {
      cashboxId,
      fromDate,
      toDate,
      openingBalance: openingBalance.toFixed(2),
      closingBalance: running.toFixed(2),
      lines: rows,
    };
  }

  /** Cash Balance Report — every active cash desk's live book balance. */
  async balanceReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cashboxes = await this.prisma.cashbox.findMany({
      where: { organizationId, active: true },
    });
    const now = new Date();
    const rows = [];
    for (const cashbox of cashboxes) {
      const balance = await this.cashBalance.getBookBalance(
        tenantId,
        cashbox.id,
        now,
      );
      rows.push({
        cashboxId: cashbox.id,
        code: cashbox.code,
        name: cashbox.name,
        currencyId: cashbox.currencyId,
        balance: balance.toFixed(2),
      });
    }
    return rows;
  }

  /** Cashier Turnover Report — per-cashier receipt/expense totals in range. */
  async cashierTurnover(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: Date,
    toDate: Date,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const transactions = await this.prisma.cashTransaction.findMany({
      where: {
        organizationId,
        postingStatus: 'POSTED',
        documentDate: { gte: fromDate, lte: toDate },
        cashierId: { not: null },
      },
    });
    const byCashier = new Map<
      string,
      { receipts: Decimal; expenses: Decimal; documentCount: number }
    >();
    for (const txn of transactions) {
      const key = txn.cashierId!;
      const bucket = byCashier.get(key) ?? {
        receipts: new Decimal(0),
        expenses: new Decimal(0),
        documentCount: 0,
      };
      const amount = new Decimal(txn.amount.toString());
      if (txn.direction === 'RECEIPT')
        bucket.receipts = bucket.receipts.plus(amount);
      else bucket.expenses = bucket.expenses.plus(amount);
      bucket.documentCount += 1;
      byCashier.set(key, bucket);
    }
    return Array.from(byCashier.entries()).map(([cashierId, b]) => ({
      cashierId,
      receipts: b.receipts.toFixed(2),
      expenses: b.expenses.toFixed(2),
      net: b.receipts.minus(b.expenses).toFixed(2),
      documentCount: b.documentCount,
    }));
  }

  /** Difference Report — every physical count with a non-zero difference and its resolution state. */
  async differenceReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const counts = await this.prisma.cashPhysicalCount.findMany({
      where: { organizationId, difference: { not: null } },
      orderBy: { countTimestamp: 'desc' },
    });
    const rows = [];
    for (const count of counts) {
      if (
        !count.difference ||
        new Decimal(count.difference.toString()).isZero()
      )
        continue;
      const adjustment = await this.prisma.cashCountAdjustment.findFirst({
        where: { countId: count.id },
      });
      rows.push({
        countId: count.id,
        cashboxId: count.cashboxId,
        countTimestamp: count.countTimestamp,
        difference: count.difference.toString(),
        status: count.status,
        adjustmentId: adjustment?.id ?? null,
        adjustmentStatus: adjustment ? adjustment.postingStatus : 'NONE',
      });
    }
    return rows;
  }

  /** Transfer Report — every cash desk transfer with its current state. */
  transferReport(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.cashDeskTransfer.findMany({
          where: {
            organizationId,
            ...(cashboxId
              ? {
                  OR: [
                    { sourceCashboxId: cashboxId },
                    { destinationCashboxId: cashboxId },
                  ],
                }
              : {}),
          },
          orderBy: { createdAt: 'desc' },
        }),
      );
  }
}
