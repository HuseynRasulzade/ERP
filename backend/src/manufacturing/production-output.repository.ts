import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const PRODUCTION_OUTPUT_RECEIPT_TYPE = 'PRODUCTION_OUTPUT_RECEIPT';

@Injectable()
export class ProductionOutputRepository implements DocumentRepositoryAdapter {
  readonly documentType = PRODUCTION_OUTPUT_RECEIPT_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.productionOutputReceipt.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.productionOutputReceipt.updateMany({
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
    const row = await tx.productionOutputReceipt.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        productionOrderId: input.productionOrderId as string,
        outputId: input.outputId as string,
        outputKind: (input.outputKind as string) ?? 'FINISHED',
        warehouseId: input.warehouseId as string,
        batchId: input.batchId as string | undefined,
        goodQuantity: (input.goodQuantity as number).toString(),
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
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
      description: null,
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
