import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CounterpartyContractService } from './counterparty-contract.service';
import { CounterpartyContractAmendmentService } from './counterparty-contract-amendment.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export const OWNER_TYPES = ['CONTRACT', 'CONTRACT_AMENDMENT'];

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
];

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB (spec section 7)

const STORAGE_ROOT = join(process.cwd(), 'uploads', 'counterparty-documents');

/**
 * CounterpartyDocument service (spec section 7) — files attached directly
 * to a contract OR one of its amendments (never both; `ownerType` +
 * `ownerId` picks exactly one). Stores the file on local disk under a
 * per-tenant root and keeps only metadata + an opaque `storageKey` in the
 * database — never a client-supplied path. Allowed types and max size are
 * enforced here (server-side authority), not just in the upload
 * interceptor's coarse `limits.fileSize` backstop.
 */
@Injectable()
export class CounterpartyDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly contracts: CounterpartyContractService,
    private readonly amendments: CounterpartyContractAmendmentService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, ownerType: string, ownerId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertOwnerExists(tenantId, membershipId, organizationId, ownerType, ownerId);
    return this.prisma.counterpartyDocument.findMany({
      where: { tenantId, ownerType, ownerId, active: true },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async upload(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    ownerType: string,
    ownerId: string,
    userId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    notes?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!OWNER_TYPES.includes(ownerType)) throw new ValidationAppError(`Unknown document owner type: ${ownerType}`);
    await this.assertOwnerExists(tenantId, membershipId, organizationId, ownerType, ownerId);

    if (!file) throw new ValidationAppError('No file was uploaded');
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new ValidationAppError(`File type not allowed: ${file.mimetype}. Allowed: PDF, Word, Excel, JPEG, PNG.`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new ValidationAppError(`File exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`);
    }

    const latest = await this.prisma.counterpartyDocument.findFirst({
      where: { tenantId, ownerType, ownerId },
      orderBy: { documentVersion: 'desc' },
    });
    const documentVersion = (latest?.documentVersion ?? 0) + 1;

    const dir = join(STORAGE_ROOT, tenantId);
    await mkdir(dir, { recursive: true });
    const storageKey = `${tenantId}/${randomUUID()}-${this.sanitizeFileName(file.originalname)}`;
    await writeFile(join(STORAGE_ROOT, storageKey), file.buffer);

    const doc = await this.prisma.counterpartyDocument.create({
      data: {
        tenantId, organizationId, ownerType, ownerId,
        fileName: file.originalname, fileType: file.mimetype, fileSize: file.size,
        storageKey, documentVersion, notes, uploadedBy: userId,
      },
    });

    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_DOCUMENT_UPLOADED', entityType: ownerType === 'CONTRACT' ? 'CounterpartyContract' : 'CounterpartyContractAmendment',
      entityId: ownerId, action: 'CREATE', userId, newValues: { documentId: doc.id, fileName: doc.fileName, version: documentVersion },
    });
    return doc;
  }

  async getFile(tenantId: string, membershipId: string, organizationId: string, documentId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const doc = await this.prisma.counterpartyDocument.findFirst({ where: { id: documentId, tenantId, organizationId, active: true } });
    if (!doc) throw new NotFoundAppError('CounterpartyDocument', documentId);
    const buffer = await readFile(join(STORAGE_ROOT, doc.storageKey));
    return { doc, buffer };
  }

  async delete(tenantId: string, membershipId: string, organizationId: string, documentId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const doc = await this.prisma.counterpartyDocument.findFirst({ where: { id: documentId, tenantId, organizationId, active: true } });
    if (!doc) throw new NotFoundAppError('CounterpartyDocument', documentId);

    await this.prisma.counterpartyDocument.update({ where: { id: documentId }, data: { active: false } });
    try {
      await unlink(join(STORAGE_ROOT, doc.storageKey));
    } catch {
      // File already gone from disk — the metadata soft-delete is what matters.
    }
    await this.audit.record({
      tenantId, eventType: 'COUNTERPARTY_DOCUMENT_DELETED', entityType: doc.ownerType === 'CONTRACT' ? 'CounterpartyContract' : 'CounterpartyContractAmendment',
      entityId: doc.ownerId, action: 'DELETE', userId, newValues: { documentId, fileName: doc.fileName },
    });
    return { deleted: true };
  }

  // -- helpers ----------------------------------------------------------------

  private async assertOwnerExists(tenantId: string, membershipId: string, organizationId: string, ownerType: string, ownerId: string) {
    if (ownerType === 'CONTRACT') {
      await this.contracts.get(tenantId, membershipId, organizationId, ownerId);
    } else if (ownerType === 'CONTRACT_AMENDMENT') {
      await this.amendments.get(tenantId, membershipId, organizationId, ownerId);
    } else {
      throw new ValidationAppError(`Unknown document owner type: ${ownerType}`);
    }
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-150);
  }
}
