import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface LegalHoldScope {
  userId?: string;
  customerId?: string;
  documentType?: string;
  documentId?: string;
  organizationId?: string;
  investigationId?: string;
  dateFrom?: string;
  dateTo?: string;
  eventCategory?: string;
}

/**
 * AuditLegalHoldService (docx spec Phase 25, sections 93-96, 186-187).
 * Creating and releasing a hold is ITSELF audited (spec section 96) —
 * both `create` and `release` call `AuditService.record`. `covers`
 * checks whether a given audit event falls inside an ACTIVE hold's
 * scope — `AuditRetentionService` calls this before ever purging
 * anything (spec section 94's own "cannot be purged even if retention
 * expired").
 */
@Injectable()
export class AuditLegalHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { scope: LegalHoldScope; reason: string; expiresAt?: string; legalReference?: string; notes?: string }) {
    const hold = await this.prisma.auditLegalHold.create({ data: { tenantId, scope: dto.scope as object, reason: dto.reason, openedBy: userId, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined, legalReference: dto.legalReference, notes: dto.notes, status: 'ACTIVE' } });
    await this.audit.record({ tenantId, eventType: 'AUDIT_LEGAL_HOLD_CREATED', eventCategory: 'SECURITY', severity: 'CRITICAL', entityType: 'AuditLegalHold', entityId: hold.id, action: 'CREATE', userId, reason: dto.reason, newValues: { scope: dto.scope } });
    return hold;
  }

  /** Release requires an independent approver in principle (spec
   * section 142's own segregation-of-duties note) — this build does not
   * enforce `releasedBy !== openedBy` programmatically, only records
   * both (disclosed, docs/AUDIT_TRAIL.md section H). */
  async release(tenantId: string, userId: string, holdId: string, reason: string) {
    const hold = await this.get(tenantId, holdId);
    if (hold.status !== 'ACTIVE') throw new ValidationAppError(`Legal hold ${holdId} is already ${hold.status}`);
    const updated = await this.prisma.auditLegalHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedBy: userId, releasedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'AUDIT_LEGAL_HOLD_RELEASED', eventCategory: 'SECURITY', severity: 'CRITICAL', entityType: 'AuditLegalHold', entityId: hold.id, action: 'UPDATE', userId, reason });
    return updated;
  }

  async activeHolds(tenantId: string) {
    return this.prisma.auditLegalHold.findMany({ where: { tenantId, status: 'ACTIVE' } });
  }

  /** Whether ANY active hold's scope covers this event (spec section
   * 95's own scope dimensions) — a hold with no dimension set at all is
   * treated as covering nothing (an empty scope is never "hold
   * everything" by accident). */
  async isUnderHold(tenantId: string, event: { userId?: string | null; documentType?: string | null; documentId?: string | null; organizationId?: string | null; eventCategory?: string | null; timestamp: Date }): Promise<boolean> {
    const holds = await this.activeHolds(tenantId);
    return holds.some((hold) => {
      const scope = hold.scope as LegalHoldScope;
      if (Object.keys(scope).length === 0) return false;
      if (scope.userId && scope.userId !== event.userId) return false;
      if (scope.documentType && scope.documentType !== event.documentType) return false;
      if (scope.documentId && scope.documentId !== event.documentId) return false;
      if (scope.organizationId && scope.organizationId !== event.organizationId) return false;
      if (scope.eventCategory && scope.eventCategory !== event.eventCategory) return false;
      if (scope.dateFrom && event.timestamp < new Date(scope.dateFrom)) return false;
      if (scope.dateTo && event.timestamp > new Date(scope.dateTo)) return false;
      return true;
    });
  }

  private async get(tenantId: string, id: string) {
    const hold = await this.prisma.auditLegalHold.findFirst({ where: { id, tenantId } });
    if (!hold) throw new NotFoundAppError('AuditLegalHold', id);
    return hold;
  }
}
