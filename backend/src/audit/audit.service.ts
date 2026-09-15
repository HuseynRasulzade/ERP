import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { canonicalJson } from './audit-canonical-json.util';

export interface RecordAuditEventParams {
  tenantId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  action: string;
  userId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
  reason?: string;
  // Phase 25 additions — every field below is OPTIONAL so every
  // pre-existing call site across every prior phase keeps compiling
  // and behaving exactly as before (docs/AUDIT_TRAIL.md section A).
  organizationId?: string | null;
  eventCategory?: string;
  actorType?: string;
  sessionId?: string | null;
  causationId?: string | null;
  sourceType?: string;
  sourceApplication?: string;
  documentType?: string;
  documentId?: string;
  operation?: string;
  severity?: string;
  success?: boolean;
  failureCode?: string;
  effectiveBusinessDate?: Date;
  entityVersionBefore?: number;
  entityVersionAfter?: number;
  backdated?: boolean;
}

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'token', 'refreshToken', 'accessToken', 'secret']);

/**
 * Append-oriented audit event framework (docx spec Phase 0 section
 * 23/24, extended by Phase 25 into the full Audit / Change History /
 * Traceability / Evidence Platform — see docs/AUDIT_TRAIL.md). Every
 * event is chained to the tenant's own previous event via
 * `integrityHash`/`previousEventHash` (spec sections 81-83) so a
 * tampered or deleted row is detectable by `AuditIntegrityService`.
 * Audit events are written from backend/domain/application services
 * only — never from the frontend — and must never contain
 * secrets/credentials (spec section 12).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** Records an event using the ambient request context (correlation id,
   * actor). Pass an explicit `tx` when the event must be committed as part
   * of a larger transaction (e.g. posting) so it can never exist without
   * the operation it describes actually having succeeded (spec sections
   * 107-108's own transactional/outbox principle). Returns the created
   * row so a caller can link `AuditFieldChange`/`AuditEvidence` rows to
   * it, or thread its id through as the NEXT event's `causationId`. */
  async record(params: RecordAuditEventParams, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const actorUserId = params.userId ?? this.requestContext.getUser()?.userId ?? null;
    const actorType = params.actorType ?? (actorUserId ? 'USER' : 'SYSTEM');

    const previous = await client.auditEvent.findFirst({ where: { tenantId: params.tenantId }, orderBy: { timestamp: 'desc' }, select: { integrityHash: true } });
    const previousEventHash = previous?.integrityHash ?? null;

    const redactedOld = this.redact(params.oldValues);
    const redactedNew = this.redact(params.newValues);
    const redactedMeta = this.redact(params.metadata);

    const canonical = canonicalJson({
      tenantId: params.tenantId,
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      userId: actorUserId,
      oldValues: redactedOld,
      newValues: redactedNew,
      previousEventHash,
    });
    const integrityHash = createHash('sha256').update(canonical).digest('hex');

    return client.auditEvent.create({
      data: {
        tenantId: params.tenantId,
        organizationId: params.organizationId,
        eventType: params.eventType,
        eventCategory: params.eventCategory,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        operation: params.operation,
        userId: actorUserId,
        actorType,
        sessionId: params.sessionId,
        requestId: this.requestContext.requestId,
        correlationId: this.requestContext.correlationId,
        causationId: params.causationId,
        sourceType: params.sourceType ?? 'APPLICATION',
        sourceApplication: params.sourceApplication,
        documentType: params.documentType,
        documentId: params.documentId,
        severity: params.severity ?? 'INFO',
        success: params.success ?? true,
        failureCode: params.failureCode,
        effectiveBusinessDate: params.effectiveBusinessDate,
        entityVersionBefore: params.entityVersionBefore,
        entityVersionAfter: params.entityVersionAfter,
        backdated: params.backdated ?? false,
        oldValues: redactedOld as any,
        newValues: redactedNew as any,
        metadata: redactedMeta as any,
        reason: params.reason,
        integrityHash,
        previousEventHash,
      },
    });
  }

  async list(tenantId: string, filter: { entityType?: string; entityId?: string; limit?: number; cursor?: string }) {
    return this.prisma.auditEvent.findMany({
      where: {
        tenantId,
        entityType: filter.entityType,
        entityId: filter.entityId,
      },
      orderBy: { timestamp: 'desc' },
      take: filter.limit ?? 50,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    });
  }

  private redact(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((v) => this.redact(v));
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key)) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redact(val);
        }
      }
      return result;
    }
    return value;
  }
}
