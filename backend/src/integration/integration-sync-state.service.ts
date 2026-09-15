import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

export type ConflictResolutionPolicy = 'ERP_WINS' | 'EXTERNAL_WINS' | 'FIELD_OWNERSHIP' | 'MANUAL' | 'MERGE_SAFE_FIELDS';

/**
 * ExternalSyncStateService (docx spec Phase 28, sections 97-100, 222).
 * `detectConflict` NEVER silently applies last-write-wins (spec section
 * 99/238 — an explicit prohibition) — both sides having changed since
 * `lastSyncedAt` always produces `conflictStatus: 'DETECTED'` and the
 * caller must call `resolve` with an explicit policy before the sync
 * state moves forward. `MANUAL` leaves the row in `CONFLICT` until a
 * human resolves it via `resolve`.
 */
@Injectable()
export class ExternalSyncStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async upsertBaseline(tenantId: string, input: { internalEntityType: string; internalEntityId: string; externalSystem: string; externalId: string; internalVersion?: number; externalVersionTag?: string }) {
    return this.prisma.externalSyncState.upsert({
      where: { tenantId_internalEntityType_internalEntityId_externalSystem: { tenantId, internalEntityType: input.internalEntityType, internalEntityId: input.internalEntityId, externalSystem: input.externalSystem } },
      create: { tenantId, internalEntityType: input.internalEntityType, internalEntityId: input.internalEntityId, externalSystem: input.externalSystem, externalId: input.externalId, internalVersion: input.internalVersion, externalVersionTag: input.externalVersionTag, lastSyncedAt: new Date(), syncStatus: 'SYNCED' },
      update: { externalId: input.externalId, internalVersion: input.internalVersion, externalVersionTag: input.externalVersionTag, lastSyncedAt: new Date(), syncStatus: 'SYNCED', conflictStatus: null },
    });
  }

  /** Optimistic external concurrency (spec section 98): compares the
   * CURRENT internal version and external version/etag against what was
   * recorded at last sync. Both differing => conflict; only one
   * differing => a clean one-directional update, never a conflict. */
  async detectConflict(tenantId: string, internalEntityType: string, internalEntityId: string, externalSystem: string, currentInternalVersion: number, currentExternalVersionTag: string) {
    const state = await this.prisma.externalSyncState.findFirst({ where: { tenantId, internalEntityType, internalEntityId, externalSystem } });
    if (!state) return { hasConflict: false, state: null };

    const internalChanged = state.internalVersion !== null && state.internalVersion !== currentInternalVersion;
    const externalChanged = state.externalVersionTag !== null && state.externalVersionTag !== currentExternalVersionTag;

    if (internalChanged && externalChanged) {
      const updated = await this.prisma.externalSyncState.update({ where: { id: state.id }, data: { syncStatus: 'CONFLICT', conflictStatus: 'DETECTED' } });
      await this.audit.record({ tenantId, eventType: 'MessageReceived', eventCategory: 'INTEGRATION', entityType: 'ExternalSyncState', entityId: state.id, operation: 'UPDATE', action: 'CONFLICT_DETECTED', userId: null, metadata: { internalEntityType, internalEntityId, externalSystem } });
      return { hasConflict: true, state: updated };
    }
    return { hasConflict: false, state };
  }

  /** Resolving a conflict always requires an explicit policy (never a
   * default) — `MANUAL` just records the decision-maker's choice of
   * which side's data was actually kept, `FIELD_OWNERSHIP`/
   * `MERGE_SAFE_FIELDS` are recorded as the resolution rationale but the
   * actual field-level merge is the caller's own responsibility (this
   * service tracks sync state, not field ownership rules — see
   * `IntegrationFieldOwnershipRule`, folded into
   * `IntegrationMappingVersion` policy metadata rather than a new
   * table, disclosed docs/INTEGRATION_PLATFORM.md). */
  async resolve(tenantId: string, userId: string, id: string, policy: ConflictResolutionPolicy, newInternalVersion: number, newExternalVersionTag: string) {
    const state = await this.prisma.externalSyncState.findFirst({ where: { id, tenantId } });
    if (!state) throw new NotFoundAppError('ExternalSyncState', id);
    if (state.conflictStatus !== 'DETECTED') throw new ConflictAppError(`Sync state ${id} has no pending conflict`);

    const updated = await this.prisma.externalSyncState.update({
      where: { id },
      data: { syncStatus: 'SYNCED', conflictStatus: 'RESOLVED', conflictResolution: policy, internalVersion: newInternalVersion, externalVersionTag: newExternalVersionTag, lastSyncedAt: new Date() },
    });
    await this.audit.record({ tenantId, eventType: 'MessageReceived', eventCategory: 'INTEGRATION', entityType: 'ExternalSyncState', entityId: id, operation: 'UPDATE', action: 'CONFLICT_RESOLVED', userId, metadata: { policy } });
    return updated;
  }

  listConflicts(tenantId: string) {
    return this.prisma.externalSyncState.findMany({ where: { tenantId, syncStatus: 'CONFLICT' } });
  }
}
