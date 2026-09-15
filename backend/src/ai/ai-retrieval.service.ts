import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, PermissionDeniedError, ValidationAppError } from '../common/errors/app-error';

export interface RetrievedEvidenceItem {
  evidenceType: string;
  entityType: string;
  entityId: string;
  asOf?: Date;
  versionTag?: string;
  summary?: string;
  data: unknown;
}

/** A structured retrieval source ALWAYS goes through the owning
 * module's own governed service (spec section 21) — never a raw table
 * scan. No adapters ship pre-registered (same pattern as every other
 * registry in this codebase); an unregistered source code cannot be
 * retrieved from. */
export interface StructuredRetrievalAdapter {
  readonly sourceCode: string;
  retrieve(tenantId: string, organizationId: string | undefined, query: Record<string, unknown>, hasPermission: (code: string) => boolean): Promise<RetrievedEvidenceItem[]>;
}

/**
 * AIRetrievalService (docx spec Phase 29, sections 20-27). Enforces the
 * retrieval policy's `allowedSourceCodes`/`maxAgeMinutes`/
 * `requiredPermission` BEFORE ever calling an adapter — a source not on
 * the policy's allow-list, or one whose required permission the caller
 * lacks, is refused outright rather than silently omitted (silence
 * would let a user believe "no evidence exists" instead of "you cannot
 * see this").
 */
@Injectable()
export class AIRetrievalService {
  private readonly adapters = new Map<string, StructuredRetrievalAdapter>();

  constructor(private readonly prisma: PrismaService) {}

  registerAdapter(adapter: StructuredRetrievalAdapter) {
    this.adapters.set(adapter.sourceCode, adapter);
  }

  createSource(tenantId: string, input: { code: string; name: string; sourceKind?: string; ownerModule?: string }) {
    return this.prisma.aIRetrievalSource.create({ data: { tenantId, code: input.code, name: input.name, sourceKind: input.sourceKind ?? 'STRUCTURED', ownerModule: input.ownerModule } });
  }

  createPolicy(tenantId: string, input: { code: string; allowedSourceCodes: string[]; maxAgeMinutes?: number; requiredPermission?: string; sensitiveHandling?: string; requireCitations?: boolean }) {
    return this.prisma.aIRetrievalPolicy.create({
      data: { tenantId, code: input.code, allowedSourceCodes: input.allowedSourceCodes as object, maxAgeMinutes: input.maxAgeMinutes, requiredPermission: input.requiredPermission, sensitiveHandling: input.sensitiveHandling ?? 'BLOCK', requireCitations: input.requireCitations ?? true },
    });
  }

  async retrieve(tenantId: string, policyCode: string, sourceCode: string, organizationId: string | undefined, query: Record<string, unknown>, hasPermission: (code: string) => boolean): Promise<RetrievedEvidenceItem[]> {
    const policy = await this.prisma.aIRetrievalPolicy.findFirst({ where: { tenantId, code: policyCode } });
    if (!policy) throw new NotFoundAppError('AIRetrievalPolicy', policyCode);

    const allowed = policy.allowedSourceCodes as unknown as string[];
    if (!allowed.includes(sourceCode)) throw new ValidationAppError(`Retrieval policy '${policyCode}' does not allow source '${sourceCode}'`);
    if (policy.requiredPermission && !hasPermission(policy.requiredPermission)) throw new PermissionDeniedError(policy.requiredPermission);

    const adapter = this.adapters.get(sourceCode);
    if (!adapter) throw new ValidationAppError(`No retrieval adapter registered for source '${sourceCode}'`);

    const items = await adapter.retrieve(tenantId, organizationId, query, hasPermission);

    if (policy.maxAgeMinutes) {
      const cutoff = new Date(Date.now() - policy.maxAgeMinutes * 60_000);
      const stale = items.filter((i) => i.asOf && i.asOf < cutoff);
      if (stale.length > 0) {
        // Data freshness is surfaced, not hidden (spec section 26-27) — a
        // stale item is still returned but flagged so the interaction
        // layer can label the eventual answer provisional.
        stale.forEach((i) => (i.summary = `${i.summary ?? ''} [STALE: older than ${policy.maxAgeMinutes} minutes]`.trim()));
      }
    }

    return items;
  }
}
