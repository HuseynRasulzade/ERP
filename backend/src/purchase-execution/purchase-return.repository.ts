import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const PURCHASE_RETURN_TYPE = 'PURCHASE_RETURN';

@Injectable()
export class PurchaseReturnRepository implements DocumentRepositoryAdapter {
  readonly documentType = PURCHASE_RETURN_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.purchaseReturn.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.purchaseReturn.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.postingStatus ? { postingStatus: patch.postingStatus } : {}),
        ...(patch.postedAt !== undefined ? { postedAt: patch.postedAt } : {}),
        ...(patch.postedBy !== undefined ? { postedBy: patch.postedBy } : {}),
        version: { increment: 1 },
      },
    });
    return { updatedCount: result.count, newVersion: expectedVersion + 1 };
  }

  async create(tenantId: string, input: Record<string, unknown>, createdBy: string, tx: PrismaTransactionClient): Promise<BaseDocumentFields> {
    const row = await tx.purchaseReturn.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        originalGoodsReceiptId: input.originalGoodsReceiptId as string | undefined,
        originalPurchaseInvoiceId: input.originalPurchaseInvoiceId as string | undefined,
        warehouseId: input.warehouseId as string | undefined,
        currencyId: input.currencyId as string | undefined,
        returnReason: input.returnReason as string | undefined,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.purchaseReturnLine.create({
          data: {
            tenantId,
            purchaseReturnId: row.id,
            position: index,
            sourceReceiptLineId: line.sourceReceiptLineId as string | undefined,
            sourceInvoiceLineId: line.sourceInvoiceLineId as string | undefined,
            productId: line.productId as string,
            unitId: line.unitId as string,
            quantity: line.quantity as any,
            originalUnitPrice: line.originalUnitPrice as any,
            reason: line.reason as string | undefined,
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
      exchangeRate: null,
      description: row.description,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      postedAt: row.postedAt,
      postedBy: row.postedBy,
      cancelledAt: null,
      cancelledBy: null,
      deletionMark: false,
      version: row.version,
    };
  }
}
