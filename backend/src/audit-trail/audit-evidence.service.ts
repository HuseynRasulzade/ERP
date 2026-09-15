import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * AuditEvidenceService (docx spec Phase 25, sections 56-63). Every
 * evidence row stores a sha256 `fileHash` (spec section 59). Once a
 * piece of evidence is marked `immutable` (because a FINAL/SIGNED
 * material event referenced it, spec section 58), it can never be
 * edited or removed — `replace` always creates a NEW version linked via
 * `supersedesEvidenceId`.
 */
@Injectable()
export class AuditEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(
    tenantId: string,
    userId: string,
    dto: { auditEventId?: string; linkedEntityType?: string; linkedEntityId?: string; evidenceType?: string; fileName?: string; mediaType?: string; sizeBytes?: number; fileContent: Buffer; classification?: string; retentionClass?: string; source?: string },
  ) {
    const fileHash = createHash('sha256').update(dto.fileContent).digest('hex');
    return this.prisma.auditEvidence.create({
      data: {
        tenantId,
        auditEventId: dto.auditEventId,
        linkedEntityType: dto.linkedEntityType,
        linkedEntityId: dto.linkedEntityId,
        evidenceType: dto.evidenceType ?? 'ATTACHMENT',
        fileName: dto.fileName,
        mediaType: dto.mediaType,
        sizeBytes: dto.sizeBytes ?? dto.fileContent.length,
        fileHash,
        classification: dto.classification ?? 'INTERNAL',
        retentionClass: dto.retentionClass,
        source: dto.source ?? 'USER_UPLOAD',
        uploadedBy: userId,
      },
    });
  }

  /** Marks a piece of evidence immutable once a FINAL/SIGNED material
   * event references it (spec section 58) — called by the owning
   * module (e.g. Phase 23's `FinancialReportVersionService.sign`) at
   * the moment of finalization. */
  async markImmutable(tenantId: string, evidenceId: string) {
    return this.prisma.auditEvidence.updateMany({ where: { id: evidenceId, tenantId }, data: { immutable: true } });
  }

  /** Replacing evidence already marked immutable creates a new VERSION
   * rather than mutating the original (spec sections 58, "Evidence file
   * cannot be removed because it is referenced by a signed financial
   * report" — the original always survives). */
  async replace(tenantId: string, userId: string, originalId: string, dto: { fileContent: Buffer; fileName?: string; mediaType?: string; reason: string }) {
    const original = await this.get(tenantId, originalId);
    const fileHash = createHash('sha256').update(dto.fileContent).digest('hex');
    return this.prisma.auditEvidence.create({
      data: {
        tenantId,
        auditEventId: original.auditEventId,
        linkedEntityType: original.linkedEntityType,
        linkedEntityId: original.linkedEntityId,
        evidenceType: original.evidenceType,
        fileName: dto.fileName ?? original.fileName,
        mediaType: dto.mediaType ?? original.mediaType,
        sizeBytes: dto.fileContent.length,
        fileHash,
        classification: original.classification,
        retentionClass: original.retentionClass,
        version: original.version + 1,
        supersedesEvidenceId: original.id,
        uploadedBy: userId,
        source: original.source,
      },
    });
  }

  async remove(tenantId: string, evidenceId: string) {
    const evidence = await this.get(tenantId, evidenceId);
    if (evidence.immutable) throw new ValidationAppError('Evidence file cannot be removed because it is referenced by a finalized/signed material event (spec section 58).');
    return this.prisma.auditEvidence.delete({ where: { id: evidence.id } });
  }

  /** Re-hashes the currently stored file content and compares it
   * against the recorded `fileHash` (spec section 188 — detecting
   * external tampering). The caller supplies the current content since
   * this build stores no binary blob itself (evidence rows record the
   * hash/metadata; actual file storage is an external concern). */
  verifyHash(tenantId: string, evidence: { fileHash: string }, currentContent: Buffer): boolean {
    void tenantId;
    return createHash('sha256').update(currentContent).digest('hex') === evidence.fileHash;
  }

  listFor(tenantId: string, linkedEntityType: string, linkedEntityId: string) {
    return this.prisma.auditEvidence.findMany({ where: { tenantId, linkedEntityType, linkedEntityId }, orderBy: { uploadedAt: 'desc' } });
  }

  private async get(tenantId: string, id: string) {
    const evidence = await this.prisma.auditEvidence.findFirst({ where: { id, tenantId } });
    if (!evidence) throw new NotFoundAppError('AuditEvidence', id);
    return evidence;
  }
}
