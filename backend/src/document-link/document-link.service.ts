import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

export type DocumentRelationType = 'CREATED_BASED_ON' | 'RELATED' | 'REVERSAL_OF' | 'CORRECTION_OF';

/**
 * Generic relationships between documents (section 26). Full "remaining
 * quantity / partial execution / chain visualization" semantics are Phase
 * 27 — Phase 0 only guarantees every link is created transactionally and
 * stays tenant-safe.
 */
@Injectable()
export class DocumentLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async createLink(
    tenantId: string,
    params: {
      sourceDocumentType: string;
      sourceDocumentId: string;
      targetDocumentType: string;
      targetDocumentId: string;
      relationType: DocumentRelationType | string;
      createdBy?: string;
      metadata?: unknown;
      // Phase 27 additions (docs/DOCUMENT_CHAIN.md section A) — optional,
      // so every pre-existing call site is untouched.
      transformationVersionId?: string;
      correlationId?: string;
    },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.documentLink.create({
      data: {
        tenantId,
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        targetDocumentType: params.targetDocumentType,
        targetDocumentId: params.targetDocumentId,
        relationType: params.relationType,
        createdBy: params.createdBy,
        metadata: params.metadata as any,
        transformationVersionId: params.transformationVersionId,
        correlationId: params.correlationId,
      },
    });
  }

  listForDocument(tenantId: string, documentType: string, documentId: string) {
    return this.prisma.documentLink.findMany({
      where: {
        tenantId,
        OR: [
          { sourceDocumentType: documentType, sourceDocumentId: documentId },
          { targetDocumentType: documentType, targetDocumentId: documentId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
