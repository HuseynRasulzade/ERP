import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { INCOMING_BANK_PAYMENT_TYPE } from './incoming-bank-payment.repository';
import { PaymentAllocationService } from '../settlement/payment-allocation.service';
import { SettlementMovementService } from '../settlement/settlement-movement.service';
import { SALES_INVOICE_TYPE } from '../sales-documents/sales-invoice.repository';

/**
 * Posting handler for IncomingBankPayment (spec section 28) — the bank-side
 * counterpart of PaymentOrder for money received. Posting IS the bank
 * receipt event: Dr Bank / Cr AR (CUSTOMER_PAYMENT/CUSTOMER_ADVANCE) or a
 * P&L income account for every other category (LOAN_RECEIPT/
 * REFUND_FROM_SUPPLIER/INTEREST_INCOME/OTHER) — mirrors
 * CashTransactionPostingHandler's own category-driven contra-account
 * choice, just against a BankAccount instead of a Cashbox, and with no
 * legacy paidAmount field of its own to update (Sales Invoice's own
 * SettlementObligation.paidAmount IS updated, same as CashTransaction does
 * for CUSTOMER_PAYMENT today).
 */
@Injectable()
export class IncomingBankPaymentPostingHandler implements DocumentPostingHandler {
  readonly documentType = INCOMING_BANK_PAYMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly settlementAllocations: PaymentAllocationService,
    private readonly settlementMovements: SettlementMovementService,
  ) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const payment = await tx.incomingBankPayment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!payment)
      throw new ValidationAppError('Document disappeared during posting');
    if (payment.amount.lte(0))
      throw new ValidationAppError(
        'Cannot post an incoming bank payment with a non-positive amount',
      );

    const bankAccount = await tx.bankAccount.findFirst({
      where: { id: payment.bankAccountId, tenantId },
    });
    if (!bankAccount || !bankAccount.active)
      throw new ValidationAppError(
        'Cannot post against a missing or inactive bank account',
      );

    if (
      (payment.category === 'CUSTOMER_PAYMENT' ||
        payment.category === 'CUSTOMER_ADVANCE') &&
      !payment.counterpartyId
    ) {
      throw new ValidationAppError(
        `A ${payment.category} incoming bank payment requires a counterparty`,
      );
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const payment = await tx.incomingBankPayment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!payment)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return [
      {
        registerCode: 'BANK_CASH_MOVEMENT_REGISTER',
        businessDate,
        movementType: 'INCOMING_BANK_PAYMENT_LINE',
        dimensions: {
          organizationId: document.organizationId ?? null,
          bankAccountId: payment.bankAccountId,
          counterpartyId: payment.counterpartyId,
        },
        resources: {
          amount: payment.amount.toString(),
          currencyId: payment.currencyId,
          direction: 'INFLOW',
        },
      },
    ];
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const payment = await tx.incomingBankPayment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!payment)
      throw new ValidationAppError('Document disappeared during posting');
    const organizationId = payment.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(payment.amount.toString());

    let currencyId = payment.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
      });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId)
      throw new ValidationAppError(
        'Cannot post an incoming bank payment: no currency on the payment, organization, or tenant',
      );

    const bankAccount = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.BANK,
      businessDate,
      tx,
    );
    const contraKey =
      payment.category === 'CUSTOMER_PAYMENT' ||
      payment.category === 'CUSTOMER_ADVANCE'
        ? MappingKeys.CUSTOMER_RECEIVABLE
        : payment.category === 'INTEREST_INCOME'
          ? MappingKeys.BANK_INTEREST_INCOME
          : MappingKeys.OTHER_OPERATING_INCOME;
    const contraAccount = await this.mappings.resolve(
      tenantId,
      organizationId,
      contraKey,
      businessDate,
      tx,
    );

    const settlementDocumentId =
      payment.category === 'CUSTOMER_PAYMENT' ||
      payment.category === 'CUSTOMER_ADVANCE'
        ? (payment.sourceSalesInvoiceId ?? payment.id)
        : null;

    const bankDimensions = [
      { dimensionCode: 'BANK_ACCOUNT', referenceId: payment.bankAccountId },
      ...(currencyId
        ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }]
        : []),
    ];
    const contraDimensions = [
      ...(payment.counterpartyId
        ? [
            { dimensionCode: 'PARTNER', referenceId: payment.counterpartyId },
            {
              dimensionCode: 'COUNTERPARTY',
              referenceId: payment.counterpartyId,
            },
          ]
        : []),
      ...(settlementDocumentId
        ? [
            {
              dimensionCode: 'SETTLEMENT_DOCUMENT',
              referenceId: settlementDocumentId,
            },
          ]
        : []),
      ...(currencyId
        ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }]
        : []),
    ];

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: bankAccount.id,
        side: 'DEBIT',
        amountBase: amount,
        description: `Incoming bank payment ${payment.number ?? payment.id} — bank receipt`,
        dimensions: bankDimensions,
      },
      {
        accountId: contraAccount.id,
        side: 'CREDIT',
        amountBase: amount,
        description: `Incoming bank payment ${payment.number ?? payment.id} — ${payment.category.toLowerCase()}`,
        dimensions: contraDimensions,
      },
    ];

    if (
      (payment.category === 'CUSTOMER_PAYMENT' ||
        payment.category === 'CUSTOMER_ADVANCE') &&
      payment.sourceSalesInvoiceId
    ) {
      await this.applyToSettlementObligation(
        tenantId,
        payment.sourceSalesInvoiceId,
        amount,
        tx,
      );
    }

    // Settlement Subledger (docx spec Phase 13) — additive, same hook
    // CashTransaction/PaymentOrder use: a named invoice allocates against
    // its own open item(s); unnamed becomes a customer advance.
    if (
      currencyId &&
      (payment.category === 'CUSTOMER_PAYMENT' ||
        payment.category === 'CUSTOMER_ADVANCE') &&
      payment.counterpartyId
    ) {
      if (payment.sourceSalesInvoiceId) {
        await this.settlementAllocations.allocateToDocument(
          tenantId,
          {
            organizationId,
            counterpartyId: payment.counterpartyId,
            role: 'CUSTOMER',
            paymentDocumentType: INCOMING_BANK_PAYMENT_TYPE,
            paymentDocumentId: payment.id,
            paymentCurrencyId: currencyId,
            paymentDate: businessDate,
            paymentAmount: amount,
            targetSourceDocumentType: SALES_INVOICE_TYPE,
            targetSourceDocumentId: payment.sourceSalesInvoiceId,
            createdBy: document.postedBy ?? document.createdBy ?? undefined,
          },
          tx,
        );
      } else {
        await this.settlementMovements.createAdvance(
          tenantId,
          {
            organizationId,
            counterpartyId: payment.counterpartyId,
            role: 'CUSTOMER',
            sourceDocumentType: INCOMING_BANK_PAYMENT_TYPE,
            sourceDocumentId: payment.id,
            effectiveDate: businessDate,
            currencyId,
            amount,
            baseAmount: amount,
            createdBy: document.postedBy ?? document.createdBy ?? undefined,
          },
          tx,
        );
      }
    }

    return {
      description: `Incoming bank payment ${payment.number ?? payment.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }

  /** Symmetric undo for unpost — mirrors CashTransactionPostingHandler's
   * own undoSideEffects. */
  async undoSideEffects(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const payment = await tx.incomingBankPayment.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!payment) return;
    const amount = new Decimal(payment.amount.toString());

    if (
      (payment.category === 'CUSTOMER_PAYMENT' ||
        payment.category === 'CUSTOMER_ADVANCE') &&
      payment.sourceSalesInvoiceId
    ) {
      await this.applyToSettlementObligation(
        tenantId,
        payment.sourceSalesInvoiceId,
        amount.neg(),
        tx,
      );
    }

    await this.settlementAllocations.reverseForPaymentDocument(
      tenantId,
      payment.organizationId,
      INCOMING_BANK_PAYMENT_TYPE,
      payment.id,
      document.postedBy ?? document.createdBy ?? undefined,
      tx,
    );
  }

  private async applyToSettlementObligation(
    tenantId: string,
    salesInvoiceId: string,
    delta: Decimal,
    tx: PrismaTransactionClient,
  ) {
    const obligation = await tx.settlementObligation.findFirst({
      where: {
        tenantId,
        sourceDocumentType: 'SALES_INVOICE',
        sourceDocumentId: salesInvoiceId,
      },
    });
    if (!obligation) return;
    const newPaid = new Decimal(obligation.paidAmount.toString()).plus(delta);
    const fullyPaid = newPaid.gte(new Decimal(obligation.amountDue.toString()));
    await tx.settlementObligation.update({
      where: { id: obligation.id },
      data: { paidAmount: newPaid, status: fullyPaid ? 'PAID' : 'NOT_PAID' },
    });
    await tx.salesInvoice.updateMany({
      where: { id: salesInvoiceId, tenantId },
      data: {
        settlementStatus: fullyPaid
          ? 'PAID'
          : newPaid.gt(0)
            ? 'PARTIALLY_PAID'
            : 'UNPAID',
      },
    });
  }
}
