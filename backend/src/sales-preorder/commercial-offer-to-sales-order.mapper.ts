import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { OfferExpiredError, ValidationAppError } from '../common/errors/app-error';
import { COMMERCIAL_OFFER_TYPE } from './commercial-offer.repository';
import { SALES_ORDER_TYPE } from '../sales-documents/sales-order.repository';

/**
 * COMMERCIAL_OFFER => SALES_ORDER mapper (spec sections 13, 31-32, 76-79).
 * Unlike the header-only convention elsewhere, this mapper copies the
 * offer's LINES with their exact price/discount/tax snapshot — preserving
 * the offered commercial terms rather than silently re-resolving current
 * prices (spec section 77). An expired offer is rejected here by default;
 * `allowExpired` (checked via the `sales.offer.convert` + explicit query
 * flag at the controller) is where an authorized override would plug in —
 * not implemented in this build, see docs/SALES_PREORDER.md.
 */
@Injectable()
export class CommercialOfferToSalesOrderMapper
  implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>>
{
  readonly sourceDocumentType = COMMERCIAL_OFFER_TYPE;
  readonly targetDocumentType = SALES_ORDER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const offer = await client.commercialOffer.findFirst({
      where: { id: source.id, tenantId: source.tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!offer) throw new ValidationAppError(`Commercial offer not found: ${source.id}`);
    if (offer.status === 'CANCELLED' || offer.status === 'REJECTED') {
      throw new ValidationAppError(`Cannot create an order from a ${offer.status} offer`);
    }
    if (offer.status !== 'ACCEPTED') {
      throw new ValidationAppError('Only an ACCEPTED offer can be converted to a customer order');
    }
    if (offer.validUntil && offer.validUntil < new Date()) {
      throw new OfferExpiredError(offer.id);
    }
    if (offer.lines.length === 0) {
      throw new ValidationAppError('Cannot convert an offer with no lines');
    }

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(source.tenantId, SALES_ORDER_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    await client.commercialOffer.update({ where: { id: offer.id }, data: { status: 'CONVERTED' } });

    return {
      organizationId: offer.organizationId,
      counterpartyId: offer.counterpartyId,
      number: allocated.formatted,
      documentDate: new Date(),
      currencyId: offer.currencyId,
      priceIncludesTax: offer.priceIncludesTax,
      subtotal: offer.subtotal,
      taxTotal: offer.taxTotal,
      grandTotal: offer.grandTotal,
      sourceOfferId: offer.id,
      description: `Based on offer ${offer.number ?? offer.id}`,
      lines: offer.lines.map((l) => ({
        productId: l.productId,
        unitId: l.unitId,
        quantity: l.quantity,
        price: l.price,
        lineTotal: l.lineTotal,
        taxRate: l.taxRate,
        taxAmount: l.taxAmount,
        lineTotalWithTax: l.lineTotalWithTax,
        priceListId: l.priceListId,
        productPriceId: l.productPriceId,
        description: l.description,
      })),
    };
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SALES_ORDER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: SALES_ORDER_TYPE, documentType: SALES_ORDER_TYPE, prefix: 'SO', padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}
