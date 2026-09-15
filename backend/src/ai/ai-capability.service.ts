import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, PermissionDeniedError, ConflictAppError } from '../common/errors/app-error';

/**
 * AICapabilityService (docx spec Phase 29, sections 11-12, 153).
 * `assertUsable` is the capability-level kill switch (spec section 153
 * — "disable AI_PAYMENT_PROPOSAL while keeping AI_FINANCIAL_QA") AND
 * the permission gate in one call: a disabled capability or a user
 * missing its `requiredPermission` both fail loudly before any
 * retrieval/model call happens.
 */
@Injectable()
export class AICapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.aICapability.findMany({ where: { tenantId } });
  }

  create(tenantId: string, input: { code: string; name: string; riskLevel: string; requiredPermission?: string }) {
    return this.prisma.aICapability.create({ data: { tenantId, ...input } });
  }

  async setEnabled(tenantId: string, id: string, enabled: boolean) {
    const row = await this.prisma.aICapability.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('AICapability', id);
    return this.prisma.aICapability.update({ where: { id }, data: { enabled } });
  }

  async assertUsable(tenantId: string, capabilityCode: string, hasPermission: (code: string) => boolean) {
    const capability = await this.prisma.aICapability.findFirst({ where: { tenantId, code: capabilityCode } });
    if (!capability) throw new NotFoundAppError('AICapability', capabilityCode);
    if (!capability.enabled) throw new ConflictAppError(`AI capability '${capabilityCode}' is currently disabled`);
    if (capability.requiredPermission && !hasPermission(capability.requiredPermission)) {
      throw new PermissionDeniedError(capability.requiredPermission);
    }
    return capability;
  }
}
