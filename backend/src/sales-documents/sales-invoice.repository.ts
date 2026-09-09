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
   * pre-allocated header fields the SALES_ORDER => SALES_INVOICE mapper
   * produces (number, documentDate, currency, tax flag, description) so the
   * engine's single create is the only write — no duplicate headers.
   * The draft starts with zero totals and no lines; lines are added via the
   * invoice update endpoint before posting.
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
        createdBy,
        updatedBy: createdBy,
      },
    });
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
