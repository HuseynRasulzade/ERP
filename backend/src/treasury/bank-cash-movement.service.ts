import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';

export interface RecordBankCashMovementInput {
  organizationId: string;
  bankAccountId: string;
  currencyId: string;
  direction: 'INFLOW' | 'OUTFLOW';
  amount: Decimal;
  baseAmount: Decimal;
  sourceDocumentType: string;
  sourceDocumentId: string;
  bankStatementLineId?: string | null;
  transactionDate: Date;
  valueDate?: Date | null;
  effectiveDate: Date;
}

/**
 * BankCashMovementService — Layer 2's own immutable register (spec
 * section 30), deliberately separate from Phase 13's `SettlementMovement`
 * (Layer 3) and from `PaymentCalendarItem` (Layer 1). Every real bank
 * balance change in the platform — a posted `SettlementPayment`'s bank
 * leg, `InternalBankTransfer`, `BankFee`, `FXConversion` — writes through
 * here, and `BankReconciliationService`/`TreasuryReportingService` read
 * the book balance ONLY from this table, never a cached field (spec
 * section 31: "Current bank balance iki mənbədən gələ bilər" — this is
 * the ERP Book Balance source).
 */
@Injectable()
export class BankCashMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tenantId: string, input: RecordBankCashMovementInput, tx: PrismaTransactionClient) {
    if (input.amount.lte(0)) throw new ValidationAppError('Bank cash movement amount must be positive (direction carries the sign)');

    const account = await tx.bankAccount.findFirst({ where: { id: input.bankAccountId, tenantId } });
    if (!account) throw new ValidationAppError('Unknown bank account');

    if (input.direction === 'OUTFLOW' && account.negativeBalancePolicy !== 'ALLOW') {
      const currentBalance = await this.getBookBalance(tenantId, input.bankAccountId, tx);
      const projected = currentBalance.minus(input.amount);
      const floor = account.overdraftAllowed && account.overdraftLimit ? new Decimal(account.overdraftLimit.toString()).negated() : new Decimal(0);
      if (projected.lt(floor)) {
        if (account.negativeBalancePolicy === 'BLOCK') {
          throw new ValidationAppError(`Bank account ${account.accountName} would go negative beyond its allowed overdraft (projected ${projected.toString()}).`);
        }
        // WARNING policy: proceed, caller/audit surfaces it via health checks.
      }
    }

    return tx.bankCashMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        bankAccountId: input.bankAccountId,
        currencyId: input.currencyId,
        direction: input.direction,
        amount: input.amount.toString(),
        baseAmount: input.baseAmount.toString(),
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        bankStatementLineId: input.bankStatementLineId ?? undefined,
        transactionDate: input.transactionDate,
        valueDate: input.valueDate ?? undefined,
        effectiveDate: input.effectiveDate,
      },
    });
  }

  async reverse(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient) {
    await tx.bankCashMovement.updateMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, reversed: false }, data: { reversed: true } });
  }

  /** ERP Book Balance (spec section 31) — always live from movements,
   * never a cached field. */
  async getBookBalance(tenantId: string, bankAccountId: string, tx?: PrismaTransactionClient, asOfDate?: Date): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const [inflow, outflow] = await Promise.all([
      db.bankCashMovement.aggregate({ where: { tenantId, bankAccountId, direction: 'INFLOW', reversed: false, ...(asOfDate ? { effectiveDate: { lte: asOfDate } } : {}) }, _sum: { amount: true } }),
      db.bankCashMovement.aggregate({ where: { tenantId, bankAccountId, direction: 'OUTFLOW', reversed: false, ...(asOfDate ? { effectiveDate: { lte: asOfDate } } : {}) }, _sum: { amount: true } }),
    ]);
    return new Decimal((inflow._sum.amount ?? 0).toString()).minus((outflow._sum.amount ?? 0).toString());
  }
}
