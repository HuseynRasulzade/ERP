import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const WAREHOUSE_TRANSFER_TYPE = 'WAREHOUSE_TRANSFER';

@Injectable()
export class WarehouseTransferRepository implements DocumentRepositoryAdapter {
  readonly documentType = WAREHOUSE_TRANSFER_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.warehouseTransfer.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.warehouseTransfer.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.postingStatus ? { postingStatus: patch.postingStatus } : {}),
        ...(patch.postedAt !== undefined ? { postedAt: patch.postedAt } : {}),
        ...(patch.postedBy !== undefined ? { postedBy: patch.postedBy } : {}),
        // Posting a transfer IS shipping it (spec convention: postingStatus
        // POSTED = shipped); unposting reverts transferStatus to DRAFT so
        // a re-post starts the two-step progression over cleanly.
        ...(patch.postingStatus === 'POSTED' ? { transferStatus: 'SHIPPED' } : {}),
        ...(patch.postingStatus === 'NOT_POSTED' ? { transferStatus: 'DRAFT' } : {}),
        version: { increment: 1 },
      },
    });
    return { updatedCount: result.count, newVersion: expectedVersion + 1 };
  }

  async create(tenantId: string, input: Record<string, unknown>, createdBy: string, tx: PrismaTransactionClient): Promise<BaseDocumentFields> {
    const row = await tx.warehouseTransfer.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        sourceWarehouseId: input.sourceWarehouseId as string,
        destinationWarehouseId: input.destinationWarehouseId as string,
        transferType: (input.transferType as string) ?? 'INSTANT',
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        description: input.description as string | undefined,
        createdBy,
        updatedBy: createdBy,
      },
    });
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
      currencyId: null,
      exchangeRate: null,
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
