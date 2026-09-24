import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const SALES_INVOICE_TYPE = 'SALES_INVOICE';

@Injectable()
export class SalesInvoiceRepository implements DocumentRepositoryAdapter {
  readonly documentType = SALES_INVOICE_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.salesInvoice.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    const result = await tx.salesInvoice.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.postingStatus ? { postingStatus: patch.postingStatus } : {}),
        ...(patch.postedAt !== undefined ? { postedAt: patch.postedAt } : {}),
        ...(patch.postedBy !== undefined ? { postedBy: patch.postedBy } : {}),
        ...(patch.cancelledAt !== undefined ? { cancelledAt: patch.cancelledAt } : {}),
        ...(patch.cancelledBy !== undefined ? { cancelledBy: patch.cancelledBy } : {}),
        version: { increment: 1 },
      },
    });

    return { updatedCount: result.count, newVersion: expectedVersion + 1 };
  }

  /**
   * Materializes a target invoice for CreateBasedOnService. Accepts the
   * pre-allocated header fields the mapper produces (number, documentDate,
   * currency, tax flag, description) so the engine's single create is the
   * only write — no duplicate headers. When the mapper supplies `input.lines`
   * (SALES_ORDER => SALES_INVOICE and SHIPMENT => SALES_INVOICE both do,
   * carrying each line's own resolved price/tax snapshot — never
   * re-resolved here), they're inserted in the same transaction; a mapper
   * that omits `lines` still gets a draft with none, same as before.
   */
  async create(
    tenantId: string,
    input: Record<string, unknown>,
    createdBy: string,
    tx: PrismaTransactionClient,
  ): Promise<BaseDocumentFields> {
    const row = await tx.salesInvoice.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        number: input.number as string | undefined,
        documentDate: this.coerceDate(input.documentDate),
        currencyId: input.currencyId as string | undefined,
        subtotal: (input.subtotal as any) ?? 0,
        taxTotal: (input.taxTotal as any) ?? 0,
        grandTotal: (input.grandTotal as any) ?? 0,
        priceIncludesTax: (input.priceIncludesTax as boolean) ?? false,
        description: input.description as string | undefined,
        sourceShipmentId: input.sourceShipmentId as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.salesInvoiceLine.create({
          data: {
            tenantId,
            salesInvoiceId: row.id,
            position: index,
            productId: line.productId as string,
            unitId: line.unitId as string,
            quantity: line.quantity as any,
            price: line.price as any,
            lineTotal: line.lineTotal as any,
            taxRate: line.taxRate as any,
            taxAmount: line.taxAmount as any,
            lineTotalWithTax: line.lineTotalWithTax as any,
            priceListId: line.priceListId as string | undefined,
            productPriceId: line.productPriceId as string | undefined,
            sourceOrderLineId: line.sourceOrderLineId as string | undefined,
            sourceShipmentLineId: line.sourceShipmentLineId as string | undefined,
            description: line.description as string | undefined,
          },
        });
      }
    }

    return this.toBaseFields(row);
  }

  private coerceDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }

  private toBaseFields(row: any): BaseDocumentFields {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      documentType: row.documentType,
      number: row.number,
      documentDate: row.documentDate,
      postingDate: row.postingDate,
      status: row.status,
      postingStatus: row.postingStatus,
      currencyId: row.currencyId,
      exchangeRate: row.exchangeRate,
      description: row.description,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      postedAt: row.postedAt,
      postedBy: row.postedBy,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      deletionMark: row.deletionMark,
      version: row.version,
    };
  }
}
