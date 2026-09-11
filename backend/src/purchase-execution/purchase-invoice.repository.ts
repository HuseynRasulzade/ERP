import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const PURCHASE_INVOICE_TYPE = 'PURCHASE_INVOICE';

/**
 * DocumentRepositoryAdapter for PurchaseInvoice. Real `create()` — this
 * document is created both directly (PurchaseInvoiceService) and via
 * Create Based On (SUPPLIER_ORDER => PURCHASE_INVOICE, GOODS_RECEIPT =>
 * PURCHASE_INVOICE, spec section 25).
 */
@Injectable()
export class PurchaseInvoiceRepository implements DocumentRepositoryAdapter {
  readonly documentType = PURCHASE_INVOICE_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.purchaseInvoice.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.purchaseInvoice.updateMany({
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
    const row = await tx.purchaseInvoice.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        dueDate: input.dueDate as Date | undefined,
        currencyId: input.currencyId as string | undefined,
        supplierOrderId: input.supplierOrderId as string | undefined,
        goodsReceiptId: input.goodsReceiptId as string | undefined,
        subtotal: (input.subtotal as any) ?? 0,
        taxTotal: (input.taxTotal as any) ?? 0,
        grandTotal: (input.grandTotal as any) ?? 0,
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });

    const lines = input.lines as Array<Record<string, unknown>> | undefined;
    if (lines?.length) {
      for (const [index, line] of lines.entries()) {
        await tx.purchaseInvoiceLine.create({
          data: {
            tenantId,
            purchaseInvoiceId: row.id,
            position: index,
            lineType: (line.lineType as string) ?? 'INVENTORY',
            productId: line.productId as string | undefined,
            unitId: line.unitId as string | undefined,
            quantity: line.quantity as any,
            price: line.price as any,
            lineTotal: (line.lineTotal as any) ?? 0,
            taxRate: (line.taxRate as any) ?? 0,
            taxAmount: (line.taxAmount as any) ?? 0,
            lineTotalWithTax: (line.lineTotalWithTax as any) ?? 0,
            warehouseId: line.warehouseId as string | undefined,
            goodsReceiptLineId: line.goodsReceiptLineId as string | undefined,
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
