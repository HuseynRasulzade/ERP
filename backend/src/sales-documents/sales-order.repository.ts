import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const SALES_ORDER_TYPE = 'SALES_ORDER';

/**
 * DocumentRepositoryAdapter for SalesOrder — the seam that plugs this
 * concrete table into the generic DocumentPostingService without that
 * engine ever knowing about sales (section 12 pattern).
 */
@Injectable()
export class SalesOrderRepository implements DocumentRepositoryAdapter {
  readonly documentType = SALES_ORDER_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.salesOrder.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    const result = await tx.salesOrder.updateMany({
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

  async create(
    tenantId: string,
    input: Record<string, unknown>,
    createdBy: string,
    tx: PrismaTransactionClient,
  ): Promise<BaseDocumentFields> {
    const row = await tx.salesOrder.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        currencyId: input.currencyId as string | undefined,
        subtotal: (input.subtotal as any) ?? 0,
        taxTotal: (input.taxTotal as any) ?? 0,
        grandTotal: (input.grandTotal as any) ?? 0,
        priceIncludesTax: (input.priceIncludesTax as boolean) ?? false,
        description: input.description as string | undefined,
        sourceOfferId: input.sourceOfferId as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    // Phase 6 addition: unlike the header-only SALES_ORDER -> SALES_INVOICE
    // mapper convention elsewhere in this module, COMMERCIAL_OFFER ->
    // SALES_ORDER carries its lines through `input.lines` so the offer's
    // exact price/discount/tax snapshot is preserved (spec sections 76-77)
    // rather than silently re-resolved from the current price list.
    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.salesOrderLine.create({
          data: {
            tenantId,
            salesOrderId: row.id,
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
