import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { canonicalJson } from '../audit/audit-canonical-json.util';
import { RetrievedEvidenceItem } from './ai-retrieval.service';

/**
 * AIContextBuilderService (docx spec Phase 29, sections 14, 28-29).
 * Never dumps the whole ERP database into a prompt — a context snapshot
 * is exactly: the caller's OWN resolved permission scope (stored only
 * as a hash, spec section 29's "store references/hashes rather than
 * full sensitive content"), the evidence actually retrieved (already
 * permission-filtered by `AIRetrievalService` before it ever reaches
 * here), and the semantic/report/close version each evidence item was
 * read at (spec section 28 — reproducibility/audit).
 */
@Injectable()
export class AIContextBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    tenantId: string,
    organizationId: string | undefined,
    userPermissions: string[],
    evidence: RetrievedEvidenceItem[],
    options: { semanticModelVersion?: string; reportCloseVersion?: string } = {},
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const userScopeHash = createHash('sha256').update(canonicalJson([...userPermissions].sort())).digest('hex');
    return client.aIContextSnapshot.create({
      data: {
        tenantId,
        organizationId,
        userScopeHash,
        evidenceRefs: evidence.map((e) => ({ evidenceType: e.evidenceType, entityType: e.entityType, entityId: e.entityId, asOf: e.asOf?.toISOString(), versionTag: e.versionTag })) as unknown as object,
        semanticModelVersion: options.semanticModelVersion,
        reportCloseVersion: options.reportCloseVersion,
      },
    });
  }
}
