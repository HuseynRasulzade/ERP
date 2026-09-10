import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { CreditCheckBlockedError, OrderOnHoldError, ValidationAppError } from '../common/errors/app-error';
import { SALES_ORDER_TYPE } from './sales-order.repository';
import { CreditCheckService } from '../sales-preorder/credit-check.service';

/**
 * Posting handler for SalesOrder. `post` IS `ConfirmCustomerOrder` (docx
 * spec Phase 6, section 22): SalesOrder plays this spec's CustomerOrder
 * role (see docs/SALES_PREORDER.md), and the generic document-framework
 * post command is reused rather than inventing a parallel confirmation
 * state machine — `postingStatus = POSTED` IS `CONFIRMED`.
 *
 * `validateForPosting` therefore carries the confirmation checks section
 * 22 requires: active counterparty, no blocking hold, and a credit check
 * that rejects a BLOCKED order outright (a WARNING is recorded but does
 * not block, matching spec section 57's WARN policy). Still emits one
 * SALES_ORDER_REGISTER movement per line — prices are never re-resolved
 * here, and per spec section 102, still no accounting/tax consequence.
 */
@Injectable()
export class SalesOrderPostingHandler implements DocumentPostingHandler {
  readonly documentType = SALES_ORDER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditCheck: CreditCheckService,
  ) {}

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

    const activeHolds = await tx.orderHold.findMany({ where: { tenantId, salesOrderId: order.id, status: 'ACTIVE' } });
    if (activeHolds.length > 0) {
      throw new OrderOnHoldError(activeHolds.map((h) => h.holdType));
    }

    const creditResult = await this.creditCheck.check(tenantId, order.organizationId, order.counterpartyId, new Decimal(order.grandTotal.toString()));
    await tx.salesOrder.update({ where: { id: order.id }, data: { creditStatus: creditResult.status } });
    if (creditResult.actionPolicy === 'BLOCK') {
      throw new CreditCheckBlockedError(creditResult.explanation);
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
