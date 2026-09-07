import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const FOUNDATION_TEST_DOCUMENT_TYPE = 'FOUNDATION_TEST_DOCUMENT';

/**
 * DocumentRepositoryAdapter for the Phase 0 demo/reference document
 * (section 58). This is the ONLY concrete implementation of the adapter in
 * Phase 0 — later phases add one of these per real document table, never
 * by editing DocumentPostingService.
 */
@Injectable()
export class FoundationTestDocumentRepository implements DocumentRepositoryAdapter {
  readonly documentType = FOUNDATION_TEST_DOCUMENT_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.foundationTestDocument.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    const result = await tx.foundationTestDocument.updateMany({
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
    const row = await tx.foundationTestDocument.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        currencyId: input.currencyId as string | undefined,
        amount: (input.amount as any) ?? 0,
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
