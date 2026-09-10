import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  DocumentRepositoryAdapter,
  DocumentStatusPatch,
} from '../document-framework/document-repository.interface';
import { BaseDocumentFields } from '../document-framework/base-document';

export const CUSTOMER_REQUEST_TYPE = 'CUSTOMER_REQUEST';

/**
 * DocumentRepositoryAdapter for CustomerRequest — registered ONLY so the
 * generic CreateBasedOn engine (Phase 0) can look it up as a source
 * document for CustomerRequest -> CommercialOffer (spec section 31). No
 * PostingHandler is ever registered for this type: CustomerRequest never
 * posts (spec section 102), so `/documents/CUSTOMER_REQUEST/{id}/post`
 * simply has no handler to find — not a supported operation, by design.
 */
@Injectable()
export class CustomerRequestRepository implements DocumentRepositoryAdapter {
  readonly documentType = CUSTOMER_REQUEST_TYPE;

  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string, tx?: PrismaTransactionClient): Promise<BaseDocumentFields | null> {
    const client = tx ?? this.prisma;
    const row = await client.customerRequest.findFirst({ where: { id, tenantId } });
    return row ? this.toBaseFields(row) : null;
  }

  async applyStatusPatch(
    tenantId: string,
    id: string,
    patch: DocumentStatusPatch,
    expectedVersion: number,
    tx: PrismaTransactionClient,
  ) {
    const result = await tx.customerRequest.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: {
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
    const row = await tx.customerRequest.create({
      data: {
        tenantId,
        organizationId: input.organizationId as string,
        counterpartyId: input.counterpartyId as string,
        number: input.number as string | undefined,
        documentDate: (input.documentDate as Date) ?? new Date(),
        currencyId: input.currencyId as string | undefined,
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
      postingDate: null,
      status: row.cancelledAt ? 'CANCELLED' : 'ACTIVE',
      postingStatus: 'NOT_POSTED',
      currencyId: row.currencyId,
      exchangeRate: undefined,
      description: row.description,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      postedAt: null,
      postedBy: null,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      deletionMark: false,
      version: row.version,
    };
  }
}
