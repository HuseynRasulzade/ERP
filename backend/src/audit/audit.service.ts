import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';

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
}

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'token', 'refreshToken', 'accessToken', 'secret']);

/**
 * Append-oriented audit event framework (section 23/24). Audit events are
 * written from backend/domain/application services only — never from the
 * frontend — and must never contain secrets/credentials.
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
   * the operation it describes actually having succeeded. */
  async record(params: RecordAuditEventParams, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const actorUserId = params.userId ?? this.requestContext.getUser()?.userId ?? null;

    await client.auditEvent.create({
      data: {
        tenantId: params.tenantId,
        eventType: params.eventType,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        userId: actorUserId,
        requestId: this.requestContext.requestId,
        correlationId: this.requestContext.correlationId,
        oldValues: this.redact(params.oldValues) as any,
        newValues: this.redact(params.newValues) as any,
        metadata: this.redact(params.metadata) as any,
        reason: params.reason,
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
