import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';

import { AuditPolicyService } from './audit-policy.service';
import { AuditDiffService } from './audit-diff.service';
import { AuditActorContextService } from './audit-actor-context.service';
import { DocumentAuditService } from './document-audit.service';
import { AuditLineageService } from './audit-lineage.service';
import { ConfigurationAuditService } from './configuration-audit.service';
import { SensitiveAccessAuditService } from './sensitive-access-audit.service';
import { AuditEvidenceService } from './audit-evidence.service';
import { AuditInvestigationService } from './audit-investigation.service';
import { AuditSearchService } from './audit-search.service';
import { AuditIntegrityService } from './audit-integrity.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditLegalHoldService } from './audit-legal-hold.service';
import { AuditExportService } from './audit-export.service';
import { AuditHealthService } from './audit-health.service';

import { AuditTrailController } from './audit-trail.controller';

/**
 * Audit / Change History / Traceability / Evidence Platform (docx spec
 * Phase 25). See docs/AUDIT_TRAIL.md. Builds on top of the existing
 * `AuditModule`'s `AuditEvent` — extended in Phase 25 with hash
 * chaining, categorization, and richer context fields — rather than
 * introducing a second, parallel event store (spec section 2's own
 * "Audit layer vs business tables" principle applied recursively: this
 * layer doesn't duplicate ITSELF either).
 */
@Module({
  imports: [AuditModule],
  controllers: [AuditTrailController],
  providers: [
    AuditPolicyService,
    AuditDiffService,
    AuditActorContextService,
    DocumentAuditService,
    AuditLineageService,
    ConfigurationAuditService,
    SensitiveAccessAuditService,
    AuditEvidenceService,
    AuditInvestigationService,
    AuditSearchService,
    AuditIntegrityService,
    AuditRetentionService,
    AuditLegalHoldService,
    AuditExportService,
    AuditHealthService,
  ],
  exports: [AuditDiffService, AuditActorContextService, AuditLineageService, ConfigurationAuditService, SensitiveAccessAuditService, AuditEvidenceService, AuditPolicyService],
})
export class AuditTrailModule {}
