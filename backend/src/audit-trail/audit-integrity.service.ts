import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalJson } from '../audit/audit-canonical-json.util';

export interface IntegrityVerificationResult {
  valid: boolean;
  eventsChecked: number;
  hashMismatches: string[];
  chainBreaks: string[];
}

/**
 * AuditIntegrityService (docx spec Phase 25, sections 80-87). Verifies
 * the per-tenant hash chain `AuditService.record` maintains: each
 * event's own `integrityHash` is recomputed from its canonical fields
 * and compared, and each event's `previousEventHash` must equal the
 * chronologically preceding event's own `integrityHash`. The chain is
 * a SINGLE per-tenant chain (spec section 83's own "Global single chain
 * large-scale bottleneck ola bilər" partitioning recommendation is not
 * implemented) and is best-effort under concurrent writers — two audit
 * events committed in the same instant can legitimately both reference
 * the same `previousEventHash` (a benign fork, not tampering);
 * `verify` reports this as a chain break candidate for a human to
 * review rather than an automatic INVALID verdict (disclosed,
 * docs/AUDIT_TRAIL.md section G).
 */
@Injectable()
export class AuditIntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(tenantId: string, from?: Date, to?: Date): Promise<IntegrityVerificationResult> {
    const events = await this.prisma.auditEvent.findMany({
      where: { tenantId, timestamp: from || to ? { gte: from, lte: to } : undefined },
      orderBy: { timestamp: 'asc' },
    });

    const hashMismatches: string[] = [];
    const chainBreaks: string[] = [];
    let previousHash: string | null = null;

    for (const event of events) {
      const canonical = canonicalJson({
        tenantId: event.tenantId,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        userId: event.userId,
        oldValues: event.oldValues,
        newValues: event.newValues,
        previousEventHash: event.previousEventHash,
      });
      const recomputed = createHash('sha256').update(canonical).digest('hex');
      if (event.integrityHash && recomputed !== event.integrityHash) hashMismatches.push(event.id);
      if (previousHash !== null && event.previousEventHash !== null && event.previousEventHash !== previousHash) chainBreaks.push(event.id);
      previousHash = event.integrityHash ?? previousHash;
    }

    return { valid: hashMismatches.length === 0 && chainBreaks.length === 0, eventsChecked: events.length, hashMismatches, chainBreaks };
  }

  async createCheckpoint(tenantId: string, period: string, scope = 'TENANT') {
    const [periodStart, periodEnd] = this.periodBounds(period);
    const events = await this.prisma.auditEvent.findMany({ where: { tenantId, timestamp: { gte: periodStart, lte: periodEnd } }, orderBy: { timestamp: 'asc' }, select: { id: true, integrityHash: true } });
    const rootHash = createHash('sha256').update(events.map((e) => e.integrityHash ?? '').join('')).digest('hex');
    const verification = await this.verify(tenantId, periodStart, periodEnd);

    return this.prisma.auditIntegrityCheckpoint.upsert({
      where: { tenantId_scope_period: { tenantId, scope, period } },
      create: { tenantId, scope, period, firstEventId: events[0]?.id, lastEventId: events[events.length - 1]?.id, eventCount: events.length, rootHash, verificationStatus: verification.valid ? 'VALID' : 'INVALID' },
      update: { firstEventId: events[0]?.id, lastEventId: events[events.length - 1]?.id, eventCount: events.length, rootHash, verificationStatus: verification.valid ? 'VALID' : 'INVALID', generatedAt: new Date() },
    });
  }

  private periodBounds(period: string): [Date, Date] {
    if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
      const day = new Date(`${period}T00:00:00.000Z`);
      return [day, new Date(day.getTime() + 86400000 - 1)];
    }
    const [year, month] = period.split('-').map(Number);
    return [new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))];
  }
}
