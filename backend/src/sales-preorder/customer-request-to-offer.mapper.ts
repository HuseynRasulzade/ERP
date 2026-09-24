import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { CUSTOMER_REQUEST_TYPE } from './customer-request.repository';
import { COMMERCIAL_OFFER_TYPE } from './commercial-offer.repository';
import { PriceListService } from '../counterparty-pricing/price-list.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * CUSTOMER_REQUEST => COMMERCIAL_OFFER mapper (spec section 31). Request
 * lines carry no authoritative price (spec section 4), so — unlike every
 * other mapper here, which freezes and copies a price forward — this one
 * runs the SAME real price-list + Tax Preview resolution
 * CommercialOfferService.resolveLines does for a manually-created offer.
 * A request line's own `requestedPrice` (what the customer mentioned) is
 * used only as a fallback when no SALE price list entry exists — never
 * silently dropped, never treated as authoritative over a real price list.
 * A line with neither is skipped (not fabricated); if every line is
 * skipped the offer comes back with zero lines, same as the old
 * header-only behavior, so this never regresses the previously-working
 * case.
 */
@Injectable()
export class CustomerRequestToCommercialOfferMapper
  implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>>
{
  readonly sourceDocumentType = CUSTOMER_REQUEST_TYPE;
  readonly targetDocumentType = COMMERCIAL_OFFER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly prices: PriceListService,
    private readonly taxCalculation: TaxCalculationService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown, membershipId?: string): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const request = await client.customerRequest.findFirst({
      where: { id: source.id, tenantId: source.tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!request) throw new ValidationAppError(`Customer request not found: ${source.id}`);
    if (request.status === 'CANCELLED') throw new ValidationAppError('Cannot create an offer from a cancelled request');

    const businessDate = new Date();
    const lines: Array<Record<string, unknown>> = [];
    for (const line of request.lines) {
      const quantity = new Decimal(line.quantity.toString());
      let price: Decimal | null = null;
      let priceListId: string | null = null;
      let productPriceId: string | null = null;

      if (membershipId) {
        const resolved = await this.prices.resolvePrice(
          source.tenantId, membershipId, request.organizationId, 'SALE', line.productId, businessDate, Number(line.quantity), request.counterpartyId,
        ).catch(() => null);
        if (resolved) {
          price = new Decimal(resolved.price.toString());
          priceListId = resolved.priceListId;
          productPriceId = resolved.id;
        }
      }
      if (!price && line.requestedPrice) {
        price = new Decimal(line.requestedPrice.toString());
      }
      if (!price) continue; // no price list entry and no customer-mentioned price — nothing honest to offer

      const base = price.mul(quantity);
      const taxResult = await this.taxCalculation.calculateLine(
        { tenantId: source.tenantId, organizationId: request.organizationId, businessDate, taxPointDate: businessDate, operationType: 'SALE', taxCategoryCode: DEFAULT_TAX_CATEGORY, taxpayerSide: 'SELLER' },
        { amount: base, priceIncludesTax: false },
        tx as PrismaTransactionClient | undefined,
      );

      lines.push({
        productId: line.productId,
        unitId: line.unitId,
        quantity: quantity.toString(),
        price: price.toString(),
        lineTotal: taxResult.taxableBase.toString(),
        taxRate: taxResult.rate.toString(),
        taxAmount: taxResult.taxAmount.toString(),
        lineTotalWithTax: taxResult.grossAmount.toString(),
        priceListId,
        productPriceId,
        description: line.notes,
      });
    }

    const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const taxTotal = lines.reduce((s, l) => s + Number(l.taxAmount), 0);

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(source.tenantId, COMMERCIAL_OFFER_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    await client.customerRequest.update({ where: { id: request.id }, data: { status: 'QUOTED' } });

    return {
      organizationId: request.organizationId,
      counterpartyId: request.counterpartyId,
      number: allocated.formatted,
      documentDate: new Date(),
      currencyId: request.currencyId,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: (subtotal + taxTotal).toFixed(2),
      sourceRequestId: request.id,
      description: `Based on request ${request.number ?? request.id}`,
      lines,
    };
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: COMMERCIAL_OFFER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: { tenantId, code: COMMERCIAL_OFFER_TYPE, documentType: COMMERCIAL_OFFER_TYPE, prefix: 'CO', padding: 6, resetPolicy: 'YEARLY' },
      });
    } catch {
      // Lost the race to create it concurrently.
    }
  }
}
