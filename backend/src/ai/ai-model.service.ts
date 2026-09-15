import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/**
 * AIModelService (docx spec Phase 29, sections 6-10, 139). A model
 * version cannot be activated for production until an
 * `AIEvaluationRun` referencing it has `passed: true` (spec section
 * 139's "model upgrade gate") — enforced here by requiring the caller
 * to have already recorded a passing run (`AIEvaluationService.recordRun`
 * sets `AIModelVersion.evaluationStatus`); this service refuses to flip
 * `status` to `ACTIVE` otherwise, with NO override path.
 */
@Injectable()
export class AIModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listProfiles(tenantId: string) {
    return this.prisma.aIModelProfile.findMany({ where: { tenantId }, include: { versions: true } });
  }

  createProfile(tenantId: string, input: { code: string; name: string; fallbackProfileId?: string }) {
    return this.prisma.aIModelProfile.create({ data: { tenantId, ...input } });
  }

  async createVersion(tenantId: string, modelProfileId: string, input: { providerId: string; externalModelId: string; effectiveFrom: Date; effectiveTo?: Date; contextLimitTokens?: number; supportsStructuredOutput?: boolean; supportsToolUse?: boolean }) {
    const profile = await this.prisma.aIModelProfile.findFirst({ where: { id: modelProfileId, tenantId } });
    if (!profile) throw new NotFoundAppError('AIModelProfile', modelProfileId);
    return this.prisma.aIModelVersion.create({
      data: { tenantId, modelProfileId, providerId: input.providerId, externalModelId: input.externalModelId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, contextLimitTokens: input.contextLimitTokens, supportsStructuredOutput: input.supportsStructuredOutput ?? false, supportsToolUse: input.supportsToolUse ?? false, status: 'DRAFT' },
    });
  }

  /** Activation is the ONLY thing that changes what "the production
   * model" means for a profile — historical interactions keep pointing
   * at whichever version they actually ran against (spec section 217),
   * never silently repointed. */
  async activate(tenantId: string, userId: string, versionId: string) {
    const version = await this.get(tenantId, versionId);
    if (version.evaluationStatus !== 'PASSED') {
      throw new ConflictAppError(`Model version ${versionId} cannot be activated: evaluation status is ${version.evaluationStatus}, not PASSED`);
    }
    const activated = await this.prisma.runInTransaction(async (tx) => {
      await tx.aIModelVersion.updateMany({ where: { tenantId, modelProfileId: version.modelProfileId, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
      return tx.aIModelVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE', approvedBy: userId } });
    });
    await this.audit.record({ tenantId, eventType: 'ContractVersionChanged', eventCategory: 'AI', entityType: 'AIModelVersion', entityId: versionId, operation: 'UPDATE', action: 'ACTIVATE', userId, metadata: { modelProfileId: version.modelProfileId, externalModelId: version.externalModelId } });
    return activated;
  }

  /** Kill switch (spec section 154) — immediate, no redeploy. */
  async disable(tenantId: string, userId: string, versionId: string) {
    await this.get(tenantId, versionId);
    const updated = await this.prisma.aIModelVersion.update({ where: { id: versionId }, data: { status: 'RETIRED' } });
    await this.audit.record({ tenantId, eventType: 'ContractVersionChanged', eventCategory: 'AI', entityType: 'AIModelVersion', entityId: versionId, operation: 'UPDATE', action: 'DISABLE', userId, metadata: {} });
    return updated;
  }

  /** Resolves the active version for a profile, falling back to an
   * explicitly configured fallback profile's own active version if the
   * primary has none available (spec section 10 — explicit, approved
   * fallback only, never a silent unapproved provider switch). */
  async resolveActiveVersion(tenantId: string, modelProfileCode: string) {
    const profile = await this.prisma.aIModelProfile.findFirst({ where: { tenantId, code: modelProfileCode, active: true } });
    if (!profile) throw new NotFoundAppError('AIModelProfile', modelProfileCode);

    const active = await this.prisma.aIModelVersion.findFirst({ where: { tenantId, modelProfileId: profile.id, status: 'ACTIVE' } });
    if (active) return active;

    if (profile.fallbackProfileId) {
      const fallbackProfile = await this.prisma.aIModelProfile.findFirst({ where: { id: profile.fallbackProfileId, tenantId } });
      if (fallbackProfile) {
        const fallbackVersion = await this.prisma.aIModelVersion.findFirst({ where: { tenantId, modelProfileId: fallbackProfile.id, status: 'ACTIVE' } });
        if (fallbackVersion) return fallbackVersion;
      }
    }
    throw new ValidationAppError(`No active model version for profile '${modelProfileCode}' and no working fallback — failing gracefully rather than guessing a provider`);
  }

  private async get(tenantId: string, id: string) {
    const row = await this.prisma.aIModelVersion.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('AIModelVersion', id);
    return row;
  }
}
