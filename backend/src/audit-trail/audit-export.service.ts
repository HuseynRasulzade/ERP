import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditSearchService, AuditSearchFilter } from './audit-search.service';
import { AuditIntegrityService } from './audit-integrity.service';

const SENSITIVE_ENTITY_TYPES = new Set(['Employee', 'PayrollCalculationResult', 'PhysicalPerson', 'BankAccount']);

/**
 * AuditExportService (docx spec Phase 25, sections 99-103). Builds a
 * frozen, hashed `AuditExportPackage` bundling matched events, their
 * field diffs, and an integrity-verification proof for the same window
 * (spec section 99-101) — the export ITSELF is audited (an `EXPORT`
 * event is recorded for every package generated, spec section 63).
 * `redact: true` masks `oldValue`/`newValue` on any field change
 * belonging to a sensitive entity type rather than omitting the event
 * entirely, so the redacted package still shows WHAT changed, just not
 * the values (spec section 102) — the underlying stored evidence is
 * never altered by producing a redacted export.
 */
@Injectable()
export class AuditExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly search: AuditSearchService,
    private readonly integrity: AuditIntegrityService,
  ) {}

  async build(tenantId: string, userId: string, dto: { title: string; filter: AuditSearchFilter; redact?: boolean }) {
    const events = await this.search.search(tenantId, { ...dto.filter, limit: dto.filter.limit ?? 5000 });
    const fieldChanges = await this.prisma.auditFieldChange.findMany({ where: { tenantId, auditEventId: { in: events.map((e) => e.id) } } });
    const evidenceRefs = await this.prisma.auditEvidence.findMany({ where: { tenantId, auditEventId: { in: events.map((e) => e.id) } } });
    const integrityProof = await this.integrity.verify(tenantId, dto.filter.from, dto.filter.to);

    const redact = dto.redact ?? false;
    const payload = {
      events: events.map((e) => ({ ...e, oldValues: redact && SENSITIVE_ENTITY_TYPES.has(e.entityType) ? '[REDACTED]' : e.oldValues, newValues: redact && SENSITIVE_ENTITY_TYPES.has(e.entityType) ? '[REDACTED]' : e.newValues })),
      fieldChanges: fieldChanges.map((fc) => ({ ...fc, oldValue: redact && fc.isSensitive ? '[REDACTED]' : fc.oldValue, newValue: redact && fc.isSensitive ? '[REDACTED]' : fc.newValue })),
      evidenceReferences: evidenceRefs.map((ev) => ({ id: ev.id, fileName: ev.fileName, fileHash: ev.fileHash, evidenceType: ev.evidenceType })),
      integrityProof,
    };
    const packageHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    const exportPackage = await this.prisma.auditExportPackage.create({
      data: { tenantId, title: dto.title, filterCriteria: dto.filter as object, eventCount: events.length, redacted: redact, packageHash, payload: payload as object, generatedBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'AUDIT_EXPORT_GENERATED', eventCategory: 'IMPORT_EXPORT', operation: 'EXPORT', entityType: 'AuditExportPackage', entityId: exportPackage.id, action: 'EXPORT', userId, metadata: { rowCount: events.length, redacted: redact, packageHash } });
    return exportPackage;
  }

  get(tenantId: string, id: string) {
    return this.prisma.auditExportPackage.findFirst({ where: { id, tenantId } });
  }
}
