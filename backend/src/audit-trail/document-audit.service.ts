import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DocumentAuditService + PostingAuditService (docx spec Phase 25,
 * sections 20-26, combined into one file). Both read the SAME
 * `AuditEvent` rows (filtered by `documentType`/`documentId` and by
 * `eventCategory IN ('DOCUMENT','POSTING','ACCOUNTING')`) — a document's
 * lifecycle timeline and its posting/unposting/reversal trace are two
 * different VIEWS of one already-append-only stream, not two separate
 * storage tables (spec sections 20-23 vs 23-26 both point at the same
 * underlying event set). SAVE and POST are distinguished by `operation`
 * (`UPDATE` vs `POST`/`UNPOST`/`REVERSE`, spec section 22).
 */
@Injectable()
export class DocumentAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full lifecycle timeline for one document (spec section 20 —
   * created/edited/submitted/approved/posted/unposted/reversed/
   * cancelled/reopened/closed). */
  async lifecycle(tenantId: string, documentType: string, documentId: string) {
    const events = await this.prisma.auditEvent.findMany({
      where: { tenantId, documentType, documentId },
      include: { fieldChanges: true },
      orderBy: { timestamp: 'asc' },
    });
    return events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      actorUserId: e.userId,
      operation: e.operation ?? e.action,
      success: e.success,
      reason: e.reason,
      fieldChangeCount: e.fieldChanges.length,
      entityVersionBefore: e.entityVersionBefore,
      entityVersionAfter: e.entityVersionAfter,
      backdated: e.backdated,
    }));
  }

  /** Posting/unposting/reversal trace only (spec sections 23-26) — the
   * subset of the lifecycle whose `operation` is a posting-family
   * action, each optionally correlated to its own generated GL batch
   * via `correlationId` (shared with the GL/register events the same
   * business command produced, spec section 17). */
  async postingTrace(tenantId: string, documentType: string, documentId: string) {
    const events = await this.prisma.auditEvent.findMany({
      where: { tenantId, documentType, documentId, operation: { in: ['POST', 'UNPOST', 'REVERSE'] } },
      orderBy: { timestamp: 'asc' },
    });
    return events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      operation: e.operation,
      actorUserId: e.userId,
      entityVersionBefore: e.entityVersionBefore,
      entityVersionAfter: e.entityVersionAfter,
      correlationId: e.correlationId,
      reason: e.reason,
      success: e.success,
    }));
  }

  /** Every event sharing one `correlationId` — the full downstream
   * effect chain of a single business command (spec sections 17, 179).
   */
  async correlationChain(tenantId: string, correlationId: string) {
    return this.prisma.auditEvent.findMany({ where: { tenantId, correlationId }, orderBy: { timestamp: 'asc' } });
  }

  /** What CAUSED this event, and what it in turn caused (spec section
   * 18-19's own causation chain), one hop each direction. */
  async causationChain(tenantId: string, auditEventId: string) {
    const event = await this.prisma.auditEvent.findFirst({ where: { id: auditEventId, tenantId } });
    if (!event) return { cause: null, effects: [] };
    const cause = event.causationId ? await this.prisma.auditEvent.findFirst({ where: { id: event.causationId, tenantId } }) : null;
    const effects = await this.prisma.auditEvent.findMany({ where: { tenantId, causationId: auditEventId } });
    return { cause, effects };
  }
}
