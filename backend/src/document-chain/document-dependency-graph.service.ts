import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError } from '../common/errors/app-error';

export interface DocumentNode {
  documentType: string;
  documentId: string;
}

export interface DocumentEdge extends DocumentNode {
  relationType: string;
  documentLinkId: string;
  direction: 'FORWARD' | 'BACKWARD';
}

/**
 * DocumentDependencyGraphService (docx spec Phase 27, sections 60-66).
 * Builds forward ("what was created from this document") and backward
 * ("what was this document created from") views directly over the
 * EXISTING `DocumentLink` table (docs/DOCUMENT_CHAIN.md section A/B) —
 * no separate graph-storage table. Structurally mirrors
 * `CloseDependencyGraphService` from Phase 22 (same "typed edges + cycle
 * detection over an existing relational table" shape), but this graph
 * is instance-level (documents), not type-level (close steps).
 */
@Injectable()
export class DocumentDependencyGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async forward(tenantId: string, documentType: string, documentId: string): Promise<DocumentEdge[]> {
    const links = await this.prisma.documentLink.findMany({ where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId, status: 'ACTIVE' } });
    return links.map((l) => ({ documentType: l.targetDocumentType, documentId: l.targetDocumentId, relationType: l.relationType, documentLinkId: l.id, direction: 'FORWARD' as const }));
  }

  async backward(tenantId: string, documentType: string, documentId: string): Promise<DocumentEdge[]> {
    const links = await this.prisma.documentLink.findMany({ where: { tenantId, targetDocumentType: documentType, targetDocumentId: documentId, status: 'ACTIVE' } });
    return links.map((l) => ({ documentType: l.sourceDocumentType, documentId: l.sourceDocumentId, relationType: l.relationType, documentLinkId: l.id, direction: 'BACKWARD' as const }));
  }

  /** Full transitive closure in one direction, with cycle guard (a
   * malformed data set with an accidental A->B->A chain must never hang
   * the traversal — same defensive posture as Phase 22's Kahn's-algorithm
   * cycle detection). */
  async transitiveClosure(tenantId: string, documentType: string, documentId: string, direction: 'FORWARD' | 'BACKWARD', maxDepth = 50): Promise<DocumentEdge[]> {
    const visited = new Set<string>([`${documentType}:${documentId}`]);
    const result: DocumentEdge[] = [];
    let frontier: DocumentNode[] = [{ documentType, documentId }];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: DocumentNode[] = [];
      for (const node of frontier) {
        const edges = direction === 'FORWARD' ? await this.forward(tenantId, node.documentType, node.documentId) : await this.backward(tenantId, node.documentType, node.documentId);
        for (const edge of edges) {
          const key = `${edge.documentType}:${edge.documentId}`;
          if (visited.has(key)) continue;
          visited.add(key);
          result.push(edge);
          nextFrontier.push({ documentType: edge.documentType, documentId: edge.documentId });
        }
      }
      frontier = nextFrontier;
    }
    return result;
  }

  /** Called before creating a new DocumentLink for a governed
   * transformation (spec section 66's own "prevent creating a document
   * chain cycle") — walks forward from the proposed target to see if it
   * would ever reach back to the proposed source. */
  async assertNoCycle(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, targetDocumentType: string, targetDocumentId: string) {
    if (sourceDocumentType === targetDocumentType && sourceDocumentId === targetDocumentId) {
      throw new ConflictAppError('A document cannot be linked to itself');
    }
    const downstreamOfTarget = await this.transitiveClosure(tenantId, targetDocumentType, targetDocumentId, 'FORWARD');
    if (downstreamOfTarget.some((n) => n.documentType === sourceDocumentType && n.documentId === sourceDocumentId)) {
      throw new ConflictAppError(`Linking ${sourceDocumentType}:${sourceDocumentId} -> ${targetDocumentType}:${targetDocumentId} would create a document chain cycle`);
    }
  }
}
