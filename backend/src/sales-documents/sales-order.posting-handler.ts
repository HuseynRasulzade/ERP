import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { SALES_ORDER_TYPE } from './sales-order.repository';

/**
 * Posting handler for SalesOrder. Validates the order still has lines and an
 * active customer, then emits one SALES_ORDER_REGISTER movement per line.
 * Prices are never re-resolved here — lines carry the snapshot from save.
 */
@Injectable()
export class SalesOrderPostingHandler implements DocumentPostingHandler {
  readonly documentType = SALES_ORDER_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const order = await tx.salesOrder.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: true },
    });
    if (!order) throw new ValidationAppError('Document disappeared during posting');
    if (order.lines.length === 0) throw new ValidationAppError('Cannot post a sales order with no lines');
    for (const line of order.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a sales order with non-positive quantity');
      if (line.price.lt(0)) throw new ValidationAppError('Cannot post a sales order with negative price');
    }

    const counterparty = await tx.counterparty.findFirst({
      where: { id: order.counterpartyId, tenantId },
    });
    if (!counterparty || !counterparty.active) {
      throw new ValidationAppError('Cannot post a sales order for a missing or inactive counterparty');
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const order = await tx.salesOrder.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!order) throw new ValidationAppError('Document disappeared during posting');

    return order.lines.map((line) => ({
      registerCode: 'SALES_ORDER_REGISTER',
      recorderLineId: line.id,
      businessDate: document.postingDate ?? document.documentDate,
      movementType: 'SALES_ORDER_LINE',
      dimensions: {
        organizationId: document.organizationId ?? null,
        counterpartyId: order.counterpartyId,
        productId: line.productId,
        unitId: line.unitId,
      },
      resources: {
        quantity: line.quantity.toString(),
        price: line.price.toString(),
        lineTotal: line.lineTotal.toString(),
        taxAmount: line.taxAmount.toString(),
        lineTotalWithTax: line.lineTotalWithTax.toString(),
        currencyId: order.currencyId,
      },
    }));
  }
}
