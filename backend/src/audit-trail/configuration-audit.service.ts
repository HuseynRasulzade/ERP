import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * ConfigurationAuditService (docx spec Phase 25, sections 32-33). Every
 * caller already routes configuration changes (account mapping, tax
 * rates, depreciation/costing policy, approval thresholds, report
 * mappings, KPI formulas, security roles, ...) through the SAME
 * `AuditService.record` every other module uses — this service is a
 * thin, category-filtered read/write facade
 * (`eventCategory: 'CONFIGURATION'`) rather than a second
 * `AuditConfigurationChange` storage table, so a configuration change
 * is never invisible to the same integrity hash chain and search
 * surface as every other audit event (disclosed,
 * docs/AUDIT_TRAIL.md section D).
 */
@Injectable()
export class ConfigurationAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recordChange(
    tenantId: string,
    userId: string,
    dto: { configurationType: string; configurationId: string; versionBefore?: unknown; versionAfter: unknown; effectiveFrom?: Date; approvedBy?: string; changeReason: string; impactScope?: string },
  ) {
    return this.audit.record({
      tenantId,
      eventType: `CONFIG_CHANGED:${dto.configurationType}`,
      eventCategory: 'CONFIGURATION',
      operation: 'CONFIG_CHANGE',
      entityType: dto.configurationType,
      entityId: dto.configurationId,
      action: 'UPDATE',
      userId,
      oldValues: dto.versionBefore,
      newValues: dto.versionAfter,
      effectiveBusinessDate: dto.effectiveFrom,
      reason: dto.changeReason,
      metadata: { approvedBy: dto.approvedBy, impactScope: dto.impactScope },
    });
  }

  history(tenantId: string, configurationType: string, configurationId: string) {
    return this.prisma.auditEvent.findMany({ where: { tenantId, eventCategory: 'CONFIGURATION', entityType: configurationType, entityId: configurationId }, orderBy: { timestamp: 'asc' } });
  }
}
