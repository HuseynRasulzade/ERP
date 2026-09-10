import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { CUSTOMER_REQUEST_TYPE } from './customer-request.repository';
import { COMMERCIAL_OFFER_TYPE } from './commercial-offer.repository';

/**
 * CUSTOMER_REQUEST => COMMERCIAL_OFFER mapper (spec section 31). Header-
 * only, same convention as SalesOrderToSalesInvoiceMapper: request lines
 * carry no price (spec section 4), so there is nothing to preserve —
 * offer lines are added afterward through CommercialOfferService, which
 * runs real price resolution + Tax Preview.
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
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;

    const request = await client.customerRequest.findFirst({ where: { id: source.id, tenantId: source.tenantId } });
    if (!request) throw new ValidationAppError(`Customer request not found: ${source.id}`);
    if (request.status === 'CANCELLED') throw new ValidationAppError('Cannot create an offer from a cancelled request');

    await this.ensureSequence(source.tenantId);
    const allocated = await this.numbering.allocateNumber(source.tenantId, COMMERCIAL_OFFER_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    await client.customerRequest.update({ where: { id: request.id }, data: { status: 'QUOTED' } });

    return {
      organizationId: request.organizationId,
      counterpartyId: request.counterpartyId,
      number: allocated.formatted,
      documentDate: new Date(),
      currencyId: request.currencyId,
      sourceRequestId: request.id,
      description: `Based on request ${request.number ?? request.id}`,
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
