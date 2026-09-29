import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateAllocationRuleDto } from './dto/expenses.dto';

/**
 * AllocationRuleService (docx spec Phase 20 sections 64-65, 73-74) —
 * DIRECT and DRIVER_BASED are the two types this build fully implements
 * (spec's own stated minimum); STEP_DOWN/RECIPROCAL_FUTURE are not
 * implemented (disclosed simplification, see docs/EXPENSES.md).
 *
 * Cycle detection (spec section 74) covers the two concrete cases the
 * spec itself gives: a rule may never target its own source cost
 * center, and two rules may never point directly at each other
 * (A allocates to B, B allocates back to A) — a full topological/
 * multi-hop cycle detector is out of scope for this phase.
 */
@Injectable()
export class AllocationRuleService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, organizationId: string) {
    return this.prisma.allocationRule.findMany({ where: { tenantId, organizationId }, orderBy: { code: 'asc' } });
  }

  async get(tenantId: string, organizationId: string, id: string) {
    const row = await this.prisma.allocationRule.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('AllocationRule', id);
    return row;
  }

  async create(tenantId: string, organizationId: string, dto: CreateAllocationRuleDto) {
    if (dto.targets.length === 0) throw new ValidationAppError('An allocation rule must have at least one target');
    if (dto.allocationType === 'DIRECT' && dto.targets.length !== 1)
      throw new ValidationAppError('A DIRECT allocation rule must have exactly one target');
    if (dto.allocationType === 'DRIVER_BASED' && !dto.allocationDriverId)
      throw new ValidationAppError('A DRIVER_BASED allocation rule requires an allocationDriverId');

    const targetCostCenterIds = dto.targets.filter((t) => t.targetType === 'COST_CENTER').map((t) => t.targetId);
    if (targetCostCenterIds.includes(dto.sourceCostCenterId))
      throw new ValidationAppError('An allocation rule cannot target its own source cost center (spec section 74)');

    if (targetCostCenterIds.length > 0) {
      const reciprocal = await this.prisma.allocationRule.findFirst({
        where: {
          tenantId,
          organizationId,
          status: 'ACTIVE',
          sourceCostCenterId: { in: targetCostCenterIds },
        },
      });
      if (reciprocal) {
        const reciprocalTargets = (reciprocal.targets as Array<{ targetType: string; targetId: string }>) ?? [];
        if (reciprocalTargets.some((t) => t.targetType === 'COST_CENTER' && t.targetId === dto.sourceCostCenterId)) {
          throw new ValidationAppError(
            `Reciprocal allocation cycle detected: rule ${reciprocal.code} already allocates back to this rule's source cost center`,
          );
        }
      }
    }

    return this.prisma.allocationRule.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        sourceCostCenterId: dto.sourceCostCenterId,
        expenseCategoryFilter: dto.expenseCategoryFilter,
        allocationType: dto.allocationType,
        allocationDriverId: dto.allocationDriverId,
        targets: dto.targets as any,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
      },
    });
  }

  async listActiveForPeriod(tenantId: string, organizationId: string, asOfDate: Date) {
    const rows = await this.prisma.allocationRule.findMany({
      where: { tenantId, organizationId, status: 'ACTIVE', effectiveFrom: { lte: asOfDate } },
    });
    return rows.filter((r) => !r.effectiveTo || r.effectiveTo >= asOfDate);
  }
}
