import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DocumentFrameworkModule } from '../document-framework/document-framework.module';
import { DocumentLinkModule } from '../document-link/document-link.module';

import { DocumentTypeDefinitionService } from './document-type-definition.service';
import { TransformationMappingService } from './transformation-mapping.service';
import { DocumentTransformationDefinitionService } from './document-transformation-definition.service';
import { RemainingToCreateService } from './remaining-to-create.service';
import { SourceCreationClaimService } from './source-creation-claim.service';
import { TransformationExceptionService } from './transformation-exception.service';
import { DocumentCreationProposalService } from './document-creation-proposal.service';
import { DocumentDependencyGraphService } from './document-dependency-graph.service';
import { DocumentImpactAnalysisService } from './document-impact-analysis.service';
import { DocumentChainHealthService } from './document-chain-health.service';
import { DocumentChainController } from './document-chain.controller';

/**
 * Document Chain / Create Based On / Provenance Engine (docx spec Phase
 * 27). See docs/DOCUMENT_CHAIN.md. Deliberately builds ON TOP of three
 * existing foundations rather than duplicating any of them:
 *   - `DocumentFrameworkModule` — `DocumentFrameworkRegistry`
 *     (repository/mapper lookup, extended additively in this phase with
 *     a `SourceEligibilityAdapter` registry) and `DocumentRepositoryAdapter`.
 *   - `DocumentLinkModule` — `DocumentLink` (extended additively with a
 *     richer relationType vocabulary + governance columns) and
 *     `DocumentLinkService`; `DocumentLineLink` (the pre-existing
 *     Phase 3/7 line-provenance table, extended additively into this
 *     phase's own consumption ledger — never a second ledger table).
 *   - `WorkflowModule` — reuses `WorkflowConditionService`'s safe
 *     condition DSL for transformation eligibility rules rather than
 *     building a second expression evaluator.
 */
@Module({
  imports: [AuditModule, WorkflowModule, DocumentFrameworkModule, DocumentLinkModule],
  controllers: [DocumentChainController],
  providers: [
    DocumentTypeDefinitionService,
    TransformationMappingService,
    DocumentTransformationDefinitionService,
    RemainingToCreateService,
    SourceCreationClaimService,
    TransformationExceptionService,
    DocumentCreationProposalService,
    DocumentDependencyGraphService,
    DocumentImpactAnalysisService,
    DocumentChainHealthService,
  ],
  exports: [
    TransformationMappingService,
    DocumentTransformationDefinitionService,
    RemainingToCreateService,
    DocumentCreationProposalService,
    SourceCreationClaimService,
    DocumentDependencyGraphService,
    DocumentImpactAnalysisService,
  ],
})
export class DocumentChainModule {}
