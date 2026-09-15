import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AICapabilityService } from './ai-capability.service';
import { AIRecommendationService, CreateRecommendationInput } from './ai-recommendation.service';

/**
 * AIBatchService (docx spec Phase 29, sections 126-128, 231). Batch AI
 * runs (duplicate-supplier scans, margin-anomaly scans, ...) NEVER
 * mutate business data directly — `runBatch` only ever produces
 * `AIRecommendation` rows, each independently reviewable (spec section
 * 128), through the exact same `AIRecommendationService.create` path a
 * live interaction uses.
 */
@Injectable()
export class AIBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: AICapabilityService,
    private readonly recommendations: AIRecommendationService,
  ) {}

  async runBatch(
    tenantId: string,
    input: { code: string; capabilityCode: string; organizationId?: string; requestedBy: string; hasPermission: (code: string) => boolean; candidates: CreateRecommendationInput[] },
  ) {
    await this.capabilities.assertUsable(tenantId, input.capabilityCode, input.hasPermission);

    const run = await this.prisma.aIBatchRun.create({
      data: { tenantId, organizationId: input.organizationId, code: input.code, capabilityCode: input.capabilityCode, status: 'RUNNING', recordsScanned: input.candidates.length, requestedBy: input.requestedBy },
    });

    let created = 0;
    for (const candidate of input.candidates) {
      await this.recommendations.create(tenantId, null, { ...candidate, category: candidate.category });
      created++;
    }

    return this.prisma.aIBatchRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', recommendationsCreated: created, completedAt: new Date() } });
  }

  list(tenantId: string) {
    return this.prisma.aIBatchRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }
}
