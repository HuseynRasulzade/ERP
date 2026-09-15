import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditIntegrityService } from './audit-integrity.service';

export interface AuditHealthFinding {
  check: string;
  count: number;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  blocking: boolean;
}

/**
 * AuditHealthService (docx spec Phase 25, section 106). Computed live —
 * same "rebuildable projection" convention as every other Health
 * service in this codebase. Feeds Phase 30's own organization-wide
 * Accounting Health engine (spec section 165).
 */
@Injectable()
export class AuditHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrity: AuditIntegrityService,
  ) {}

  async check(tenantId: string): Promise<AuditHealthFinding[]> {
    const findings: AuditHealthFinding[] = [];

    const eventsWithCause = await this.prisma.auditEvent.findMany({ where: { tenantId, causationId: { not: null } }, select: { causationId: true } });
    const causeIds = Array.from(new Set(eventsWithCause.map((e) => e.causationId!)));
    const existingCauses = causeIds.length > 0 ? await this.prisma.auditEvent.findMany({ where: { id: { in: causeIds } }, select: { id: true } }) : [];
    const missingCauseCount = causeIds.length - existingCauses.length;
    if (missingCauseCount > 0) findings.push({ check: 'BROKEN_CAUSATION_CHAIN', count: missingCauseCount, severity: 'WARNING', blocking: false });

    const recentVerification = await this.integrity.verify(tenantId, new Date(Date.now() - 30 * 86400000));
    if (!recentVerification.valid) findings.push({ check: 'HASH_CHAIN_BREAK', count: recentVerification.hashMismatches.length + recentVerification.chainBreaks.length, severity: 'BLOCKING', blocking: true });

    const evidenceMismatchCandidates = await this.prisma.auditEvidence.count({ where: { tenantId, fileHash: '' } });
    if (evidenceMismatchCandidates > 0) findings.push({ check: 'EVIDENCE_MISSING_HASH', count: evidenceMismatchCandidates, severity: 'ERROR', blocking: false });

    const overdueUnderHold = await this.prisma.auditLegalHold.count({ where: { tenantId, status: 'ACTIVE', expiresAt: { lt: new Date() } } });
    if (overdueUnderHold > 0) findings.push({ check: 'LEGAL_HOLD_PAST_EXPECTED_EXPIRY', count: overdueUnderHold, severity: 'INFO', blocking: false });

    const openInvestigations = await this.prisma.auditInvestigation.count({ where: { tenantId, status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } });
    if (openInvestigations > 0) findings.push({ check: 'OPEN_INVESTIGATIONS', count: openInvestigations, severity: 'INFO', blocking: false });

    return findings;
  }
}
