import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError, ValidationAppError } from '../common/errors/app-error';
import { canonicalJson } from '../audit/audit-canonical-json.util';
import { AuditService } from '../audit/audit.service';
import { DocumentFrameworkRegistry } from '../document-framework/document-framework-registry.service';
import { DocumentLinkService } from '../document-link/document-link.service';
import { DocumentTransformationDefinitionService } from './document-transformation-definition.service';
import { TransformationMappingService, HeaderMappingRule, LineMappingRule, MappingContext } from './transformation-mapping.service';
import { RemainingToCreateService } from './remaining-to-create.service';
import { TransformationExceptionService } from './transformation-exception.service';

export interface SourceLineSnapshot {
  sourceLineId: string;
  snapshot: Record<string, unknown>;
  sourceLineType: string;
  requestedQuantity?: Decimal;
}

export interface GenerateProposalInput {
  organizationId: string;
  sourceDocumentType: string;
  sourceDocumentIds: string[]; // one for a straight copy, many for a merge (spec section 10's own "one-to-many and many-to-one")
  sourceHeaderSnapshot: Record<string, unknown>;
  sourceLines: SourceLineSnapshot[];
  mappingContext?: MappingContext;
  asOfDate?: Date;
}

/**
 * DocumentCreationProposalService (docx spec Phase 27, sections 41-45,
 * 56). A proposal is explicitly NOT business truth (spec section 44) —
 * it previews what a "Create Based On" action WOULD produce, pinned to a
 * hash of the source snapshot at generation time so `accept()` can
 * detect the source changed underneath the proposal (spec section 45's
 * own staleness detection) before committing anything.
 *
 * Line enumeration is deliberately the CALLER's responsibility
 * (`sourceLines` is supplied, not re-derived here) — there is no single
 * generic "get the lines of any document type" contract across 30+
 * source modules, and building one would itself be the kind of
 * over-centralization the spec explicitly warns against (docs/
 * DOCUMENT_CHAIN.md section E, a disclosed simplification).
 */
@Injectable()
export class DocumentCreationProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: DocumentFrameworkRegistry,
    private readonly documentLinks: DocumentLinkService,
    private readonly transformations: DocumentTransformationDefinitionService,
    private readonly mapping: TransformationMappingService,
    private readonly remaining: RemainingToCreateService,
    private readonly exceptions: TransformationExceptionService,
  ) {}

  async generate(tenantId: string, userId: string, targetDocumentType: string, input: GenerateProposalInput) {
    if (input.sourceDocumentIds.length === 0) throw new ValidationAppError('At least one source document id is required');
    const asOfDate = input.asOfDate ?? new Date();

    const { definition, version } = await this.transformations.resolveActiveVersion(tenantId, input.sourceDocumentType, targetDocumentType, input.organizationId, asOfDate);

    const proposalLines: { sourceLineId: string; sourceLineType: string; eligible: Decimal; proposed: Decimal; warnings: string[] }[] = [];
    for (const line of input.sourceLines) {
      const primarySourceId = input.sourceDocumentIds[0];
      const breakdown = await this.remaining.computeRemaining(tenantId, input.sourceDocumentType, primarySourceId, line.sourceLineId, definition.code, version.consumptionMetric);
      const requested = line.requestedQuantity ?? breakdown.remaining;
      const warnings: string[] = [...breakdown.blockers];
      if (requested.gt(breakdown.remaining)) {
        warnings.push(`Requested ${requested.toFixed(6)} exceeds remaining ${breakdown.remaining.toFixed(6)}`);
      }
      proposalLines.push({ sourceLineId: line.sourceLineId, sourceLineType: line.sourceLineType, eligible: breakdown.remaining, proposed: Decimal.min(requested, breakdown.remaining), warnings });
    }

    const snapshotHash = createHash('sha256')
      .update(canonicalJson({ header: input.sourceHeaderSnapshot, lines: input.sourceLines.map((l) => ({ id: l.sourceLineId, snapshot: l.snapshot })) }))
      .digest('hex');

    return this.prisma.runInTransaction(async (tx) => {
      const proposal = await tx.documentCreationProposal.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          transformationVersionId: version.id,
          sourceDocumentType: input.sourceDocumentType,
          sourceDocumentIds: input.sourceDocumentIds as unknown as object,
          generatedBy: userId,
          sourceSnapshotHash: snapshotHash,
          status: 'GENERATED',
          expiresAt: version.claimTtlMinutes ? new Date(Date.now() + version.claimTtlMinutes * 60_000) : null,
        },
      });

      await tx.documentCreationProposalLine.createMany({
        data: proposalLines.map((l) => ({
          tenantId,
          proposalId: proposal.id,
          sourceDocumentType: input.sourceDocumentType,
          sourceDocumentId: input.sourceDocumentIds[0],
          sourceLineId: l.sourceLineId,
          eligibleQuantity: l.eligible.toString(),
          proposedQuantity: l.proposed.toString(),
          metric: version.consumptionMetric,
          warnings: l.warnings.length ? (l.warnings as unknown as object) : undefined,
        })),
      });

      await this.audit.record({ tenantId, organizationId: input.organizationId, eventType: 'DOC_CHAIN_PROPOSAL_GENERATED', eventCategory: 'DOCUMENT_CHAIN', entityType: 'DocumentCreationProposal', entityId: proposal.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { sourceDocumentType: input.sourceDocumentType, sourceDocumentIds: input.sourceDocumentIds, targetDocumentType } }, tx);

      return tx.documentCreationProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { lines: true } });
    });
  }

  async get(tenantId: string, proposalId: string) {
    const proposal = await this.prisma.documentCreationProposal.findFirst({ where: { id: proposalId, tenantId }, include: { lines: true, version: { include: { transformation: true } } } });
    if (!proposal) throw new NotFoundAppError('DocumentCreationProposal', proposalId);
    return proposal;
  }

  /** Re-validates the proposal is not stale (spec section 45), edits
   * user-adjustable line quantities are still within the CURRENT
   * remaining (re-checked at accept time, never trusted from
   * generation), builds the target header via `TransformationMappingService`,
   * materializes the target document through the SAME
   * `DocumentRepositoryAdapter.create` the pre-existing
   * `CreateBasedOnService` already uses (never a second creation path),
   * and records one `DocumentLink` (header) + one `DocumentLineLink`
   * (CONSUME) per accepted line, all inside one transaction. */
  async accept(
    tenantId: string,
    userId: string,
    proposalId: string,
    currentSourceHeaderSnapshot: Record<string, unknown>,
    currentSourceLines: { sourceLineId: string; snapshot: Record<string, unknown> }[],
    lineOverrides: Record<string, Decimal> = {},
    mappingContext: MappingContext = {},
  ) {
    const proposal = await this.get(tenantId, proposalId);
    if (proposal.status === 'ACCEPTED') throw new ConflictAppError(`Proposal ${proposalId} was already accepted`);
    if (proposal.status === 'EXPIRED' || proposal.status === 'CANCELLED') throw new ConflictAppError(`Proposal ${proposalId} is ${proposal.status}`);
    if (proposal.expiresAt && proposal.expiresAt < new Date()) {
      await this.prisma.documentCreationProposal.update({ where: { id: proposalId }, data: { status: 'EXPIRED' } });
      throw new ConflictAppError(`Proposal ${proposalId} has expired`);
    }

    const currentHash = createHash('sha256')
      .update(canonicalJson({ header: currentSourceHeaderSnapshot, lines: currentSourceLines.map((l) => ({ id: l.sourceLineId, snapshot: l.snapshot })) }))
      .digest('hex');
    if (currentHash !== proposal.sourceSnapshotHash) {
      await this.prisma.documentCreationProposal.update({ where: { id: proposalId }, data: { status: 'STALE' } });
      await this.exceptions.record(tenantId, { transformationCode: proposal.version.transformation.code, sourceDocumentType: proposal.sourceDocumentType, sourceDocumentId: (proposal.sourceDocumentIds as unknown as string[])[0], exceptionType: 'SOURCE_STALE', severity: 'BLOCKING', message: `Source changed since proposal ${proposalId} was generated — regenerate before accepting.` });
      throw new ConflictAppError(`Source document(s) changed since proposal ${proposalId} was generated. Regenerate the proposal.`);
    }

    const version = proposal.version;
    const definition = version.transformation;
    const sourceRepository = this.registry.getRepository(definition.sourceDocumentType);
    const targetRepository = this.registry.getRepository(definition.targetDocumentType);

    return this.prisma.runInTransaction(async (tx) => {
      const primarySourceId = (proposal.sourceDocumentIds as unknown as string[])[0];
      const source = await sourceRepository.findById(tenantId, primarySourceId, tx);
      if (!source) throw new NotFoundAppError(definition.sourceDocumentType, primarySourceId);

      const headerInput = this.mapping.applyHeaderMapping((version.headerMapping as unknown as HeaderMappingRule[]) ?? [], currentSourceHeaderSnapshot, mappingContext);
      const target = await targetRepository.create(tenantId, headerInput, userId, tx);

      const link = await this.documentLinks.createLink(
        tenantId,
        {
          sourceDocumentType: definition.sourceDocumentType,
          sourceDocumentId: primarySourceId,
          targetDocumentType: definition.targetDocumentType,
          targetDocumentId: target.id,
          relationType: 'DERIVED_FROM',
          createdBy: userId,
          transformationVersionId: version.id,
        },
        tx,
      );

      for (const line of proposal.lines) {
        const finalQuantity = lineOverrides[line.sourceLineId] ?? new Decimal(line.proposedQuantity.toString());
        if (finalQuantity.lte(0)) continue;

        const reCheck = await this.remaining.computeRemaining(tenantId, definition.sourceDocumentType, primarySourceId, line.sourceLineId, definition.code, line.metric, tx);
        if (finalQuantity.gt(reCheck.remaining)) {
          throw new ConflictAppError(`Line ${line.sourceLineId}: requested ${finalQuantity.toFixed(6)} exceeds remaining ${reCheck.remaining.toFixed(6)} at accept time`);
        }

        await tx.documentLineLink.create({
          data: {
            tenantId,
            sourceDocumentType: definition.sourceDocumentType,
            sourceDocumentId: primarySourceId,
            sourceLineId: line.sourceLineId,
            targetDocumentType: definition.targetDocumentType,
            targetDocumentId: target.id,
            targetLineId: target.id, // line-level target id is business-module-specific and not returned by the generic repository contract; the target document id is used as a placeholder pointer (disclosed, docs/DOCUMENT_CHAIN.md section E) — a module wanting precise target-line linkage can write its own richer DocumentLineLink row alongside this one.
            quantity: finalQuantity.toString(),
            relationType: definition.code,
            movementType: 'CONSUME',
            metric: line.metric,
            documentLinkId: link.id,
            createdBy: userId,
            idempotencyKey: `${tenantId}:${proposalId}:${line.id}`,
          },
        });
      }

      await tx.documentCreationProposal.update({ where: { id: proposalId }, data: { status: 'ACCEPTED' } });

      await this.audit.record({ tenantId, organizationId: proposal.organizationId, eventType: 'DOC_CHAIN_PROPOSAL_ACCEPTED', eventCategory: 'DOCUMENT_CHAIN', entityType: definition.targetDocumentType, entityId: target.id, operation: 'CREATE', action: 'CREATE_BASED_ON', userId, metadata: { proposalId, sourceDocumentType: definition.sourceDocumentType, sourceDocumentId: primarySourceId } }, tx);

      return { target, documentLink: link };
    });
  }

  async cancel(tenantId: string, proposalId: string) {
    const proposal = await this.get(tenantId, proposalId);
    if (proposal.status === 'ACCEPTED') throw new ConflictAppError('Cannot cancel an already-accepted proposal');
    return this.prisma.documentCreationProposal.update({ where: { id: proposalId }, data: { status: 'CANCELLED' } });
  }
}
