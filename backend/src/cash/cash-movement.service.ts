import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface RecordCashMovementInput {
  organizationId: string;
  branchId?: string | null;
  cashDeskId: string;
  cashierId?: string | null;
  currencyId: string;
  direction: 'INFLOW' | 'OUTFLOW';
  amount: Decimal;
  baseAmount: Decimal;
  sourceDocumentType: string;
  sourceDocumentId: string;
  effectiveDate: Date;
}

/**
 * CashMovementService — Cash's own Layer 2 register (spec section 14),
 * deliberately separate from `BankCashMovementService` (spec section
 * 119). A standalone module (no dependency on `settlement`/`cash`'s own
 * document services) for the same reason `BankCashMovementService` is —
 * `SettlementModule`'s `SettlementPaymentPostingHandler` needs to write
 * through here for a cash leg without importing the whole `CashModule`.
 */
@Injectable()
export class CashMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tenantId: string, input: RecordCashMovementInput, tx: PrismaTransactionClient) {
    if (input.amount.lte(0)) throw new ValidationAppError('Cash movement amount must be positive (direction carries the sign)');

    const desk = await tx.cashbox.findFirst({ where: { id: input.cashDeskId, tenantId } });
    if (!desk) throw new ValidationAppError('Unknown cash desk');
    if (!desk.allowMultiCurrency && desk.currencyId !== input.currencyId) {
      throw new ValidationAppError(`Cash desk ${desk.name} does not allow multi-currency operations — expected ${desk.currencyId}.`);
    }

    if (input.direction === 'OUTFLOW' && desk.negativeBalancePolicy === 'NEVER') {
      const currentBalance = await this.getBalance(tenantId, input.cashDeskId, input.currencyId, tx);
      if (currentBalance.minus(input.amount).lt(0)) {
        throw new ValidationAppError(`Cash desk ${desk.name} has only ${currentBalance.toString()} ${input.currencyId} available; expense of ${input.amount.toString()} cannot be posted.`);
      }
    }

    if (desk.maxCashLimit && input.direction === 'INFLOW') {
      const projected = (await this.getBalance(tenantId, input.cashDeskId, input.currencyId, tx)).plus(input.amount);
      if (projected.gt(desk.maxCashLimit.toString())) {
        // Warning-level by default — surfaced via CashHealthService, not blocking.
      }
    }

    return tx.cashMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        branchId: input.branchId ?? undefined,
        cashDeskId: input.cashDeskId,
        cashierId: input.cashierId ?? undefined,
        currencyId: input.currencyId,
        direction: input.direction,
        amount: input.amount.toString(),
        baseAmount: input.baseAmount.toString(),
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        effectiveDate: input.effectiveDate,
        postingDate: input.effectiveDate,
      },
    });
  }

  async reverse(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient) {
    await tx.cashMovement.updateMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, reversed: false }, data: { reversed: true } });
  }

  /** Authoritative cash balance (spec section 15) — never
   * `cashbox`'s own mutable fields, always live from movements. */
  async getBalance(tenantId: string, cashDeskId: string, currencyId: string, tx?: PrismaTransactionClient, asOfDate?: Date): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const [inflow, outflow] = await Promise.all([
      db.cashMovement.aggregate({ where: { tenantId, cashDeskId, currencyId, direction: 'INFLOW', reversed: false, ...(asOfDate ? { effectiveDate: { lte: asOfDate } } : {}) }, _sum: { amount: true } }),
      db.cashMovement.aggregate({ where: { tenantId, cashDeskId, currencyId, direction: 'OUTFLOW', reversed: false, ...(asOfDate ? { effectiveDate: { lte: asOfDate } } : {}) }, _sum: { amount: true } }),
    ]);
    return new Decimal((inflow._sum.amount ?? 0).toString()).minus((outflow._sum.amount ?? 0).toString());
  }

  /** All currencies a cash desk currently holds (spec section 16) — never
   * blended into one number. */
  async getBalancesByCurrency(tenantId: string, cashDeskId: string): Promise<{ currencyId: string; balance: string }[]> {
    const currencies = await this.prisma.cashMovement.findMany({ where: { tenantId, cashDeskId }, distinct: ['currencyId'], select: { currencyId: true } });
    const balances = [];
    for (const { currencyId } of currencies) balances.push({ currencyId, balance: (await this.getBalance(tenantId, cashDeskId, currencyId)).toString() });
    return balances;
  }
}
