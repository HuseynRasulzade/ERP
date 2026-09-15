import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditPolicyService } from './audit-policy.service';

/**
 * SensitiveAccessAuditService (docx spec Phase 25, sections 45-48).
 * Records a READ (`VIEW_SENSITIVE`) as an `AuditEvent` with
 * `eventCategory: 'ACCESS'` — `fieldsAccessed`/`purpose`/`result` live
 * in `metadata` rather than a dedicated `AuditAccessEvent` table (spec
 * section 46's own fields, folded into the generic event shape, same
 * "reuse over duplication" rationale as `ConfigurationAuditService`).
 * Policy-gated (spec section 47's own "Do not audit every low-value
 * read") — `AuditPolicyService.shouldAuditAccess` decides whether a
 * given resourceType is material enough to log.
 */
@Injectable()
export class SensitiveAccessAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: AuditPolicyService,
  ) {}

  async recordAccess(tenantId: string, userId: string, dto: { resourceType: string; resourceId: string; accessType?: string; fieldsAccessed?: string[]; purpose?: string; result?: 'GRANTED' | 'DENIED'; organizationId?: string }) {
    if (!(await this.policy.shouldAuditAccess(tenantId, dto.resourceType))) return null;
    return this.audit.record({
      tenantId,
      organizationId: dto.organizationId,
      eventType: `SENSITIVE_ACCESS:${dto.resourceType}`,
      eventCategory: 'ACCESS',
      operation: 'VIEW_SENSITIVE',
      entityType: dto.resourceType,
      entityId: dto.resourceId,
      action: dto.accessType ?? 'VIEW',
      userId,
      success: dto.result !== 'DENIED',
      metadata: { fieldsAccessed: dto.fieldsAccessed, purpose: dto.purpose, result: dto.result ?? 'GRANTED' },
    });
  }

  history(tenantId: string, resourceType: string, resourceId: string) {
    return this.prisma.auditEvent.findMany({ where: { tenantId, eventCategory: 'ACCESS', entityType: resourceType, entityId: resourceId }, orderBy: { timestamp: 'desc' } });
  }

  /** Failed high-risk attempts (spec sections 115-116, 190) — permission
   * denials, blocked reopen attempts, etc. */
  async recordFailedAttempt(tenantId: string, userId: string | null, dto: { entityType: string; entityId: string; operation: string; failureCode: string; reason?: string }) {
    return this.audit.record({
      tenantId,
      eventType: `ACTION_FAILED:${dto.operation}`,
      eventCategory: 'SECURITY',
      operation: dto.operation,
      entityType: dto.entityType,
      entityId: dto.entityId,
      action: dto.operation,
      userId,
      success: false,
      failureCode: dto.failureCode,
      severity: 'WARNING',
      reason: dto.reason,
    });
  }
}
