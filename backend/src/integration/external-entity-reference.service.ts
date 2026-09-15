import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/**
 * ExternalEntityReferenceService (docx spec Phase 28, sections 39-42,
 * 46). External IDs are NEVER used as the internal primary key (spec
 * section 40) — this table is purely a lookup layer. Uniqueness is
 * enforced at (tenant, externalSystem, externalEntityType,
 * externalEntityId) scoped to ACTIVE rows only (spec section 42) —
 * checked in application code rather than a DB partial-unique index so
 * a superseded/revoked reference can be replaced without a migration.
 */
@Injectable()
export class ExternalEntityReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolve(tenantId: string, externalSystem: string, externalEntityType: string, externalEntityId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    return client.externalEntityReference.findFirst({ where: { tenantId, externalSystem, externalEntityType, externalEntityId, status: 'ACTIVE' } });
  }

  async listForInternalEntity(tenantId: string, internalEntityType: string, internalEntityId: string) {
    return this.prisma.externalEntityReference.findMany({ where: { tenantId, internalEntityType, internalEntityId }, orderBy: { createdAt: 'desc' } });
  }

  /** Creates a new active reference — spec section 41's own "one ERP
   * customer may have a CRM ID, a Marketplace ID, a Bank Beneficiary ID,
   * a Tax Portal ID": distinct (externalSystem, externalEntityType)
   * pairs never collide with each other, only an exact repeat does. */
  async link(
    tenantId: string,
    userId: string,
    input: { organizationId?: string; externalSystem: string; externalEntityType: string; externalEntityId: string; internalEntityType: string; internalEntityId: string; matchMethod?: string; matchConfidence?: number },
    tx?: PrismaTransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const existing = await this.resolve(tenantId, input.externalSystem, input.externalEntityType, input.externalEntityId, tx);
    if (existing) {
      if (existing.internalEntityId === input.internalEntityId) return existing;
      throw new ConflictAppError(`External ${input.externalSystem}/${input.externalEntityType}/${input.externalEntityId} is already linked to a different internal entity (${existing.internalEntityType}:${existing.internalEntityId})`);
    }

    const row = await client.externalEntityReference.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        externalSystem: input.externalSystem,
        externalEntityType: input.externalEntityType,
        externalEntityId: input.externalEntityId,
        internalEntityType: input.internalEntityType,
        internalEntityId: input.internalEntityId,
        matchMethod: input.matchMethod ?? 'MANUAL',
        matchConfidence: input.matchConfidence,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: input.matchMethod === 'MANUAL' || !input.matchMethod ? 'ManualMatchCreated' : 'EntityMatched', eventCategory: 'INTEGRATION', entityType: 'ExternalEntityReference', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { externalSystem: input.externalSystem, externalEntityType: input.externalEntityType, externalEntityId: input.externalEntityId, internalEntityType: input.internalEntityType, internalEntityId: input.internalEntityId } }, tx);
    return row;
  }

  /** Manual unlink (spec section 46 — fully audited). Marks the
   * reference REVOKED rather than deleting it — history is preserved. */
  async unlink(tenantId: string, userId: string, id: string) {
    const row = await this.prisma.externalEntityReference.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('ExternalEntityReference', id);
    const updated = await this.prisma.externalEntityReference.update({ where: { id }, data: { status: 'REVOKED' } });
    await this.audit.record({ tenantId, eventType: 'ManualMatchCreated', eventCategory: 'INTEGRATION', entityType: 'ExternalEntityReference', entityId: id, operation: 'UPDATE', action: 'UNLINK', userId, metadata: { externalSystem: row.externalSystem, externalEntityId: row.externalEntityId } });
    return updated;
  }
}
