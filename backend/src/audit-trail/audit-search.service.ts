import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditSearchFilter {
  from?: Date;
  to?: Date;
  actorUserId?: string;
  organizationId?: string;
  entityType?: string;
  entityId?: string;
  documentType?: string;
  documentId?: string;
  operation?: string;
  eventCategory?: string;
  correlationId?: string;
  sessionId?: string;
  severity?: string;
  success?: boolean;
  fullText?: string; // matches reason/metadata (spec section 71)
  limit?: number;
  cursor?: string;
}

/**
 * AuditSearchService (docx spec Phase 25, sections 70-71, 119). Queries
 * `AuditEvent` directly — this build has no separate rebuildable
 * `audit_search_projection` materialization; the authoritative table
 * already carries every filterable field spec section 70 lists, and
 * volumes in this build's scope do not yet require a projection
 * (disclosed simplification, docs/AUDIT_TRAIL.md section F). Full-text
 * search is a plain `contains` filter over `reason`, not a real
 * text-search index.
 */
@Injectable()
export class AuditSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(tenantId: string, filter: AuditSearchFilter) {
    return this.prisma.auditEvent.findMany({
      where: {
        tenantId,
        timestamp: filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
        userId: filter.actorUserId,
        organizationId: filter.organizationId,
        entityType: filter.entityType,
        entityId: filter.entityId,
        documentType: filter.documentType,
        documentId: filter.documentId,
        operation: filter.operation,
        eventCategory: filter.eventCategory,
        correlationId: filter.correlationId,
        sessionId: filter.sessionId,
        severity: filter.severity,
        success: filter.success,
        reason: filter.fullText ? { contains: filter.fullText, mode: 'insensitive' } : undefined,
      },
      orderBy: { timestamp: 'desc' },
      take: filter.limit ?? 100,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    });
  }

  entityTimeline(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.auditEvent.findMany({ where: { tenantId, entityType, entityId }, include: { fieldChanges: true }, orderBy: { timestamp: 'asc' } });
  }

  /** Authorized-auditor view of one user's material activity (spec
   * section 73) — everything they authored, ordered chronologically. */
  userActivity(tenantId: string, userId: string, from?: Date, to?: Date) {
    return this.prisma.auditEvent.findMany({ where: { tenantId, userId, timestamp: from || to ? { gte: from, lte: to } : undefined }, orderBy: { timestamp: 'desc' }, take: 500 });
  }

  sessionTimeline(tenantId: string, sessionId: string) {
    return this.prisma.auditEvent.findMany({ where: { tenantId, sessionId }, orderBy: { timestamp: 'asc' } });
  }
}
