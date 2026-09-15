import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export interface RecordSettlementMovementInput {
  organizationId: string;
  branchId?: string | null;
  partnerId?: string | null;
  counterpartyId: string;
  counterpartyRole: 'CUSTOMER' | 'SUPPLIER';
  contractId?: string | null;
  agreementId?: string | null;
  settlementDimensionType?: string;
  settlementDocumentType?: string | null;
  settlementDocumentId?: string | null;
  settlementDocumentLineId?: string | null;
  currencyId: string;
  dueDate?: Date | null;
  paymentScheduleLineId?: string | null;
  transactionCurrencyAmount: Decimal; // signed
  baseCurrencyAmount: Decimal; // signed
  movementType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentLineId?: string | null;
  effectiveDate: Date;
  postingDate?: Date;
}

/**
 * SettlementMovementService (spec section 4) — the ONLY writer to
 * `SettlementMovement`, the platform's single authoritative AR/AP
 * register. `debitAmount`/`creditAmount` are derived here from the sign
 * of `baseCurrencyAmount` and `counterpartyRole` (spec section 5: never
 * conflate GL debit/credit with the business `movementType`) — a positive
 * base amount on a CUSTOMER row is a receivable increase (debit-natured),
 * on a SUPPLIER row a payable increase (credit-natured).
 */
@Injectable()
export class SettlementMovementService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tenantId: string, input: RecordSettlementMovementInput, tx: PrismaTransactionClient) {
    const base = input.baseCurrencyAmount;
    const isCustomer = input.counterpartyRole === 'CUSTOMER';
    // Receivables are debit-natured, payables credit-natured; a REDUCE/APPLY
    // movement is the opposite sign of its own CREATE — so derive purely
    // from the sign actually passed rather than movementType string matching.
    const debitAmount = (isCustomer ? base.gt(0) : base.lt(0)) ? base.abs() : new Decimal(0);
    const creditAmount = (isCustomer ? base.lt(0) : base.gt(0)) ? base.abs() : new Decimal(0);

    return tx.settlementMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        branchId: input.branchId ?? undefined,
        partnerId: input.partnerId ?? undefined,
        counterpartyId: input.counterpartyId,
        counterpartyRole: input.counterpartyRole,
        contractId: input.contractId ?? undefined,
        agreementId: input.agreementId ?? undefined,
        settlementDimensionType: input.settlementDimensionType ?? 'BY_DOCUMENT',
        settlementDocumentType: input.settlementDocumentType ?? undefined,
        settlementDocumentId: input.settlementDocumentId ?? undefined,
        settlementDocumentLineId: input.settlementDocumentLineId ?? undefined,
        currencyId: input.currencyId,
        dueDate: input.dueDate ?? undefined,
        paymentScheduleLineId: input.paymentScheduleLineId ?? undefined,
        debitAmount: debitAmount.toString(),
        creditAmount: creditAmount.toString(),
        transactionCurrencyAmount: input.transactionCurrencyAmount.toString(),
        baseCurrencyAmount: base.toString(),
        movementType: input.movementType,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        effectiveDate: input.effectiveDate,
        postingDate: input.postingDate ?? input.effectiveDate,
      },
    });
  }

  /** Reverses every movement a source document/line posted (unpost,
   * spec section 90) — marks `reversed=true` and writes an equal-and-
   * opposite row rather than deleting (immutable register). */
  async reverse(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, userId: string | undefined, tx: PrismaTransactionClient) {
    const movements = await tx.settlementMovement.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, reversed: false } });
    for (const m of movements) {
      await tx.settlementMovement.update({ where: { id: m.id }, data: { reversed: true } });
      await tx.settlementMovement.create({
        data: {
          tenantId,
          organizationId: m.organizationId,
          branchId: m.branchId,
          partnerId: m.partnerId,
          counterpartyId: m.counterpartyId,
          counterpartyRole: m.counterpartyRole,
          contractId: m.contractId,
          agreementId: m.agreementId,
          settlementDimensionType: m.settlementDimensionType,
          settlementDocumentType: m.settlementDocumentType,
          settlementDocumentId: m.settlementDocumentId,
          settlementDocumentLineId: m.settlementDocumentLineId,
          currencyId: m.currencyId,
          dueDate: m.dueDate,
          paymentScheduleLineId: m.paymentScheduleLineId,
          debitAmount: m.creditAmount, // swapped
          creditAmount: m.debitAmount,
          transactionCurrencyAmount: new Decimal(m.transactionCurrencyAmount.toString()).negated().toString(),
          baseCurrencyAmount: new Decimal(m.baseCurrencyAmount.toString()).negated().toString(),
          movementType: m.movementType,
          sourceDocumentType: m.sourceDocumentType,
          sourceDocumentId: m.sourceDocumentId,
          sourceDocumentLineId: m.sourceDocumentLineId,
          effectiveDate: m.effectiveDate,
          postingDate: new Date(),
          reversalOfMovementId: m.id,
        },
      });
    }
  }

  /** Historical/as-of balance (spec sections 91-92) — always from the
   * movement register, never guessed backwards from current open items. */
  async getBalanceAsOf(tenantId: string, organizationId: string, counterpartyId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', asOfDate: Date, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const agg = await db.settlementMovement.aggregate({
      where: { tenantId, organizationId, counterpartyId, counterpartyRole, effectiveDate: { lte: asOfDate } },
      _sum: { baseCurrencyAmount: true },
    });
    return new Decimal((agg._sum.baseCurrencyAmount ?? 0).toString());
  }
}
