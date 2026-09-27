import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { PaymentCalendarService } from './payment-calendar.service';

const BANK_CASH_MOVEMENT_REGISTER = 'BANK_CASH_MOVEMENT_REGISTER';

export interface LiquidityForecastRow {
  bankAccountId: string;
  currencyId: string;
  openingBalance: string;
  plannedInflows: string;
  plannedOutflows: string;
  projectedClosingBalance: string;
  minimumBuffer: string | null;
  cashGap: string | null; // positive = shortfall below the buffer
  availableOverdraft: string;
  availableLiquidity: string;
}

/**
 * TreasuryLiquidityService (spec sections 19-22, 76-78, 115) — Current
 * Bank Balance and Projected Balance are ALWAYS shown separately (spec
 * section 22): the book balance below is the real, already-posted
 * movement history (BankCashMovementRegister — RegisterMovement rows
 * under BANK_CASH_MOVEMENT_REGISTER, never a mutable "current balance"
 * field, same Stock-Truth-Engine principle Warehouse/Stock uses);
 * everything from the Payment Calendar onward is a forward projection
 * that never touches it.
 */
@Injectable()
export class LiquidityForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly calendar: PaymentCalendarService,
  ) {}

  /** Historical/current book balance (spec sections 30-31, 156) — computed
   * from the immutable movement register, never a stored running total. */
  async getBookBalance(
    tenantId: string,
    bankAccountId: string,
    asOfDate: Date = new Date(),
  ): Promise<Decimal> {
    const movements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: BANK_CASH_MOVEMENT_REGISTER,
        businessDate: { lte: asOfDate },
        dimensions: { path: ['bankAccountId'], equals: bankAccountId },
      },
    });
    return movements.reduce((sum, m) => {
      const resources = m.resources as {
        amount?: string;
        direction?: string;
      } | null;
      if (!resources?.amount) return sum;
      const amount = new Decimal(resources.amount);
      return resources.direction === 'OUTFLOW'
        ? sum.minus(amount)
        : sum.plus(amount);
    }, new Decimal(0));
  }

  async forecast(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<LiquidityForecastRow[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccounts = await this.prisma.bankAccount.findMany({
      where: { organizationId, active: true },
    });
    const calendarItems = await this.calendar.list(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
    const policies = await this.prisma.treasuryLiquidityPolicy.findMany({
      where: { organizationId, active: true },
    });

    const rows: LiquidityForecastRow[] = [];
    for (const account of bankAccounts) {
      const opening = await this.getBookBalance(tenantId, account.id, fromDate);
      // Calendar items carry no bankAccountId of their own (a PaymentRequest
      // hasn't picked one yet) — every org-level planned item is included
      // against every one of the org's bank accounts' currency-matching
      // rows for a currency-scoped view; a per-account bank_account_id is
      // only known once a PaymentOrder/IncomingBankPayment actually exists.
      const relevant = calendarItems.filter(
        (i) => !i.currencyId || i.currencyId === account.currencyId,
      );
      const inflows = relevant
        .filter((i) => i.cashFlowDirection === 'INFLOW')
        .reduce((s, i) => s.plus(i.remainingAmount), new Decimal(0));
      const outflows = relevant
        .filter((i) => i.cashFlowDirection === 'OUTFLOW')
        .reduce((s, i) => s.plus(i.remainingAmount), new Decimal(0));
      const projectedClosing = opening.plus(inflows).minus(outflows);

      const policy =
        policies.find((p) => p.bankAccountId === account.id) ??
        policies.find(
          (p) =>
            p.bankAccountId === null && p.currencyId === account.currencyId,
        ) ??
        policies.find((p) => p.bankAccountId === null && p.currencyId === null);
      const minimumBuffer = policy
        ? new Decimal(policy.minimumBalance.toString())
        : null;
      const cashGap =
        minimumBuffer && projectedClosing.lt(minimumBuffer)
          ? minimumBuffer.minus(projectedClosing)
          : null;

      const availableOverdraft =
        account.overdraftAllowed && account.overdraftLimit
          ? new Decimal(account.overdraftLimit.toString())
          : new Decimal(0);

      rows.push({
        bankAccountId: account.id,
        currencyId: account.currencyId,
        openingBalance: opening.toFixed(2),
        plannedInflows: inflows.toFixed(2),
        plannedOutflows: outflows.toFixed(2),
        projectedClosingBalance: projectedClosing.toFixed(2),
        minimumBuffer: minimumBuffer?.toFixed(2) ?? null,
        cashGap: cashGap?.toFixed(2) ?? null,
        availableOverdraft: availableOverdraft.toFixed(2),
        availableLiquidity: projectedClosing
          .plus(availableOverdraft)
          .toFixed(2),
      });
    }
    return rows;
  }
}
