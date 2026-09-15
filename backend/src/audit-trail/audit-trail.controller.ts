import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditSearchService } from './audit-search.service';
import { DocumentAuditService } from './document-audit.service';
import { AuditLineageService } from './audit-lineage.service';
import { ConfigurationAuditService } from './configuration-audit.service';
import { SensitiveAccessAuditService } from './sensitive-access-audit.service';
import { AuditInvestigationService } from './audit-investigation.service';
import { AuditLegalHoldService } from './audit-legal-hold.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditIntegrityService } from './audit-integrity.service';
import { AuditExportService } from './audit-export.service';
import { AuditHealthService } from './audit-health.service';
import {
  OpenInvestigationDto,
  AddInvestigationItemDto,
  SetInvestigationStatusDto,
  CreateLegalHoldDto,
  ReleaseLegalHoldDto,
  CreateRetentionPolicyDto,
  VerifyIntegrityDto,
  AuditSearchDto,
  BuildExportDto,
  RecordConfigChangeDto,
  RecordSensitiveAccessDto,
} from './dto/audit-trail.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Immutable Audit Trail / Change History / Traceability / Evidence
 * Platform API (docx spec Phase 25). See docs/AUDIT_TRAIL.md. Tenant-
 * scoped, not organization-scoped, since audit spans every organization
 * a tenant contains. */
@Controller('audit')
export class AuditTrailController {
  constructor(
    private readonly search: AuditSearchService,
    private readonly documentAudit: DocumentAuditService,
    private readonly lineage: AuditLineageService,
    private readonly configAudit: ConfigurationAuditService,
    private readonly sensitiveAccess: SensitiveAccessAuditService,
    private readonly investigations: AuditInvestigationService,
    private readonly legalHold: AuditLegalHoldService,
    private readonly retention: AuditRetentionService,
    private readonly integrity: AuditIntegrityService,
    private readonly exportService: AuditExportService,
    private readonly health: AuditHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.AUDIT_SEARCH_GLOBAL)
  @Get('events')
  searchEvents(@CurrentTenantId() tenantId: string, @Query() query: AuditSearchDto) {
    return this.search.search(tenantId, { from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined, actorUserId: query.actorUserId, entityType: query.entityType, entityId: query.entityId, documentType: query.documentType, documentId: query.documentId, operation: query.operation, eventCategory: query.eventCategory, correlationId: query.correlationId, fullText: query.fullText, limit: query.limit });
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_ENTITY_HISTORY)
  @Get('entities/:type/:id/history')
  entityHistory(@CurrentTenantId() tenantId: string, @Param('type') type: string, @Param('id') id: string) {
    return this.search.entityTimeline(tenantId, type, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_DOCUMENT_HISTORY)
  @Get('documents/:type/:id/history')
  documentHistory(@CurrentTenantId() tenantId: string, @Param('type') type: string, @Param('id') id: string) {
    return this.documentAudit.lifecycle(tenantId, type, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_POSTING_TRACE)
  @Get('documents/:type/:id/posting-trace')
  postingTrace(@CurrentTenantId() tenantId: string, @Param('type') type: string, @Param('id') id: string) {
    return this.documentAudit.postingTrace(tenantId, type, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_DOCUMENT_HISTORY)
  @Get('documents/:type/:id/lineage')
  documentLineage(@CurrentTenantId() tenantId: string, @Param('type') type: string, @Param('id') id: string) {
    return this.lineage.forwardLineage(tenantId, type, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW)
  @Get('correlations/:id')
  correlation(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.documentAudit.correlationChain(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_SECURITY_EVENTS)
  @Get('users/:id/activity')
  userActivity(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.search.userActivity(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_CONFIG_HISTORY)
  @Get('config/:type/:id/history')
  configHistory(@CurrentTenantId() tenantId: string, @Param('type') type: string, @Param('id') id: string) {
    return this.configAudit.history(tenantId, type, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_ADMIN)
  @Post('config-changes')
  recordConfigChange(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordConfigChangeDto) {
    return this.configAudit.recordChange(tenantId, user.userId, { ...dto, effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined });
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW_SENSITIVE_ACCESS)
  @Post('sensitive-access')
  recordSensitiveAccess(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordSensitiveAccessDto) {
    return this.sensitiveAccess.recordAccess(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.AUDIT_INVESTIGATION_CREATE)
  @Post('investigations')
  openInvestigation(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: OpenInvestigationDto) {
    return this.investigations.open(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW)
  @Get('investigations/:id')
  getInvestigationTimeline(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.investigations.timeline(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.AUDIT_INVESTIGATION_EDIT)
  @Post('investigations/:id/items')
  addInvestigationItem(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: AddInvestigationItemDto) {
    return this.investigations.addItem(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.AUDIT_INVESTIGATION_EDIT)
  @Post('investigations/:id/status')
  setInvestigationStatus(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: SetInvestigationStatusDto) {
    return this.investigations.setStatus(tenantId, user.userId, id, dto.status, dto.conclusion);
  }

  @RequirePermissions(PermissionCodes.AUDIT_LEGAL_HOLD_CREATE)
  @Post('legal-holds')
  createLegalHold(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateLegalHoldDto) {
    return this.legalHold.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.AUDIT_LEGAL_HOLD_RELEASE)
  @Post('legal-holds/:id/release')
  releaseLegalHold(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: ReleaseLegalHoldDto) {
    return this.legalHold.release(tenantId, user.userId, id, dto.reason);
  }

  @RequirePermissions(PermissionCodes.AUDIT_RETENTION_MANAGE)
  @Post('retention-policies')
  createRetentionPolicy(@CurrentTenantId() tenantId: string, @Body() dto: CreateRetentionPolicyDto) {
    return this.retention.createPolicy(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.AUDIT_RETENTION_MANAGE)
  @Get('retention/evaluate')
  evaluateRetention(@CurrentTenantId() tenantId: string, @Query('organizationId') organizationId: string) {
    return this.retention.evaluate(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.AUDIT_VERIFY_INTEGRITY)
  @Post('integrity/verify')
  verifyIntegrity(@CurrentTenantId() tenantId: string, @Body() dto: VerifyIntegrityDto) {
    return this.integrity.verify(tenantId, dto.from ? new Date(dto.from) : undefined, dto.to ? new Date(dto.to) : undefined);
  }

  @RequirePermissions(PermissionCodes.AUDIT_EXPORT)
  @Post('export')
  buildExport(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: BuildExportDto) {
    const filter = dto.filter as { from?: string; to?: string } & Record<string, unknown>;
    return this.exportService.build(tenantId, user.userId, { title: dto.title, redact: dto.redact, filter: { ...filter, from: filter.from ? new Date(filter.from) : undefined, to: filter.to ? new Date(filter.to) : undefined } });
  }

  @RequirePermissions(PermissionCodes.AUDIT_VIEW)
  @Get('health')
  getHealth(@CurrentTenantId() tenantId: string) {
    return this.health.check(tenantId);
  }
}
