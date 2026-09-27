import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { RequestContextService } from '../common/context/request-context.service';
import { PAYMENT_ORDER_TYPE } from './payment-order.repository';
import { PaymentAllocationService } from '../settlement/payment-allocation.service';
import { SettlementMovementService } from '../settlement/settlement-movement.service';
import { PURCHASE_INVOICE_TYPE } from '../purchase-execution/purchase-invoice.repository';

/**
 * Posting handler for PaymentOrder. Posting IS the "Bank Ödənişi" event —
 * Dr Accounts Payable (SUPPLIER_PAYABLE) / Cr Bank (BANK), and reduces the
 * linked SupplierPayable's paidAmount (marking it PAID once fully
 * covered). Segregation of duties (spec: "ödəniş icraçısı və
 * təsdiqləyicisi eyni şəxs olmamalıdır") is enforced here — the user
 * posting (executing) the payment must differ from whoever approved its
 * FINANCE approval step.
 */
@Injectable()
export class PaymentOrderPostingHandler implements DocumentPostingHandler {
  readonly documentType = PAYMENT_ORDER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly requestContext: RequestContextService,
    private readonly settlementAllocations: PaymentAllocationService,
    private readonly settlementMovements: SettlementMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const order = await tx.paymentOrder.findFirst({ where: { id: document.id, tenantId } });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    if ((order as any).approvalStatus !== 'APPROVED') {
      throw new ValidationAppError('Cannot post a payment order until finance approval is complete');
    }
    if (order.amount.lte(0)) throw new ValidationAppError('Cannot post a payment order with a non-positive amount');

    const bankAccount = await tx.bankAccount.findFirst({ where: { id: order.bankAccountId, tenantId } });
    if (!bankAccount || !bankAccount.active) throw new ValidationAppError('Cannot post a payment order against a missing or inactive bank account');

    // Bank-account-change control: re-checked here (not just at create
    // time) because the counterparty's account can be edited — and its
    // approval reopened to PENDING — any time between order creation and
    // posting (see counterparty.service.ts's SENSITIVE_BANK_ACCOUNT_FIELDS).
    if (order.counterpartyBankAccountId) {
      const counterpartyBankAccount = await tx.counterpartyBankAccount.findFirst({ where: { id: order.counterpartyBankAccountId, tenantId } });
      if (!counterpartyBankAccount || counterpartyBankAccount.status !== 'APPROVED') {
        throw new ValidationAppError('Cannot post a payment order against a counterparty bank account that is not APPROVED');
      }
    }

    // Segregation of duties: the executor (current user, posting now) must
    // not be the same person who gave FINANCE approval.
    const approvalStep = await tx.approvalStep.findFirst({
      where: { tenantId, documentType: PAYMENT_ORDER_TYPE, documentId: order.id, stepType: 'FINANCE', status: 'APPROVED' },
    });
    const executorId = this.requestContext.getUser()?.userId;
    if (approvalStep?.approvedBy && executorId && approvalStep.approvedBy === executorId) {
      throw new ValidationAppError('The payment executor cannot be the same person who approved it');
    }
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const order = await tx.paymentOrder.findFirst({ where: { id: document.id, tenantId } });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;

    return [
      {
        registerCode: 'PAYMENT_ORDER_REGISTER',
        businessDate,
        movementType: 'PAYMENT_ORDER_LINE',
        dimensions: { organizationId: document.organizationId ?? null, counterpartyId: order.counterpartyId, bankAccountId: order.bankAccountId },
        resources: { amount: order.amount.toString(), currencyId: order.currencyId },
      },
    ];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const order = await tx.paymentOrder.findFirst({ where: { id: document.id, tenantId } });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = order.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(order.amount.toString());

    // Reduce each named invoice's SupplierPayable. A splittable allocation
    // (PaymentAllocationService.set) takes priority when present — it lets
    // this one payment's amount be distributed across several invoices
    // (plus an unmatched-advance remainder, purchaseInvoiceId = null); with
    // no allocation rows, fall back to the original always-one-invoice
    // behavior (the PaymentRequest's own source invoice) for every payment
    // order that never used splitting.
    const request = await tx.paymentRequest.findFirst({ where: { id: order.paymentRequestId, tenantId } });
    const allocations = await tx.paymentAllocation.findMany({ where: { tenantId, paymentOrderId: order.id } });
    const invoiceAmounts: { purchaseInvoiceId: string; amount: Decimal }[] =
      allocations.length > 0
        ? allocations.filter((a) => a.purchaseInvoiceId).map((a) => ({ purchaseInvoiceId: a.purchaseInvoiceId as string, amount: new Decimal(a.amount.toString()) }))
        : request
          ? [{ purchaseInvoiceId: request.purchaseInvoiceId, amount }]
          : [];

    for (const { purchaseInvoiceId, amount: lineAmount } of invoiceAmounts) {
      const payable = await tx.supplierPayable.findFirst({ where: { tenantId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: purchaseInvoiceId } });
      if (payable) {
        const newPaid = new Decimal(payable.paidAmount.toString()).plus(lineAmount);
        const fullyPaid = newPaid.gte(new Decimal(payable.invoiceAmount.toString()));
        await tx.supplierPayable.update({
          where: { id: payable.id },
          data: { paidAmount: newPaid, status: fullyPaid ? 'PAID' : payable.status },
        });
      }
    }

    // Posting IS the "Bank Ödənişi" event — mark it executed.
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: { bankPaymentStatus: 'CLEARED', bankReference: order.bankReference ?? `AUTO-${order.number ?? order.id.slice(0, 8)}` },
    });

    const payableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, businessDate, tx);
    const bankAccountGl = await this.mappings.resolve(tenantId, organizationId, MappingKeys.BANK, businessDate, tx);

    let currencyId = order.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) throw new ValidationAppError('Cannot post a payment order: no currency on the order, organization, or tenant');

    // One debit line per invoice this payment settles (each keeping the
    // same SETTLEMENT_DOCUMENT the invoice's own AP credit line used —
    // purchase-invoice.posting-handler.ts), plus a bare line for any
    // unmatched-advance remainder (no SETTLEMENT_DOCUMENT), so a split
    // payment's GL entry mirrors its allocation 1:1 instead of collapsing
    // everything onto one invoice.
    const matchedTotal = invoiceAmounts.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
    const advanceAmount = amount.minus(matchedTotal);

    // Settlement Subledger (docx spec Phase 13) — additive alongside the
    // legacy SupplierPayable.paidAmount update above. Reuses this
    // handler's own already-computed per-invoice split (spec section 20:
    // "One payment → multiple invoices") instead of re-deriving it.
    for (const { purchaseInvoiceId, amount: lineAmount } of invoiceAmounts) {
      await this.settlementAllocations.allocateToDocument(
        tenantId,
        { organizationId, counterpartyId: order.counterpartyId, role: 'SUPPLIER', paymentDocumentType: PAYMENT_ORDER_TYPE, paymentDocumentId: order.id, paymentCurrencyId: currencyId, paymentDate: businessDate, paymentAmount: lineAmount, targetSourceDocumentType: PURCHASE_INVOICE_TYPE, targetSourceDocumentId: purchaseInvoiceId, createdBy: document.postedBy ?? document.createdBy ?? undefined },
        tx,
      );
    }
    if (advanceAmount.gt(0)) {
      await this.settlementMovements.createAdvance(
        tenantId,
        { organizationId, counterpartyId: order.counterpartyId, role: 'SUPPLIER', sourceDocumentType: PAYMENT_ORDER_TYPE, sourceDocumentId: order.id, effectiveDate: businessDate, currencyId, amount: advanceAmount, baseAmount: advanceAmount, createdBy: document.postedBy ?? document.createdBy ?? undefined },
        tx,
      );
    }
    const debitLines: AccountingPostingLineInput[] = invoiceAmounts.map(({ purchaseInvoiceId, amount: lineAmount }) => ({
      accountId: payableAccount.id,
      side: 'DEBIT',
      amountBase: lineAmount,
      description: `Payment order ${order.number ?? order.id} — supplier payable cleared`,
      dimensions: [
        { dimensionCode: 'PARTNER', referenceId: order.counterpartyId },
        { dimensionCode: 'COUNTERPARTY', referenceId: order.counterpartyId },
        { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: purchaseInvoiceId },
        ...(currencyId ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }] : []),
      ],
    }));
    if (advanceAmount.gt(0)) {
      debitLines.push({
        accountId: payableAccount.id,
        side: 'DEBIT',
        amountBase: advanceAmount,
        description: `Payment order ${order.number ?? order.id} — unmatched advance`,
        dimensions: [
          { dimensionCode: 'PARTNER', referenceId: order.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: order.counterpartyId },
          // Nothing else exists yet to reconcile an unmatched advance
          // against, so the settlement document IS the payment order
          // itself — satisfies the AP account's SETTLEMENT_DOCUMENT
          // requirement without inventing a separate advances account.
          { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: order.id },
          ...(currencyId ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }] : []),
        ],
      });
    }

    const lines: AccountingPostingLineInput[] = [
      ...debitLines,
      {
        accountId: bankAccountGl.id,
        side: 'CREDIT',
        amountBase: amount,
        description: `Payment order ${order.number ?? order.id} — bank outflow`,
        dimensions: [
          { dimensionCode: 'BANK_ACCOUNT', referenceId: order.bankAccountId },
          ...(currencyId ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }] : []),
        ],
      },
    ];

    return { description: `Payment order ${order.number ?? order.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }
}
