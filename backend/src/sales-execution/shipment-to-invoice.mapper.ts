import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { SHIPMENT_TYPE } from './shipment.repository';
import { SALES_INVOICE_TYPE } from '../sales-documents/sales-invoice.repository';

/**
 * SHIPMENT => SALES_INVOICE mapper (spec section 22). Copies each line's
 * price/tax by looking back to its `sourceOrderLineId` (the Sales Order
 * line the shipment itself was created from — see
 * SalesOrderToShipmentMapper) and prorating that order line's own
 * lineTotal/taxAmount down to the SHIPPED quantity, exactly the same
 * "freeze, don't re-resolve" convention SalesOrderToSalesInvoiceMapper
 * uses. A standalone shipment line (no `sourceOrderLineId` — created
 * directly, not from an order) has no price to look back to and no
 * `membershipId` is available here to run a real PriceListService
 * resolution (CreateBasedOnService.createBasedOn only carries
 * tenantId/userId) — that line is skipped, same documented limitation as
 * before, and if EVERY line lacks a source order line the invoice still
 * comes back with zero lines, same as the prior behavior.
 * `SalesInvoicePostingHandler.validateForPosting` still enforces "only
 * uninvoiced Shipment quantity is eligible" at post time.
 */
@Injectable()
export class ShipmentToSalesInvoiceMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = SHIPMENT_TYPE;
  readonly targetDocumentType = SALES_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const shipment = await client.shipment.findFirst({ where: { id: source.id, tenantId: source.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!shipment) throw new ValidationAppError(`Shipment not found: ${source.id}`);
    if (shipment.postingStatus !== 'POSTED') {
      throw new ValidationAppError('Only a posted shipment can be invoiced');
    }

    const lines: Array<Record<string, unknown>> = [];
    for (const line of shipment.lines) {
      if (!line.sourceOrderLineId) continue; // no frozen price to look back to — see class docstring
      const orderLine = await client.salesOrderLine.findFirst({ where: { id: line.sourceOrderLineId, tenantId: source.tenantId } });
      if (!orderLine || orderLine.quantity.lte(0)) continue;

      const proportion = line.quantity.div(orderLine.quantity);
      const lineTotal = orderLine.lineTotal.mul(proportion).toDecimalPlaces(2);
      const taxAmount = orderLine.taxAmount.mul(proportion).toDecimalPlaces(2);
      lines.push({
        sourceOrderLineId: orderLine.id,
        sourceShipmentLineId: line.id,
        productId: line.productId,
        unitId: line.unitId,
        quantity: line.quantity.toString(),
        price: orderLine.price.toString(),
        lineTotal: lineTotal.toString(),
        taxRate: orderLine.taxRate.toString(),
        taxAmount: taxAmount.toString(),
        lineTotalWithTax: lineTotal.plus(taxAmount).toString(),
        priceListId: orderLine.priceListId,
        productPriceId: orderLine.productPriceId,
        description: orderLine.description,
      });
    }

    const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const taxTotal = lines.reduce((s, l) => s + Number(l.taxAmount), 0);

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(source.tenantId, SALES_INVOICE_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: shipment.organizationId,
      counterpartyId: shipment.counterpartyId,
      number: allocated.formatted,
      documentDate: new Date(),
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: (subtotal + taxTotal).toFixed(2),
      sourceShipmentId: shipment.id,
      description: `Based on shipment ${shipment.number ?? shipment.id}`,
      lines,
    };
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SALES_INVOICE_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SALES_INVOICE_TYPE, documentType: SALES_INVOICE_TYPE, prefix: 'SI', padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}
