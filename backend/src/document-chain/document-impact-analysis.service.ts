import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentDependencyGraphService, DocumentEdge } from './document-dependency-graph.service';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { ConflictAppError } from '../common/errors/app-error';

export interface ImpactedDocument extends DocumentEdge {
  posted: boolean;
  status: string | null;
}

export interface ImpactReport {
  documentType: string;
  documentId: string;
  impacted: ImpactedDocument[];
  hasPostedDownstream: boolean;
}

/**
 * DocumentImpactAnalysisService (docx spec Phase 27, sections 67-70).
 * Before a source document is edited/unposted/cancelled, this runs a
 * transitive downstream traversal (`DocumentDependencyGraphService`) and
 * reports every document that flowed from it — the default posture is
 * BLOCK + SHOW IMPACT (spec's own explicit "never silently cascade a
 * change through already-posted documents"): a caller must call
 * `assertSafeToModify` and get past it (or hold the override permission
 * and pass `allowPostedDownstream: true`) before proceeding.
 */
@Injectable()
export class DocumentImpactAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: DocumentDependencyGraphService,
    private readonly registry: DocumentFrameworkRegistry,
  ) {}

  async analyze(tenantId: string, documentType: string, documentId: string): Promise<ImpactReport> {
    const edges = await this.graph.transitiveClosure(tenantId, documentType, documentId, 'FORWARD');
    const impacted: ImpactedDocument[] = [];
    for (const edge of edges) {
      let posted = false;
      let status: string | null = null;
      try {
        const repository = this.registry.getRepository(edge.documentType);
        const doc = await repository.findById(tenantId, edge.documentId);
        posted = doc?.postingStatus === 'POSTED';
        status = doc?.status ?? null;
      } catch {
        // No repository registered for this document type (e.g. a
        // Phase-27-external system reference) — treated conservatively
        // as "posted unknown", never assumed safe.
        posted = false;
        status = null;
      }
      impacted.push({ ...edge, posted, status });
    }
    return { documentType, documentId, impacted, hasPostedDownstream: impacted.some((i) => i.posted) };
  }

  /** Throws unless the caller explicitly acknowledges posted downstream
   * impact (spec section 68 — override always requires an explicit,
   * auditable decision, never a default). */
  async assertSafeToModify(tenantId: string, documentType: string, documentId: string, allowPostedDownstream = false): Promise<ImpactReport> {
    const report = await this.analyze(tenantId, documentType, documentId);
    if (report.hasPostedDownstream && !allowPostedDownstream) {
      const postedDocs = report.impacted.filter((i) => i.posted).map((i) => `${i.documentType}:${i.documentId}`);
      throw new ConflictAppError(`Cannot modify ${documentType}:${documentId} — ${postedDocs.length} posted downstream document(s) depend on it: ${postedDocs.join(', ')}`);
    }
    return report;
  }
}
