import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const GOODS_RECEIPT_TYPE = 'GOODS_RECEIPT';

/**
 * DocumentRepositoryAdapter for GoodsReceipt. `create()` is a real,
 * working implementation (unlike PurchaseOrderRepository's stub) because
 * GoodsReceipt IS created via the generic Create Based On engine
 * (SUPPLIER_ORDER => GOODS_RECEIPT, spec section 25) as well as via
 * GoodsReceiptService directly — both paths funnel through this one
 * method so a receipt is never persisted two different ways.
 */
@Injectable()
export class GoodsReceiptRepository implements DocumentRepositoryAdapter {
  readonly documentType = GOODS_RECEIPT_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.goodsReceipt.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.goodsReceipt.updateMany({
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

  async create(tenantId: string, input: Record<string, unknown>, createdBy: string, tx: PrismaTransactionClient): Promise<BaseDocumentFields> {
    const row = await tx.goodsReceipt.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        warehouseId: input.warehouseId as string,
        counterpartyId: input.counterpartyId as string,
        supplierOrderId: input.supplierOrderId as string | undefined,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        currencyId: input.currencyId as string | undefined,
        operationType: (input.operationType as string) ?? 'PURCHASE_FROM_SUPPLIER',
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.goodsReceiptLine.create({
          data: {
            tenantId,
            goodsReceiptId: row.id,
            position: index,
            productId: line.productId as string,
            unitId: line.unitId as string,
            quantity: line.quantity as any,
            price: (line.price as any) ?? 0,
            lineTotal: (line.lineTotal as any) ?? 0,
            warehouseId: line.warehouseId as string | undefined,
            supplierOrderLineId: line.supplierOrderLineId as string | undefined,
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
