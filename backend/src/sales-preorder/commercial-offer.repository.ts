import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const COMMERCIAL_OFFER_TYPE = 'COMMERCIAL_OFFER';

/**
 * DocumentRepositoryAdapter for CommercialOffer — registered so the
 * generic CreateBasedOn engine can use it as BOTH a target
 * (CustomerRequest -> CommercialOffer) and a source
 * (CommercialOffer -> SalesOrder). No PostingHandler: offers never post
 * (spec section 102).
 */
@Injectable()
export class CommercialOfferRepository implements DocumentRepositoryAdapter {
  readonly documentType = COMMERCIAL_OFFER_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.commercialOffer.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    const result = await tx.commercialOffer.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        ...(patch.cancelledAt !== undefined ? { cancelledAt: patch.cancelledAt } : {}),
        version: { increment: 1 },
      },
    });
    return { updatedCount: result.count, newVersion: expectedVersion + 1 };
  }

  async create(
    tenantId: string,
    input: Record<string, unknown>,
    createdBy: string,
    tx: PrismaTransactionClient,
  ): Promise<BaseDocumentFields> {
    const row = await tx.commercialOffer.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        validUntil: input.validUntil as Date | undefined,
        currencyId: input.currencyId as string | undefined,
        priceIncludesTax: (input.priceIncludesTax as boolean) ?? false,
        subtotal: (input.subtotal as any) ?? 0,
        taxTotal: (input.taxTotal as any) ?? 0,
        grandTotal: (input.grandTotal as any) ?? 0,
        sourceRequestId: input.sourceRequestId as string | undefined,
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    // CUSTOMER_REQUEST -> COMMERCIAL_OFFER carries resolved lines through
    // `input.lines` (see CustomerRequestToCommercialOfferMapper) — same
    // "materialize what the mapper already resolved" convention as
    // SalesOrderRepository.create().
    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.commercialOfferLine.create({
          data: {
            tenantId,
            commercialOfferId: row.id,
            position: index,
            productId: line.productId as string,
            unitId: line.unitId as string,
            quantity: line.quantity as any,
            price: line.price as any,
            discountPercent: line.discountPercent as any,
            discountAmount: line.discountAmount as any,
            lineTotal: line.lineTotal as any,
            taxRate: line.taxRate as any,
            taxAmount: line.taxAmount as any,
            lineTotalWithTax: line.lineTotalWithTax as any,
            priceListId: line.priceListId as string | undefined,
            productPriceId: line.productPriceId as string | undefined,
            description: line.description as string | undefined,
          },
        });
      }
    }

    return this.toBaseFields(row);
  }

  private toBaseFields(row: any): BaseDocumentFields {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      documentType: row.documentType,
      number: row.number,
      documentDate: row.documentDate,
      postingDate: null,
      status: row.cancelledAt ? 'CANCELLED' : 'ACTIVE',
      postingStatus: 'NOT_POSTED',
      currencyId: row.currencyId,
      exchangeRate: undefined,
      description: row.description,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      postedAt: null,
      postedBy: null,
      cancelledAt: row.cancelledAt,
      cancelledBy: null,
      deletionMark: false,
      version: row.version,
    };
  }
}
