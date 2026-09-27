import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CASH_TRANSACTION_TYPE } from './cash-transaction.repository';
import { PaymentAllocationService } from '../settlement/payment-allocation.service';
import { SettlementMovementService } from '../settlement/settlement-movement.service';
import { SALES_INVOICE_TYPE } from '../sales-documents/sales-invoice.repository';
import { PURCHASE_INVOICE_TYPE } from '../purchase-execution/purchase-invoice.repository';

/**
 * Posting handler for CashTransaction (Kassa mədaxil/məxaric). Posting IS
 * the cash movement event — Dr Cash / Cr contra-account for a RECEIPT,
 * Dr contra-account / Cr Cash for a PAYMENT. The contra-account depends on
 * `category`: a CUSTOMER_PAYMENT/SUPPLIER_PAYMENT clears the counterparty's
 * AR/AP leg (same MappingKeys PaymentOrder uses for the bank side), while
 * OTHER_INCOME/OTHER_EXPENSE post straight to the P&L "other operating"
 * accounts — no reconciliation/approval workflow, unlike PaymentOrder.
 *
 * When `sourceSalesInvoiceId`/`sourcePurchaseInvoiceId` names a specific
 * invoice, posting also increments that invoice's SettlementObligation/
 * SupplierPayable `paidAmount` and flips it to PAID once fully covered —
 * the exact mirror of PaymentOrderPostingHandler's own SupplierPayable
 * clearing, just on the cash side and (new) also for AR. Left unset, the
 * payment still posts to the AR/AP GL account but settles against itself
 * (an unapplied/advance receipt or payment) — no fabricated invoice link.
 */
@Injectable()
export class CashTransactionPostingHandler implements DocumentPostingHandler {
  readonly documentType = CASH_TRANSACTION_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly settlementAllocations: PaymentAllocationService,
    private readonly settlementMovements: SettlementMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const txn = await tx.cashTransaction.findFirst({ where: { id: document.id, tenantId } });
    if (!txn) throw new ValidationAppError('Document disappeared during posting');
    if (txn.amount.lte(0)) throw new ValidationAppError('Cannot post a cash transaction with a non-positive amount');

    const cashbox = await tx.cashbox.findFirst({ where: { id: txn.cashboxId, tenantId } });
    if (!cashbox || !cashbox.active) throw new ValidationAppError('Cannot post a cash transaction against a missing or inactive cashbox');

    if ((txn.category === 'CUSTOMER_PAYMENT' || txn.category === 'SUPPLIER_PAYMENT') && !txn.counterpartyId) {
      throw new ValidationAppError(`A ${txn.category} cash transaction requires a counterparty`);
    }
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const txn = await tx.cashTransaction.findFirst({ where: { id: document.id, tenantId } });
    if (!txn) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return [
      {
        registerCode: 'CASH_TRANSACTION_REGISTER',
        businessDate,
        movementType: 'CASH_TRANSACTION_LINE',
        dimensions: { organizationId: document.organizationId ?? null, cashboxId: txn.cashboxId, counterpartyId: txn.counterpartyId },
        resources: { amount: txn.amount.toString(), currencyId: txn.currencyId, direction: txn.direction },
      },
    ];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const txn = await tx.cashTransaction.findFirst({ where: { id: document.id, tenantId } });
    if (!txn) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = txn.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(txn.amount.toString());

    let currencyId = txn.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) throw new ValidationAppError('Cannot post a cash transaction: no currency on the transaction, organization, or tenant');

    const cashAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.CASH, businessDate, tx);
    const contraKey =
      txn.category === 'CUSTOMER_PAYMENT'
        ? MappingKeys.CUSTOMER_RECEIVABLE
        : txn.category === 'SUPPLIER_PAYMENT'
          ? MappingKeys.SUPPLIER_PAYABLE
          : txn.direction === 'RECEIPT'
            ? MappingKeys.OTHER_OPERATING_INCOME
            : MappingKeys.OTHER_OPERATING_EXPENSE;
    const contraAccount = await this.mappings.resolve(tenantId, organizationId, contraKey, businessDate, tx);

    // AR/AP accounts require a settlement document (see PaymentOrder's own
    // contra leg): the linked invoice when one was named, otherwise the
    // transaction settles against itself (unapplied/advance).
    const settlementDocumentId = txn.category === 'CUSTOMER_PAYMENT' ? (txn.sourceSalesInvoiceId ?? txn.id) : txn.category === 'SUPPLIER_PAYMENT' ? (txn.sourcePurchaseInvoiceId ?? txn.id) : null;

    const cashDimensions = [{ dimensionCode: 'CASHBOX', referenceId: txn.cashboxId }, ...(currencyId ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }] : [])];
    const contraDimensions = [
      ...(txn.counterpartyId ? [{ dimensionCode: 'PARTNER', referenceId: txn.counterpartyId }, { dimensionCode: 'COUNTERPARTY', referenceId: txn.counterpartyId }] : []),
      ...(settlementDocumentId ? [{ dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: settlementDocumentId }] : []),
      ...(currencyId ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }] : []),
    ];

    const lines: AccountingPostingLineInput[] =
      txn.direction === 'RECEIPT'
        ? [
            { accountId: cashAccount.id, side: 'DEBIT', amountBase: amount, description: `Cash transaction ${txn.number ?? txn.id} — cash receipt`, dimensions: cashDimensions },
            { accountId: contraAccount.id, side: 'CREDIT', amountBase: amount, description: `Cash transaction ${txn.number ?? txn.id} — ${txn.category.toLowerCase()}`, dimensions: contraDimensions },
          ]
        : [
            { accountId: contraAccount.id, side: 'DEBIT', amountBase: amount, description: `Cash transaction ${txn.number ?? txn.id} — ${txn.category.toLowerCase()}`, dimensions: contraDimensions },
            { accountId: cashAccount.id, side: 'CREDIT', amountBase: amount, description: `Cash transaction ${txn.number ?? txn.id} — cash payment`, dimensions: cashDimensions },
          ];

    if (txn.category === 'CUSTOMER_PAYMENT' && txn.sourceSalesInvoiceId) {
      await this.applyToSettlementObligation(tenantId, txn.sourceSalesInvoiceId, amount, tx);
    }
    if (txn.category === 'SUPPLIER_PAYMENT' && txn.sourcePurchaseInvoiceId) {
      await this.applyToSupplierPayable(tenantId, txn.sourcePurchaseInvoiceId, amount, tx);
    }

    // Settlement Subledger (docx spec Phase 13) — additive alongside the
    // legacy paidAmount update above. Named-invoice payments allocate
    // against that invoice's own open item(s); an unnamed payment becomes
    // a customer/supplier advance rather than being lost (spec section 22).
    if (currencyId && (txn.category === 'CUSTOMER_PAYMENT' || txn.category === 'SUPPLIER_PAYMENT') && txn.counterpartyId) {
      const role = txn.category === 'CUSTOMER_PAYMENT' ? 'CUSTOMER' : 'SUPPLIER';
      const targetInvoiceType = txn.category === 'CUSTOMER_PAYMENT' ? SALES_INVOICE_TYPE : PURCHASE_INVOICE_TYPE;
      const targetInvoiceId = txn.category === 'CUSTOMER_PAYMENT' ? txn.sourceSalesInvoiceId : txn.sourcePurchaseInvoiceId;
      if (targetInvoiceId) {
        await this.settlementAllocations.allocateToDocument(
          tenantId,
          { organizationId, counterpartyId: txn.counterpartyId, role, paymentDocumentType: CASH_TRANSACTION_TYPE, paymentDocumentId: txn.id, paymentCurrencyId: currencyId, paymentDate: businessDate, paymentAmount: amount, targetSourceDocumentType: targetInvoiceType, targetSourceDocumentId: targetInvoiceId, createdBy: document.postedBy ?? document.createdBy ?? undefined },
          tx,
        );
      } else {
        await this.settlementMovements.createAdvance(
          tenantId,
          { organizationId, counterpartyId: txn.counterpartyId, role, sourceDocumentType: CASH_TRANSACTION_TYPE, sourceDocumentId: txn.id, effectiveDate: businessDate, currencyId, amount, baseAmount: amount, createdBy: document.postedBy ?? document.createdBy ?? undefined },
          tx,
        );
      }
    }

    return { description: `Cash transaction ${txn.number ?? txn.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  /** Symmetric undo for unpost — reverses the `paidAmount` this handler's
   * own `buildAccountingBatch` applied, so post→unpost→post never
   * double-counts a payment against the linked invoice. */
  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const txn = await tx.cashTransaction.findFirst({ where: { id: document.id, tenantId } });
    if (!txn) return;
    const amount = new Decimal(txn.amount.toString());

    if (txn.category === 'CUSTOMER_PAYMENT' && txn.sourceSalesInvoiceId) {
      await this.applyToSettlementObligation(tenantId, txn.sourceSalesInvoiceId, amount.neg(), tx);
    }
    if (txn.category === 'SUPPLIER_PAYMENT' && txn.sourcePurchaseInvoiceId) {
      await this.applyToSupplierPayable(tenantId, txn.sourcePurchaseInvoiceId, amount.neg(), tx);
    }

    await this.settlementAllocations.reverseForPaymentDocument(tenantId, txn.organizationId, CASH_TRANSACTION_TYPE, txn.id, document.postedBy ?? document.createdBy ?? undefined, tx);
  }

  private async applyToSettlementObligation(tenantId: string, salesInvoiceId: string, delta: Decimal, tx: PrismaTransactionClient) {
    const obligation = await tx.settlementObligation.findFirst({ where: { tenantId, sourceDocumentType: 'SALES_INVOICE', sourceDocumentId: salesInvoiceId } });
    if (!obligation) return;
    const newPaid = new Decimal(obligation.paidAmount.toString()).plus(delta);
    const fullyPaid = newPaid.gte(new Decimal(obligation.amountDue.toString()));
    await tx.settlementObligation.update({
      where: { id: obligation.id },
      data: { paidAmount: newPaid, status: fullyPaid ? 'PAID' : 'NOT_PAID' },
    });
    await tx.salesInvoice.updateMany({ where: { id: salesInvoiceId, tenantId }, data: { settlementStatus: fullyPaid ? 'PAID' : newPaid.gt(0) ? 'PARTIALLY_PAID' : 'UNPAID' } });
  }

  private async applyToSupplierPayable(tenantId: string, purchaseInvoiceId: string, delta: Decimal, tx: PrismaTransactionClient) {
    const payable = await tx.supplierPayable.findFirst({ where: { tenantId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: purchaseInvoiceId } });
    if (!payable) return;
    const newPaid = new Decimal(payable.paidAmount.toString()).plus(delta);
    const fullyPaid = newPaid.gte(new Decimal(payable.invoiceAmount.toString()));
    await tx.supplierPayable.update({
      where: { id: payable.id },
      data: { paidAmount: newPaid, status: fullyPaid ? 'PAID' : 'OPEN' },
    });
  }
}
