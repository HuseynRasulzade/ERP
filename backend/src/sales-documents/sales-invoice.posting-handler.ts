import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { SALES_INVOICE_TYPE } from './sales-invoice.repository';

/**
 * Posting handler for SalesInvoice. Emits one SALES_SETTLEMENT_REGISTER
 * RECEIVABLE_ACCRUAL movement per line (customer owes us lineTotalWithTax).
 */
@Injectable()
export class SalesInvoicePostingHandler implements DocumentPostingHandler {
  readonly documentType = SALES_INVOICE_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: true },
    });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');
    if (invoice.lines.length === 0) throw new ValidationAppError('Cannot post a sales invoice with no lines');
    if (invoice.grandTotal.lte(0)) throw new ValidationAppError('Cannot post a sales invoice with non-positive total');
    for (const line of invoice.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a sales invoice with non-positive quantity');
      if (line.price.lt(0)) throw new ValidationAppError('Cannot post a sales invoice with negative price');
    }

    const counterparty = await tx.counterparty.findFirst({
      where: { id: invoice.counterpartyId, tenantId },
    });
    if (!counterparty || !counterparty.active) {
      throw new ValidationAppError('Cannot post a sales invoice for a missing or inactive counterparty');
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');

    return invoice.lines.map((line) => ({
      registerCode: 'SALES_SETTLEMENT_REGISTER',
      recorderLineId: line.id,
      businessDate: document.postingDate ?? document.documentDate,
      movementType: 'RECEIVABLE_ACCRUAL',
      dimensions: {
        organizationId: document.organizationId ?? null,
        counterpartyId: invoice.counterpartyId,
        productId: line.productId,
        unitId: line.unitId,
      },
      resources: {
        quantity: line.quantity.toString(),
        price: line.price.toString(),
        lineTotal: line.lineTotal.toString(),
        taxAmount: line.taxAmount.toString(),
        lineTotalWithTax: line.lineTotalWithTax.toString(),
        currencyId: invoice.currencyId,
      },
    }));
  }
}
