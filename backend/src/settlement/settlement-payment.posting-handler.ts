import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { SETTLEMENT_PAYMENT_TYPE } from './settlement-payment.repository';
import { BankCashMovementService } from '../treasury/bank-cash-movement.service';
import { CashMovementService } from '../cash/cash-movement.service';
import { AccountablePersonService } from '../cash/accountable-person.service';

const NON_COUNTERPARTY_EXPENSE_MAPPING: Record<string, string> = {
  TAX_PAYMENT: MappingKeys.CURRENT_INCOME_TAX_EXPENSE,
  PAYROLL_PAYMENT: MappingKeys.ADMIN_EXPENSE,
  LOAN_REPAYMENT: MappingKeys.OTHER_OPERATING_EXPENSE,
  INTEREST_INCOME: MappingKeys.OTHER_OPERATING_INCOME,
  LOAN_RECEIPT: MappingKeys.OTHER_OPERATING_INCOME,
  SALARY_PAYMENT: MappingKeys.ADMIN_EXPENSE,
  PETTY_CASH_EXPENSE: MappingKeys.OTHER_OPERATING_EXPENSE,
  OTHER: MappingKeys.OTHER_OPERATING_EXPENSE,
};

const EMPLOYEE_ADVANCE_TYPES = ['EMPLOYEE_ADVANCE', 'EMPLOYEE_ADVANCE_RETURN'];

/**
 * Posting handler for SettlementPayment — the Phase 13 payment-adapter
 * placeholder, extended for Phase 14 (bank) and, here, Phase 15 (cash,
 * spec sections 9-11, 68-72). Exactly ONE of `bankAccountId`/`cashDeskId`
 * is ever set on a given row; this handler picks the matching register
 * (`BankCashMovementService`/`CashMovementService`) and GL leg (BANK vs
 * CASH mapping key) accordingly. `employeeId` + an `EMPLOYEE_ADVANCE*`
 * operation type routes through `AccountablePersonService` instead of
 * the counterparty clearing-account shape (spec section 27) — Dr/Cr
 * Accountable Person Receivable, never Customer/Supplier Advance.
 */
@Injectable()
export class SettlementPaymentPostingHandler implements DocumentPostingHandler {
  readonly documentType = SETTLEMENT_PAYMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly bankCash: BankCashMovementService,
    private readonly cashMovements: CashMovementService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const payment = await tx.settlementPayment.findFirst({ where: { id: document.id, tenantId } });
    if (!payment) throw new ValidationAppError('Document disappeared during posting');
    if (payment.amount.lte(0)) throw new ValidationAppError('Cannot post a payment with non-positive amount');
    if (payment.counterpartyId) {
      const counterparty = await tx.counterparty.findFirst({ where: { id: payment.counterpartyId, tenantId } });
      if (!counterparty || !counterparty.active) throw new ValidationAppError('Cannot post a payment for a missing or inactive counterparty');
    }

    if (payment.cashDeskId) {
      const desk = await tx.cashbox.findFirst({ where: { id: payment.cashDeskId, tenantId } });
      if (!desk || !desk.active) throw new ValidationAppError('Cannot post a cash document for a missing or inactive cash desk');
      if (payment.cashierId) {
        const assignment = await tx.cashierAssignment.findFirst({ where: { tenantId, cashDeskId: payment.cashDeskId, userId: payment.cashierId, status: 'ACTIVE' } });
        if (!assignment) throw new ValidationAppError(`User does not have an active cashier assignment for cash desk ${desk.name}.`);
      }
      const dailyClose = await tx.cashDailyClose.findFirst({ where: { tenantId, cashDeskId: payment.cashDeskId, businessDate: document.documentDate, status: 'CLOSED' } });
      if (dailyClose) throw new ValidationAppError(`Cash day ${document.documentDate.toISOString().slice(0, 10)} is already closed for this cash desk.`);
    }

    if (payment.paymentRequestId) {
      const request = await tx.paymentRequest.findFirst({ where: { id: payment.paymentRequestId, tenantId } });
      if (!request) throw new ValidationAppError('Linked payment request not found');
      const alreadyPaid = new Decimal(request.paidAmount.toString());
      const approved = new Decimal(request.approvedAmount.toString());
      if (alreadyPaid.plus(payment.amount.toString()).gt(approved.plus('0.01'))) {
        throw new ValidationAppError(`Payment request ${request.number ?? request.id} has only ${approved.minus(alreadyPaid).toString()} approved-and-unpaid.`);
      }
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const payment = await tx.settlementPayment.findFirst({ where: { id: document.id, tenantId } });
    if (!payment) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = payment.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(payment.amount.toString());
    const isIncoming = payment.direction === 'INCOMING';
    const isCash = !!payment.cashDeskId;

    // Layer 2 — real cash/bank movement, independent of GL mapping
    // availability (the physical cash/bank fact is never blocked by a
    // missing account mapping).
    if (isCash) {
      await this.cashMovements.record(
        tenantId,
        { organizationId, cashDeskId: payment.cashDeskId!, cashierId: payment.cashierId, currencyId: payment.currencyId, direction: isIncoming ? 'INFLOW' : 'OUTFLOW', amount, baseAmount: amount.mul(payment.exchangeRate ? Number(payment.exchangeRate.toString()) : 1).toDecimalPlaces(2), sourceDocumentType: SETTLEMENT_PAYMENT_TYPE, sourceDocumentId: payment.id, effectiveDate: businessDate },
        tx,
      );
    } else if (payment.bankAccountId) {
      await this.bankCash.record(
        tenantId,
        { organizationId, bankAccountId: payment.bankAccountId, currencyId: payment.currencyId, direction: isIncoming ? 'INFLOW' : 'OUTFLOW', amount, baseAmount: amount.mul(payment.exchangeRate ? Number(payment.exchangeRate.toString()) : 1).toDecimalPlaces(2), sourceDocumentType: SETTLEMENT_PAYMENT_TYPE, sourceDocumentId: payment.id, transactionDate: businessDate, effectiveDate: businessDate },
        tx,
      );
    }

    // Accountable person (spec sections 27-32) — Cash's own settlement
    // dimension, never Phase 13's counterparty tables.
    if (payment.employeeId && EMPLOYEE_ADVANCE_TYPES.includes(payment.operationType ?? '')) {
      await this.accountablePersons.record(
        tenantId,
        { organizationId, employeeId: payment.employeeId, currencyId: payment.currencyId, movementType: payment.operationType === 'EMPLOYEE_ADVANCE_RETURN' ? 'RETURN' : 'ISSUE', amount, sourceDocumentType: SETTLEMENT_PAYMENT_TYPE, sourceDocumentId: payment.id, effectiveDate: businessDate },
        tx,
      );
    }

    // Layer 1 — payment request execution update (spec sections 72, 74).
    if (payment.paymentRequestId) {
      const request = await tx.paymentRequest.findFirstOrThrow({ where: { id: payment.paymentRequestId } });
      const newPaid = new Decimal(request.paidAmount.toString()).plus(amount);
      const approved = new Decimal(request.approvedAmount.toString());
      const status = newPaid.gte(approved.minus('0.01')) ? 'PAID' : 'PARTIALLY_PAID';
      await tx.paymentRequest.update({ where: { id: request.id }, data: { paidAmount: newPaid.toString(), status } });
      await tx.paymentCalendarItem.updateMany({ where: { tenantId, paymentRequestId: request.id }, data: { executedAmount: { increment: amount.toString() }, remainingAmount: { decrement: amount.toString() } } });
    }

    const dims = [{ dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: payment.id }, { dimensionCode: 'CURRENCY', referenceId: payment.currencyId }];
    const cashOrBank = await this.mappings.resolve(tenantId, organizationId, isCash ? MappingKeys.CASH : MappingKeys.BANK, businessDate, tx).catch(() => null);
    if (!cashOrBank) return null;

    let counterAccount;
    let counterDims = dims;
    if (payment.employeeId && EMPLOYEE_ADVANCE_TYPES.includes(payment.operationType ?? '')) {
      // Dr/Cr Accountable Person Receivable — this build has no dedicated
      // mapping key for it yet, falls back to SUPPLIER_ADVANCE (a
      // receivable-from-a-third-party shape closest to what already
      // exists) — disclosed simplification, see docs/CASH.md.
      counterAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_ADVANCE, businessDate, tx).catch(() => null);
    } else if (payment.counterpartyId) {
      counterAccount = await this.mappings.resolve(tenantId, organizationId, payment.counterpartyRole === 'CUSTOMER' ? MappingKeys.CUSTOMER_ADVANCE : MappingKeys.SUPPLIER_ADVANCE, businessDate, tx).catch(() => null);
      counterDims = [{ dimensionCode: 'PARTNER', referenceId: payment.counterpartyId }, { dimensionCode: 'COUNTERPARTY', referenceId: payment.counterpartyId }, ...dims];
    } else {
      const mappingKey = NON_COUNTERPARTY_EXPENSE_MAPPING[payment.operationType ?? 'OTHER'] ?? MappingKeys.OTHER_OPERATING_EXPENSE;
      counterAccount = await this.mappings.resolve(tenantId, organizationId, mappingKey, businessDate, tx).catch(() => null);
    }
    if (!counterAccount) return null;

    const label = payment.employeeId ? 'Accountable person' : payment.counterpartyId ? (isIncoming ? 'Unapplied customer payment' : 'Unapplied supplier payment') : payment.operationType;
    const lines = isIncoming
      ? [
          { accountId: cashOrBank.id, side: 'DEBIT' as const, amountBase: amount, description: `Payment received — ${payment.number ?? payment.id}`, dimensions: dims },
          { accountId: counterAccount.id, side: 'CREDIT' as const, amountBase: amount, description: `${label} — ${payment.number ?? payment.id}`, dimensions: counterDims },
        ]
      : [
          { accountId: counterAccount.id, side: 'DEBIT' as const, amountBase: amount, description: `${label} — ${payment.number ?? payment.id}`, dimensions: counterDims },
          { accountId: cashOrBank.id, side: 'CREDIT' as const, amountBase: amount, description: `Payment sent — ${payment.number ?? payment.id}`, dimensions: dims },
        ];

    return { description: `Settlement payment ${payment.number ?? payment.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  /** Blocked when any allocation/advance/statement match already
   * references this payment (spec sections 86, 153) — reverse those
   * first; reverses the cash/bank movement, accountable-person movement,
   * and payment-request execution update otherwise (spec section 154). */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const payment = await tx.settlementPayment.findFirst({ where: { id: document.id, tenantId } });
    if (!payment) return;

    const activeAllocation = await tx.settlementAllocation.findFirst({ where: { tenantId, paymentDocumentType: SETTLEMENT_PAYMENT_TYPE, paymentDocumentId: document.id, status: 'ACTIVE' } });
    if (activeAllocation) throw new ValidationAppError('Cannot unpost this payment — it has active allocations. Reverse them first.');
    const advance = await tx.settlementAdvance.findFirst({ where: { tenantId, sourceDocumentType: SETTLEMENT_PAYMENT_TYPE, sourceDocumentId: document.id, appliedAmount: { gt: 0 } } });
    if (advance) throw new ValidationAppError('Cannot unpost this payment — its advance has already been (partially) applied. Reverse that first.');
    const activeMatch = await tx.bankTransactionMatch.findFirst({ where: { tenantId, settlementPaymentId: document.id, status: 'ACTIVE' } });
    if (activeMatch) throw new ValidationAppError('Cannot unpost this payment — it is matched to a bank statement line. Reverse that match first.');
    if (payment.cashDeskId) {
      const dailyClose = await tx.cashDailyClose.findFirst({ where: { tenantId, cashDeskId: payment.cashDeskId, businessDate: document.documentDate, status: 'CLOSED' } });
      if (dailyClose) throw new ValidationAppError('Cannot unpost — this cash day is already closed. Reopen the daily close first.');
    }

    await tx.settlementAdvance.deleteMany({ where: { tenantId, sourceDocumentType: SETTLEMENT_PAYMENT_TYPE, sourceDocumentId: document.id } });
    await this.accountablePersons.reverse(tenantId, SETTLEMENT_PAYMENT_TYPE, document.id, tx);
    if (payment.cashDeskId) await this.cashMovements.reverse(tenantId, SETTLEMENT_PAYMENT_TYPE, document.id, tx);
    else await this.bankCash.reverse(tenantId, SETTLEMENT_PAYMENT_TYPE, document.id, tx);

    if (payment.paymentRequestId) {
      const request = await tx.paymentRequest.findFirst({ where: { id: payment.paymentRequestId, tenantId } });
      if (request) {
        const newPaid = new Decimal(request.paidAmount.toString()).minus(payment.amount.toString());
        await tx.paymentRequest.update({ where: { id: request.id }, data: { paidAmount: newPaid.lt(0) ? '0' : newPaid.toString(), status: newPaid.gt('0.01') ? 'PARTIALLY_PAID' : 'APPROVED' } });
        await tx.paymentCalendarItem.updateMany({ where: { tenantId, paymentRequestId: request.id }, data: { executedAmount: { decrement: payment.amount.toString() }, remainingAmount: { increment: payment.amount.toString() } } });
      }
    }
  }
}
