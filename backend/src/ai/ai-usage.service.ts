import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError } from '../common/errors/app-error';

/**
 * AIUsageService (docx spec Phase 29, sections 122-124, 232). Budget
 * enforcement is a GOVERNED FALLBACK (spec section 232 — "expected
 * governed fallback/limit handling without affecting ERP operations"):
 * hitting a department's monthly budget blocks further AI usage for
 * that department/capability, never anything else in the ERP.
 */
@Injectable()
export class AIUsageService {
  constructor(private readonly prisma: PrismaService) {}

  record(tenantId: string, input: { interactionId?: string; userId?: string; departmentId?: string; capabilityCode: string; modelVersionId?: string; inputTokens?: number; outputTokens?: number; estimatedCost?: Decimal; toolExecutionCost?: Decimal }) {
    return this.prisma.aIUsageRecord.create({
      data: {
        tenantId,
        interactionId: input.interactionId,
        userId: input.userId,
        departmentId: input.departmentId,
        capabilityCode: input.capabilityCode,
        modelVersionId: input.modelVersionId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimatedCost: (input.estimatedCost ?? new Decimal(0)).toString(),
        toolExecutionCost: (input.toolExecutionCost ?? new Decimal(0)).toString(),
      },
    });
  }

  async monthToDateCost(tenantId: string, departmentId: string): Promise<Decimal> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.aIUsageRecord.aggregate({ where: { tenantId, departmentId, recordedAt: { gte: monthStart } }, _sum: { estimatedCost: true, toolExecutionCost: true } });
    return new Decimal((agg._sum.estimatedCost ?? 0).toString()).plus((agg._sum.toolExecutionCost ?? 0).toString());
  }

  async assertWithinBudget(tenantId: string, departmentId: string, monthlyBudget: Decimal) {
    const spent = await this.monthToDateCost(tenantId, departmentId);
    if (spent.gte(monthlyBudget)) {
      throw new ConflictAppError(`AI usage budget exceeded for department ${departmentId}: ${spent.toFixed(2)} >= ${monthlyBudget.toFixed(2)} — core ERP is unaffected, only further AI usage is paused`);
    }
    return { spent, remaining: monthlyBudget.minus(spent) };
  }

  summary(tenantId: string, capabilityCode?: string) {
    return this.prisma.aIUsageRecord.groupBy({ by: ['capabilityCode'], where: { tenantId, capabilityCode }, _sum: { estimatedCost: true, toolExecutionCost: true, inputTokens: true, outputTokens: true }, _count: true });
  }
}
