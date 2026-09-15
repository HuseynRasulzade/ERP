import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { SettlementMovementService } from './settlement-movement.service';

export type OpenItemType = 'SETTLEMENT_OBLIGATION' | 'SUPPLIER_PAYABLE';

const SMALL_BALANCE_TOLERANCE = new Decimal('0.01');

/**
 * OpenItemService (spec sections 6-7, 12-13, 34-37). The single place
 * that creates/reduces/settles `SettlementObligation` (AR)/`SupplierPayable`
 * (AP) rows — both are rebuildable PROJECTIONS (spec section 6) kept in
 * sync from `SettlementMovementService` writes; `status` here is
 * recomputed on every change, never toggled independently.
 */
@Injectable()
export class OpenItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: SettlementMovementService,
  ) {}

  async createReceivable(
    tenantId: string,
    input: { organizationId: string; counterpartyId: string; contractId?: string | null; sourceDocumentType: string; sourceDocumentId: string; sourceDocumentLineId?: string | null; currencyId: string; amount: Decimal; baseCurrencyAmount: Decimal; exchangeRate?: Decimal | null; dueDate?: Date | null; effectiveDate: Date },
    tx: PrismaTransactionClient,
  ) {
    const obligation = await tx.settlementObligation.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        counterpartyId: input.counterpartyId,
        contractId: input.contractId ?? undefined,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        currencyId: input.currencyId,
        amountDue: input.amount.toString(),
        baseCurrencyAmount: input.baseCurrencyAmount.toString(),
        exchangeRate: input.exchangeRate?.toString(),
        remainingAmount: input.amount.toString(),
        dueDate: input.dueDate ?? undefined,
        status: 'OPEN',
      },
    });

    await this.movements.record(
      tenantId,
      {
        organizationId: input.organizationId,
        counterpartyId: input.counterpartyId,
        counterpartyRole: 'CUSTOMER',
        contractId: input.contractId,
        settlementDocumentType: input.sourceDocumentType,
        settlementDocumentId: obligation.id,
        currencyId: input.currencyId,
        dueDate: input.dueDate,
        transactionCurrencyAmount: input.amount,
        baseCurrencyAmount: input.baseCurrencyAmount,
        movementType: 'RECEIVABLE_CREATE',
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        effectiveDate: input.effectiveDate,
      },
      tx,
    );

    return obligation;
  }

  async createPayable(
    tenantId: string,
    input: { organizationId: string; counterpartyId: string; contractId?: string | null; sourceDocumentType: string; sourceDocumentId: string; sourceDocumentLineId?: string | null; currencyId: string; amount: Decimal; baseCurrencyAmount: Decimal; exchangeRate?: Decimal | null; dueDate?: Date | null; effectiveDate: Date },
    tx: PrismaTransactionClient,
  ) {
    const payable = await tx.supplierPayable.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        counterpartyId: input.counterpartyId,
        contractId: input.contractId ?? undefined,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId ?? undefined,
        currencyId: input.currencyId,
        invoiceAmount: input.amount.toString(),
        baseCurrencyAmount: input.baseCurrencyAmount.toString(),
        exchangeRate: input.exchangeRate?.toString(),
        remainingAmount: input.amount.toString(),
        dueDate: input.dueDate ?? undefined,
        status: 'OPEN',
      },
    });

    await this.movements.record(
      tenantId,
      {
        organizationId: input.organizationId,
        counterpartyId: input.counterpartyId,
        counterpartyRole: 'SUPPLIER',
        contractId: input.contractId,
        settlementDocumentType: input.sourceDocumentType,
        settlementDocumentId: payable.id,
        currencyId: input.currencyId,
        dueDate: input.dueDate,
        transactionCurrencyAmount: input.amount.negated(), // payable is a liability — negative from "our" receivable-centric sign convention
        baseCurrencyAmount: input.baseCurrencyAmount.negated(),
        movementType: 'PAYABLE_CREATE',
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        sourceDocumentLineId: input.sourceDocumentLineId,
        effectiveDate: input.effectiveDate,
      },
      tx,
    );

    return payable;
  }

  /** Sales/Purchase return (spec sections 34-37) — reduces open items for
   * the original invoice, oldest-open-first, up to `amount`; any excess
   * beyond what's still open becomes a customer/supplier credit (a new
   * `SettlementAdvance`), never a negative `remainingAmount`. */
  async reduceForReturn(tenantId: string, organizationId: string, counterpartyId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', originalInvoiceType: string, originalInvoiceId: string, amount: Decimal, currencyId: string, returnDocumentType: string, returnDocumentId: string, effectiveDate: Date, tx: PrismaTransactionClient) {
    const type: OpenItemType = counterpartyRole === 'CUSTOMER' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
    const openItems = type === 'SETTLEMENT_OBLIGATION'
      ? await tx.settlementObligation.findMany({ where: { tenantId, sourceDocumentType: originalInvoiceType, sourceDocumentId: originalInvoiceId, status: { notIn: ['CANCELLED'] } }, orderBy: { createdAt: 'asc' } })
      : await tx.supplierPayable.findMany({ where: { tenantId, sourceDocumentType: originalInvoiceType, sourceDocumentId: originalInvoiceId, status: { notIn: ['CANCELLED'] } }, orderBy: { createdAt: 'asc' } });

    let remaining = amount;
    for (const item of openItems) {
      if (remaining.lte(0)) break;
      const itemRemaining = new Decimal((item as any).remainingAmount?.toString() ?? '0');
      const take = Decimal.min(itemRemaining, remaining);
      if (take.gt(0)) {
        await this.applyToOpenItem(tenantId, type, item.id, take, tx);
        await this.movements.record(
          tenantId,
          {
            organizationId,
            counterpartyId,
            counterpartyRole,
            settlementDocumentType: originalInvoiceType,
            settlementDocumentId: item.id,
            currencyId,
            transactionCurrencyAmount: counterpartyRole === 'CUSTOMER' ? take.negated() : take,
            baseCurrencyAmount: counterpartyRole === 'CUSTOMER' ? take.negated() : take,
            movementType: counterpartyRole === 'CUSTOMER' ? 'RECEIVABLE_REDUCE' : 'PAYABLE_REDUCE',
            sourceDocumentType: returnDocumentType,
            sourceDocumentId: returnDocumentId,
            effectiveDate,
          },
          tx,
        );
        remaining = remaining.minus(take);
      }
    }

    // Excess beyond what was open — becomes a credit/advance (spec
    // sections 35, 37, 156-157) rather than a negative open-item balance.
    if (remaining.gt(0)) {
      await tx.settlementAdvance.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId,
          counterpartyRole,
          sourceDocumentType: returnDocumentType,
          sourceDocumentId: returnDocumentId,
          currencyId,
          originalAmount: remaining.toString(),
          baseCurrencyAmount: remaining.toString(),
          remainingAmount: remaining.toString(),
          status: 'OPEN',
        },
      });
      await this.movements.record(
        tenantId,
        {
          organizationId,
          counterpartyId,
          counterpartyRole,
          currencyId,
          transactionCurrencyAmount: counterpartyRole === 'CUSTOMER' ? remaining.negated() : remaining,
          baseCurrencyAmount: counterpartyRole === 'CUSTOMER' ? remaining.negated() : remaining,
          movementType: counterpartyRole === 'CUSTOMER' ? 'CUSTOMER_ADVANCE_CREATE' : 'SUPPLIER_ADVANCE_CREATE',
          sourceDocumentType: returnDocumentType,
          sourceDocumentId: returnDocumentId,
          effectiveDate,
        },
        tx,
      );
    }
  }

  /** Applies a settlement amount (from a payment allocation, return, or
   * offset) to one open item — updates `allocatedAmount`/`remainingAmount`/
   * `status`, and mirrors `status` onto the source commercial document's
   * own `settlementStatus` field where that exists (Sales/Purchase
   * Invoice). */
  async applyToOpenItem(tenantId: string, type: OpenItemType, openItemId: string, amount: Decimal, tx: PrismaTransactionClient) {
    if (type === 'SETTLEMENT_OBLIGATION') {
      const item = await tx.settlementObligation.findUniqueOrThrow({ where: { id: openItemId } });
      const newRemaining = new Decimal(item.remainingAmount?.toString() ?? item.amountDue.toString()).minus(amount);
      if (newRemaining.lt(SMALL_BALANCE_TOLERANCE.negated())) throw new ValidationAppError(`Open item ${openItemId} has insufficient remaining balance for this allocation`);
      const status = this.statusFor(newRemaining, item.amountDue);
      await tx.settlementObligation.update({ where: { id: openItemId }, data: { allocatedAmount: { increment: amount.toString() }, remainingAmount: newRemaining.lt(SMALL_BALANCE_TOLERANCE) && newRemaining.gt(SMALL_BALANCE_TOLERANCE.negated()) ? '0' : newRemaining.toString(), status } });
      await this.mirrorInvoiceStatus(tenantId, item.sourceDocumentType, item.sourceDocumentId, status, tx);
      return { newRemaining, status };
    }

    const item = await tx.supplierPayable.findUniqueOrThrow({ where: { id: openItemId } });
    const newRemaining = new Decimal(item.remainingAmount?.toString() ?? item.invoiceAmount.toString()).minus(amount);
    if (newRemaining.lt(SMALL_BALANCE_TOLERANCE.negated())) throw new ValidationAppError(`Open item ${openItemId} has insufficient remaining balance for this allocation`);
    const status = this.statusFor(newRemaining, item.invoiceAmount);
    await tx.supplierPayable.update({ where: { id: openItemId }, data: { paidAmount: { increment: amount.toString() }, remainingAmount: newRemaining.lt(SMALL_BALANCE_TOLERANCE) && newRemaining.gt(SMALL_BALANCE_TOLERANCE.negated()) ? '0' : newRemaining.toString(), status } });
    return { newRemaining, status };
  }

  /** Reverses a prior `applyToOpenItem` (allocation reversal, spec
   * section 33) — adds the amount back. */
  async unapplyFromOpenItem(tenantId: string, type: OpenItemType, openItemId: string, amount: Decimal, tx: PrismaTransactionClient) {
    if (type === 'SETTLEMENT_OBLIGATION') {
      const item = await tx.settlementObligation.findUniqueOrThrow({ where: { id: openItemId } });
      const newRemaining = new Decimal(item.remainingAmount?.toString() ?? '0').plus(amount);
      const status = this.statusFor(newRemaining, item.amountDue);
      await tx.settlementObligation.update({ where: { id: openItemId }, data: { allocatedAmount: { decrement: amount.toString() }, remainingAmount: newRemaining.toString(), status } });
      await this.mirrorInvoiceStatus(tenantId, item.sourceDocumentType, item.sourceDocumentId, status, tx);
      return;
    }
    const item = await tx.supplierPayable.findUniqueOrThrow({ where: { id: openItemId } });
    const newRemaining = new Decimal(item.remainingAmount?.toString() ?? '0').plus(amount);
    const status = this.statusFor(newRemaining, item.invoiceAmount);
    await tx.supplierPayable.update({ where: { id: openItemId }, data: { paidAmount: { decrement: amount.toString() }, remainingAmount: newRemaining.toString(), status } });
  }

  private statusFor(remaining: Decimal, original: unknown): string {
    const orig = new Decimal(String(original));
    if (remaining.lte(SMALL_BALANCE_TOLERANCE)) return 'SETTLED';
    if (remaining.gte(orig.minus(SMALL_BALANCE_TOLERANCE))) return 'OPEN';
    return 'PARTIALLY_SETTLED';
  }

  private async mirrorInvoiceStatus(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, status: string, tx: PrismaTransactionClient) {
    const settlementStatus = status === 'SETTLED' ? 'PAID' : status === 'PARTIALLY_SETTLED' ? 'PARTIALLY_PAID' : 'UNPAID';
    if (sourceDocumentType === 'SALES_INVOICE') {
      await tx.salesInvoice.updateMany({ where: { tenantId, id: sourceDocumentId }, data: { settlementStatus } });
    }
  }

  /** OVERDUE is always computed live from due date + remaining amount
   * (spec section 7) — never a stored status. */
  isOverdue(dueDate: Date | null, remaining: Decimal, asOf: Date): boolean {
    return !!dueDate && remaining.gt(SMALL_BALANCE_TOLERANCE) && dueDate.getTime() < asOf.getTime();
  }

  async getReceivables(tenantId: string, organizationId: string, filters: { counterpartyId?: string; status?: string } = {}) {
    return this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, counterpartyId: filters.counterpartyId, status: filters.status ?? { notIn: ['CANCELLED'] } }, orderBy: { dueDate: 'asc' } });
  }

  async getPayables(tenantId: string, organizationId: string, filters: { counterpartyId?: string; status?: string } = {}) {
    return this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, counterpartyId: filters.counterpartyId, status: filters.status ?? { notIn: ['CANCELLED'] } }, orderBy: { dueDate: 'asc' } });
  }
}
