import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { DocumentRepositoryAdapter, DocumentStatusPatch } from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const INVENTORY_COST_ADJUSTMENT_TYPE = 'INVENTORY_COST_ADJUSTMENT';

@Injectable()
export class InventoryCostAdjustmentRepository implements DocumentRepositoryAdapter {
  readonly documentType = INVENTORY_COST_ADJUSTMENT_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.inventoryCostAdjustment.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(tenantId: string, id: string, patch: DocumentStatusPatch, expectedVersion: number, tx: PrismaTransactionClient) {
    const result = await tx.inventoryCostAdjustment.updateMany({
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

  async create(): Promise<BaseDocumentFields> {
    // Always created through InventoryCostAdjustmentService (manual entry)
    // or InventoryCostRecalculationService (system-generated) — not part
    // of any Create Based On chain.
    throw new Error('Use InventoryCostAdjustmentService.create()');
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
      description: row.comment,
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
