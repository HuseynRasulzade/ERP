import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';

/**
 * AIProviderService (docx spec Phase 29, sections 5, 119). Secrets
 * follow Phase 28's own secret-reference boundary exactly —
 * `credentialReferenceId` points at an `IntegrationCredentialReference`
 * (never a second secret store), so a provider's actual API key/token
 * never passes through this service or its audit trail.
 */
@Injectable()
export class AIProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.prisma.aIProvider.findMany({ where: { tenantId } });
  }

  async create(tenantId: string, userId: string, input: { code: string; name: string; providerType: string; endpointReference?: string; credentialReferenceId?: string; dataProcessingPolicy?: Record<string, unknown>; dataResidency?: string }) {
    if (!input.code || !input.providerType) throw new ValidationAppError('code and providerType are required');
    const row = await this.prisma.aIProvider.create({
      data: { tenantId, code: input.code, name: input.name, providerType: input.providerType, endpointReference: input.endpointReference, credentialReferenceId: input.credentialReferenceId, dataProcessingPolicy: (input.dataProcessingPolicy ?? null) as object | undefined, dataResidency: input.dataResidency },
    });
    await this.audit.record({ tenantId, eventType: 'EndpointCreated', eventCategory: 'AI', entityType: 'AIProvider', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId, metadata: { code: input.code, providerType: input.providerType } });
    return row;
  }

  async setEnabled(tenantId: string, userId: string, id: string, enabled: boolean) {
    const row = await this.get(tenantId, id);
    const updated = await this.prisma.aIProvider.update({ where: { id }, data: { enabled, status: enabled ? 'ACTIVE' : 'DISABLED' } });
    await this.audit.record({ tenantId, eventType: 'EndpointDisabled', eventCategory: 'AI', entityType: 'AIProvider', entityId: id, operation: 'UPDATE', action: enabled ? 'ENABLE' : 'DISABLE', userId, metadata: { previousStatus: row.status } });
    return updated;
  }

  private async get(tenantId: string, id: string) {
    const row = await this.prisma.aIProvider.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('AIProvider', id);
    return row;
  }
}
