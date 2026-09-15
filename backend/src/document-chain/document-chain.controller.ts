import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DocumentTypeDefinitionService } from './document-type-definition.service';
import { DocumentTransformationDefinitionService } from './document-transformation-definition.service';
import { DocumentCreationProposalService } from './document-creation-proposal.service';
import { SourceCreationClaimService } from './source-creation-claim.service';
import { DocumentDependencyGraphService } from './document-dependency-graph.service';
import { DocumentImpactAnalysisService } from './document-impact-analysis.service';
import { TransformationExceptionService } from './transformation-exception.service';
import { DocumentChainHealthService } from './document-chain-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import {
  CreateDocumentTypeDto,
  CreateTransformationDto,
  CreateTransformationVersionDto,
  GenerateProposalDto,
  AcceptProposalDto,
  ClaimDto,
} from './dto/document-chain.dto';

/** Document Chain / Create Based On / Provenance Engine API (docx spec
 * Phase 27). See docs/DOCUMENT_CHAIN.md. */
@Controller('document-chain')
export class DocumentChainController {
  constructor(
    private readonly types: DocumentTypeDefinitionService,
    private readonly transformations: DocumentTransformationDefinitionService,
    private readonly proposals: DocumentCreationProposalService,
    private readonly claims: SourceCreationClaimService,
    private readonly graph: DocumentDependencyGraphService,
    private readonly impact: DocumentImpactAnalysisService,
    private readonly exceptions: TransformationExceptionService,
    private readonly health: DocumentChainHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.DOC_CHAIN_VIEW)
  @Get('types')
  listTypes(@CurrentTenantId() tenantId: string) {
    return this.types.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_TYPE_MANAGE)
  @Post('types')
  createType(@CurrentTenantId() tenantId: string, @Body() dto: CreateDocumentTypeDto) {
    return this.types.create(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_VIEW)
  @Get('transformations')
  listTransformations(@CurrentTenantId() tenantId: string) {
    return this.transformations.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_TRANSFORMATION_MANAGE)
  @Post('transformations')
  createTransformation(@CurrentTenantId() tenantId: string, @Body() dto: CreateTransformationDto) {
    return this.transformations.createDefinition(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_TRANSFORMATION_MANAGE)
  @Post('transformations/:id/versions')
  createVersion(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: CreateTransformationVersionDto) {
    return this.transformations.createVersion(tenantId, user.userId, id, {
      ...dto,
      effectiveFrom: new Date(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
    } as never);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_TRANSFORMATION_APPROVE)
  @Post('versions/:id/activate')
  activateVersion(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.transformations.activateVersion(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.CREATE_BASED_ON_PROPOSE)
  @Post('proposals/:targetDocumentType')
  generateProposal(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('targetDocumentType') targetDocumentType: string, @Body() dto: GenerateProposalDto) {
    return this.proposals.generate(tenantId, user.userId, targetDocumentType, {
      ...dto,
      sourceLines: dto.sourceLines.map((l) => ({ ...l, requestedQuantity: l.requestedQuantity !== undefined ? new Decimal(l.requestedQuantity) : undefined })),
    });
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_VIEW)
  @Get('proposals/:id')
  getProposal(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.proposals.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.CREATE_BASED_ON_ACCEPT)
  @Post('proposals/:id/accept')
  acceptProposal(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Param('id') id: string, @Body() dto: AcceptProposalDto) {
    const overrides: Record<string, Decimal> = {};
    for (const [k, v] of Object.entries(dto.lineOverrides ?? {})) overrides[k] = new Decimal(v);
    return this.proposals.accept(tenantId, user.userId, id, dto.currentSourceHeaderSnapshot, dto.currentSourceLines, overrides, dto.mappingContext);
  }

  @RequirePermissions(PermissionCodes.CREATE_BASED_ON_PROPOSE)
  @Post('proposals/:id/cancel')
  cancelProposal(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.proposals.cancel(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_CLAIM_MANAGE)
  @Post('claims')
  createClaim(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: ClaimDto) {
    return this.claims.claim(tenantId, user.userId, { ...dto, quantity: new Decimal(dto.quantity) });
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_CLAIM_MANAGE)
  @Post('claims/:id/release')
  releaseClaim(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.claims.release(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_LINEAGE_VIEW)
  @Get('documents/:documentType/:documentId/lineage')
  lineage(@CurrentTenantId() tenantId: string, @Param('documentType') documentType: string, @Param('documentId') documentId: string, @Query('direction') direction: 'FORWARD' | 'BACKWARD' = 'FORWARD') {
    return this.graph.transitiveClosure(tenantId, documentType, documentId, direction);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_IMPACT_VIEW)
  @Get('documents/:documentType/:documentId/impact')
  impactAnalysis(@CurrentTenantId() tenantId: string, @Param('documentType') documentType: string, @Param('documentId') documentId: string) {
    return this.impact.analyze(tenantId, documentType, documentId);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_EXCEPTION_VIEW)
  @Get('exceptions')
  listExceptions(@CurrentTenantId() tenantId: string, @Query('resolved') resolved?: string) {
    return this.exceptions.list(tenantId, { resolved: resolved === undefined ? undefined : resolved === 'true' });
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_EXCEPTION_RESOLVE)
  @Post('exceptions/:id/resolve')
  resolveException(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.exceptions.resolve(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.DOC_CHAIN_VIEW)
  @Get('health')
  healthSummary(@CurrentTenantId() tenantId: string) {
    return this.health.summary(tenantId);
  }
}
