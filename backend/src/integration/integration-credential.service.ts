import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError, ConflictAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/**
 * IntegrationCredentialService (docx spec Phase 28, sections 10-14).
 * Stores ONLY opaque `secretReferenceId` strings — the actual secret
 * value lives in an external vault/secret manager this backend does not
 * implement (out of scope; a real deployment wires this to whatever
 * secret store the platform standardizes on). Every mutation is audited
 * WITHOUT the secret reference's own resolved value ever appearing in
 * the audit metadata (spec section 13's own "never log token/key" — the
 * reference ID itself is just an opaque pointer, never the secret, so
 * it is safe to record, but this service never accepts or stores a
 * field literally named "secret"/"token"/"password").
 */
@Injectable()
export class IntegrationCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.integrationCredentialReference.findMany({
      where: { tenantId },
      select: { id: true, code: true, credentialType: true, environment: true, status: true, expiresAt: true, lastRotatedAt: true, createdAt: true },
    });
  }

  async create(tenantId: string, userId: string, input: { code: string; credentialType: string; environment?: string; currentSecretReferenceId: string; expiresAt?: Date }) {
    if (!input.currentSecretReferenceId) throw new ValidationAppError('currentSecretReferenceId is required (the actual secret is never accepted here)');
    const row = await this.prisma.integrationCredentialReference.create({
      data: {
        tenantId,
        code: input.code,
        credentialType: input.credentialType,
        environment: input.environment ?? 'TEST',
        currentSecretReferenceId: input.currentSecretReferenceId,
        expiresAt: input.expiresAt,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'CredentialCreated', eventCategory: 'INTEGRATION', entityType: 'IntegrationCredentialReference', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { code: input.code, credentialType: input.credentialType, environment: row.environment } });
    return row;
  }

  /** Rotation (spec section 14): stages `nextSecretReferenceId` and a
   * transition date, then a separate `completeRotation` call swaps it
   * in — this two-step shape lets a caller cut over to the new secret
   * gradually (e.g. across all endpoints referencing it) with an
   * explicit rollback point rather than an instant, all-or-nothing swap. */
  async startRotation(tenantId: string, userId: string, id: string, nextSecretReferenceId: string, transitionEffectiveAt: Date) {
    const credential = await this.get(tenantId, id);
    const updated = await this.prisma.integrationCredentialReference.update({
      where: { id },
      data: { nextSecretReferenceId, transitionEffectiveAt, status: 'ROTATING' },
    });
    await this.audit.record({ tenantId, eventType: 'CredentialRotationStarted', eventCategory: 'INTEGRATION', entityType: 'IntegrationCredentialReference', entityId: id, operation: 'UPDATE', action: 'UPDATE', userId, metadata: { previousStatus: credential.status, transitionEffectiveAt } });
    return updated;
  }

  async completeRotation(tenantId: string, userId: string, id: string) {
    const credential = await this.get(tenantId, id);
    if (!credential.nextSecretReferenceId) throw new ConflictAppError(`Credential ${id} has no pending rotation`);
    const updated = await this.prisma.integrationCredentialReference.update({
      where: { id },
      data: { currentSecretReferenceId: credential.nextSecretReferenceId, nextSecretReferenceId: null, transitionEffectiveAt: null, status: 'ACTIVE', lastRotatedAt: new Date() },
    });
    await this.audit.record({ tenantId, eventType: 'CredentialRotated', eventCategory: 'INTEGRATION', entityType: 'IntegrationCredentialReference', entityId: id, operation: 'UPDATE', action: 'UPDATE', userId, metadata: {} });
    return updated;
  }

  /** Rollback (spec section 14) — if a rotation must be undone before
   * completion, this simply cancels the staged transition; the current
   * (still-active) secret reference is untouched. */
  async rollbackRotation(tenantId: string, userId: string, id: string) {
    await this.get(tenantId, id);
    const updated = await this.prisma.integrationCredentialReference.update({ where: { id }, data: { nextSecretReferenceId: null, transitionEffectiveAt: null, status: 'ACTIVE' } });
    await this.audit.record({ tenantId, eventType: 'CredentialRotationRolledBack', eventCategory: 'INTEGRATION', entityType: 'IntegrationCredentialReference', entityId: id, operation: 'UPDATE', action: 'UPDATE', userId, metadata: {} });
    return updated;
  }

  async disable(tenantId: string, userId: string, id: string) {
    await this.get(tenantId, id);
    const updated = await this.prisma.integrationCredentialReference.update({ where: { id }, data: { status: 'DISABLED' } });
    await this.audit.record({ tenantId, eventType: 'CredentialDisabled', eventCategory: 'INTEGRATION', entityType: 'IntegrationCredentialReference', entityId: id, operation: 'UPDATE', action: 'UPDATE', userId, metadata: {} });
    return updated;
  }

  private async get(tenantId: string, id: string) {
    const row = await this.prisma.integrationCredentialReference.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('IntegrationCredentialReference', id);
    return row;
  }

  /** Used by `IntegrationHealthService` (spec section 109 — expired
   * credential health check). */
  async listExpiring(tenantId: string, withinDays: number) {
    const threshold = new Date(Date.now() + withinDays * 86_400_000);
    return this.prisma.integrationCredentialReference.findMany({
      where: { tenantId, status: { not: 'DISABLED' }, expiresAt: { lte: threshold } },
      select: { id: true, code: true, expiresAt: true, status: true },
    });
  }
}
