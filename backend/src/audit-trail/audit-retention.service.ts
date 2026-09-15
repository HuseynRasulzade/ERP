import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLegalHoldService } from './audit-legal-hold.service';

/**
 * AuditRetentionService (docx spec Phase 25, sections 91-92, 97-98,
 * 105). Retention expiry never means immediate physical deletion by
 * default — `evaluate` returns each event's policy-driven disposition
 * (ARCHIVE/ANONYMIZE/PURGE) WITHOUT executing it; an actual archive/
 * purge job is left to an operational process outside this build
 * (disclosed, docs/AUDIT_TRAIL.md section I) — the critical rule this
 * service DOES enforce is: an event under an active legal hold is
 * NEVER included in the purge-eligible set, no matter how overdue its
 * retention period is (spec section 94, tested by section 186).
 */
@Injectable()
export class AuditRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legalHold: AuditLegalHoldService,
  ) {}

  async createPolicy(tenantId: string, dto: { eventCategory?: string; jurisdiction?: string; organizationId?: string; retentionPeriodDays: number; archivePolicy?: string; legalHoldBehavior?: string; purgeBehavior?: string }) {
    return this.prisma.auditRetentionPolicy.create({ data: { tenantId, eventCategory: dto.eventCategory, jurisdiction: dto.jurisdiction, organizationId: dto.organizationId, retentionPeriodDays: dto.retentionPeriodDays, archivePolicy: dto.archivePolicy ?? 'ARCHIVE', legalHoldBehavior: dto.legalHoldBehavior ?? 'BLOCK_PURGE', purgeBehavior: dto.purgeBehavior ?? 'NEVER_AUTO' } });
  }

  private async resolvePolicy(tenantId: string, eventCategory: string | null, organizationId: string | null) {
    return this.prisma.auditRetentionPolicy.findFirst({
      where: { tenantId, OR: [{ eventCategory }, { eventCategory: null }], AND: [{ OR: [{ organizationId }, { organizationId: null }] }] },
      orderBy: [{ eventCategory: 'desc' }, { organizationId: 'desc' }],
    });
  }

  /** Returns every event whose configured retention has expired, split
   * into `eligible` (safe to archive/anonymize/purge per policy) and
   * `heldBack` (retention expired but an active legal hold blocks
   * disposition) — never silently merges the two (spec section 94). */
  async evaluate(tenantId: string, organizationId: string) {
    const policies = await this.prisma.auditRetentionPolicy.findMany({ where: { tenantId, OR: [{ organizationId }, { organizationId: null }] } });
    const eligible: { eventId: string; disposition: string }[] = [];
    const heldBack: { eventId: string; disposition: string }[] = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionPeriodDays * 86400000);
      const candidates = await this.prisma.auditEvent.findMany({
        where: { tenantId, organizationId, timestamp: { lt: cutoff }, ...(policy.eventCategory ? { eventCategory: policy.eventCategory } : {}) },
        select: { id: true, userId: true, documentType: true, documentId: true, organizationId: true, eventCategory: true, timestamp: true },
      });
      for (const event of candidates) {
        const underHold = await this.legalHold.isUnderHold(tenantId, event);
        (underHold ? heldBack : eligible).push({ eventId: event.id, disposition: policy.archivePolicy });
      }
    }
    return { eligible, heldBack };
  }
}
