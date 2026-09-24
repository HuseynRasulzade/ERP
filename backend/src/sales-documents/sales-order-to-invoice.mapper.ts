import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { SALES_ORDER_TYPE } from './sales-order.repository';
import { SALES_INVOICE_TYPE } from './sales-invoice.repository';

/**
 * Phase 4 — SALES_ORDER => SALES_INVOICE mapper for the generic
 * CreateBasedOn engine. Copies each order line's own resolved price/tax
 * snapshot straight across (never re-resolved — the invoice agrees with
 * the order even if price lists changed since), mirroring
 * CommercialOfferToSalesOrderMapper's own line-copy convention. Cancelled
 * quantity is excluded; a fully-invoiced-elsewhere line is still copied
 * at face value — SalesInvoicePostingHandler.validateForPosting is what
 * actually enforces "no more than the order's remaining invoiceable
 * quantity" at post time, same guard as every other mapper here leaves
 * to its target's own posting handler.
 */
@Injectable()
export class SalesOrderToSalesInvoiceMapper
  implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>>
{
  readonly sourceDocumentType = SALES_ORDER_TYPE;
  readonly targetDocumentType = SALES_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async mapHeader(
    source: BaseDocumentFields,
    tx?: unknown,
  ): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const order = await client.salesOrder.findFirst({
      where: { id: source.id, tenantId: source.tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!order) throw new ValidationAppError(`Sales order not found: ${source.id}`);

    const lines = order.lines
      .filter((line) => line.quantity.minus(line.cancelledQuantity).gt(0))
      .map((line) => {
        const remainingQty = line.quantity.minus(line.cancelledQuantity);
        // Cancelled quantity means lineTotal/taxAmount (computed for the
        // full original quantity) must be prorated down to what's actually
        // being invoiced — the unit price/tax RATE stay exact, only the
        // totals shrink.
        const proportion = remainingQty.div(line.quantity);
        const lineTotal = line.lineTotal.mul(proportion).toDecimalPlaces(2);
        const taxAmount = line.taxAmount.mul(proportion).toDecimalPlaces(2);
        return {
          sourceOrderLineId: line.id,
          productId: line.productId,
          unitId: line.unitId,
          quantity: remainingQty.toString(),
          price: line.price.toString(),
          lineTotal: lineTotal.toString(),
          taxRate: line.taxRate.toString(),
          taxAmount: taxAmount.toString(),
          lineTotalWithTax: lineTotal.plus(taxAmount).toString(),
          priceListId: line.priceListId,
          productPriceId: line.productPriceId,
          description: line.description,
        };
      });
    if (lines.length === 0) throw new ValidationAppError('This order has no non-cancelled lines to invoice');

    // Computed from the copied lines, not `order.subtotal/taxTotal` — those
    // reflect the order's ORIGINAL (pre-cancellation) totals, which would
    // disagree with an invoice that excludes cancelled-quantity lines.
    const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const taxTotal = lines.reduce((s, l) => s + Number(l.taxAmount), 0);

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(
      source.tenantId,
      SALES_INVOICE_TYPE,
      new Date(),
      tx as PrismaTransactionClient | undefined,
    );

    return {
      organizationId: order.organizationId,
      counterpartyId: order.counterpartyId,
      number: allocated.formatted,
      documentDate: new Date(),
      currencyId: order.currencyId,
      priceIncludesTax: order.priceIncludesTax,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: (subtotal + taxTotal).toFixed(2),
      description: `Based on order ${order.number ?? order.id}`,
      lines,
    };
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: SALES_INVOICE_TYPE } },
    });
    if (existing) return;

    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: SALES_INVOICE_TYPE,
          documentType: SALES_INVOICE_TYPE,
          prefix: 'SI',
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
