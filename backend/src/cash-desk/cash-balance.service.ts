import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';

export const CASH_MOVEMENT_REGISTER = 'CASH_MOVEMENT_REGISTER';

/**
 * CashBalanceService — the single place a cash desk's book balance is
 * computed (spec section 15: "Cash Desk balance: Σ inflow - Σ outflow...
 * Authoritative source movement register olmalıdır. cash_desk.balance
 * mutable field authoritative source kimi istifadə edilməməlidir").
 * Reads the immutable RegisterMovement ledger under CASH_MOVEMENT_REGISTER
 * — every cash-affecting document (CashTransaction, CashDeskTransfer,
 * CashCountAdjustment) writes its own movement there, never a mutable
 * balance field. Also answers historical queries (spec section 80:
 * "Current balance field-dən backwards hesablamaya çalışma") by filtering
 * on `businessDate`.
 */
@Injectable()
export class CashBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** `client` may be a transaction client so a caller already inside a
   * posting transaction (the negative-balance check) sees its own
   * not-yet-committed movements. */
  async getBookBalance(
    tenantId: string,
    cashboxId: string,
    asOfDate: Date = new Date(),
    client: PrismaTransactionClient | PrismaService = this.prisma,
  ): Promise<Decimal> {
    const movements = await client.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: CASH_MOVEMENT_REGISTER,
        businessDate: { lte: asOfDate },
        dimensions: { path: ['cashboxId'], equals: cashboxId },
      },
    });
    return movements.reduce((sum, m) => {
      const resources = m.resources as {
        amount?: string;
        direction?: string;
      } | null;
      if (!resources?.amount) return sum;
      const amount = new Decimal(resources.amount);
      return resources.direction === 'PAYMENT' ||
        resources.direction === 'OUTFLOW'
        ? sum.minus(amount)
        : sum.plus(amount);
    }, new Decimal(0));
  }

  /** Concurrency-safe availability check (spec sections 17-18, tests 119,
   * 135): acquires an advisory lock on `tenantId:cashboxId` — the caller
   * (CashTransactionPostingHandler.validateForPosting) must call this
   * FIRST, before reading the balance, and the lock must be held for the
   * whole posting transaction (pg_advisory_xact_lock releases at COMMIT)
   * so two concurrent expenses can never both pass the check and jointly
   * overdraw the cashbox — the same bug class Phase 14's bank-statement
   * matching found and fixed. */
  async lockCashbox(
    tenantId: string,
    cashboxId: string,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${cashboxId}`}))`;
  }
}
