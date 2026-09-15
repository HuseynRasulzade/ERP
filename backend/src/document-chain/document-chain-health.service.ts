import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DocumentChainHealthService — a rebuildable-projection health rollup
 * (same pattern as every prior phase's own `*HealthService`: computed
 * live, never stored) surfacing operational risk in the document chain
 * engine: stale/expired proposals, expired-but-not-swept claims, and
 * unresolved transformation exceptions.
 */
@Injectable()
export class DocumentChainHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(tenantId: string) {
    const [staleProposals, generatedProposals, expiredClaimsNotSwept, unresolvedExceptions, blockingExceptions, activeTransformations] = await Promise.all([
      this.prisma.documentCreationProposal.count({ where: { tenantId, status: 'STALE' } }),
      this.prisma.documentCreationProposal.count({ where: { tenantId, status: 'GENERATED' } }),
      this.prisma.sourceCreationClaim.count({ where: { tenantId, status: 'ACTIVE', expiresAt: { lt: new Date() } } }),
      this.prisma.transformationException.count({ where: { tenantId, resolved: false } }),
      this.prisma.transformationException.count({ where: { tenantId, resolved: false, severity: 'BLOCKING' } }),
      this.prisma.documentTransformationVersion.count({ where: { tenantId, status: 'ACTIVE' } }),
    ]);

    return {
      staleProposals,
      pendingProposals: generatedProposals,
      expiredClaimsNotSwept,
      unresolvedExceptions,
      blockingExceptions,
      activeTransformations,
      healthy: staleProposals === 0 && expiredClaimsNotSwept === 0 && blockingExceptions === 0,
    };
  }
}
