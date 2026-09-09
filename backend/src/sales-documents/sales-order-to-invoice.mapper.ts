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
 * CreateBasedOn engine. The engine contract is header-only (build target
 * input, create target, link — section 27/28), so this mapper copies the
 * order header (org, customer, currency, tax flag) into a freshly numbered
 * invoice draft; lines are then added via the invoice update endpoint before
 * posting (line copying with provenance is a later-phase concern, same
 * header-only scope as the FoundationTestDocument self mapper).
 *
 * Prices are never re-resolved here — the lines added later copy the order's
 * snapshot, so the invoice agrees with the order even if price lists changed
 * since.
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
    });
    if (!order) throw new ValidationAppError(`Sales order not found: ${source.id}`);

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
      description: `Based on order ${order.number ?? order.id}`,
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
