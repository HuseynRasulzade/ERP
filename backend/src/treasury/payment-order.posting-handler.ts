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

    // Reduce the linked invoice's SupplierPayable — never fabricate the
    // link; the PaymentRequest always names its source invoice.
    const request = await tx.paymentRequest.findFirst({ where: { id: order.paymentRequestId, tenantId } });
    if (request) {
      const payable = await tx.supplierPayable.findFirst({ where: { tenantId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: request.purchaseInvoiceId } });
      if (payable) {
        const newPaid = new Decimal(payable.paidAmount.toString()).plus(amount);
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

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: payableAccount.id,
        side: 'DEBIT',
        amountBase: amount,
        description: `Payment order ${order.number ?? order.id} — supplier payable cleared`,
        dimensions: [
          { dimensionCode: 'PARTNER', referenceId: order.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: order.counterpartyId },
          // Same settlement document the original invoice's own AP credit
          // line used (purchase-invoice.posting-handler.ts) — the payment
          // clears that same settlement, not a new one of its own.
          ...(request ? [{ dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: request.purchaseInvoiceId }] : []),
          ...(currencyId ? [{ dimensionCode: 'CURRENCY', referenceId: currencyId }] : []),
        ],
      },
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
