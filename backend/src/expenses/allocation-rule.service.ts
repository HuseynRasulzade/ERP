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
 * Cycle detection (spec section 74) treats every ACTIVE rule's
 * sourceCostCenterId -> COST_CENTER target(s) as a directed edge between
 * cost centers and runs a DFS (visited/recursion-stack) over the whole
 * graph, including the edge(s) the new rule would add, before the rule
 * is persisted. This rejects a self-loop, a direct two-rule reciprocal
 * (A -> B, B -> A), and any longer cycle (A -> B -> C -> A, however many
 * hops) the same way — one general algorithm, no separate pairwise-only
 * path.
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

    await this.assertNoCycle(tenantId, organizationId, dto.sourceCostCenterId, targetCostCenterIds);

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

  /**
   * Builds the directed graph of every ACTIVE rule for this organization
   * (edge: sourceCostCenterId -> each COST_CENTER target), adds the
   * edge(s) the candidate rule would introduce, and runs a DFS with a
   * visited set + recursion stack to detect any cycle in the resulting
   * graph — a self-loop, a direct two-rule reciprocal, or an arbitrarily
   * long N-node cycle (A -> B -> C -> A) are all just cycles in this same
   * graph, so one general check covers every case (spec section 74).
   * The organization's cost-center graph is small and bounded, so a
   * plain DFS is sufficient — no graph library needed.
   */
  private async assertNoCycle(
    tenantId: string,
    organizationId: string,
    sourceCostCenterId: string,
    targetCostCenterIds: string[],
  ) {
    if (targetCostCenterIds.length === 0) return;

    const activeRules = await this.prisma.allocationRule.findMany({
      where: { tenantId, organizationId, status: 'ACTIVE' },
      select: { sourceCostCenterId: true, targets: true },
    });

    const graph = new Map<string, Set<string>>();
    const addEdge = (from: string, to: string) => {
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from)!.add(to);
    };
    for (const rule of activeRules) {
      const targets = (rule.targets as Array<{ targetType: string; targetId: string }>) ?? [];
      for (const t of targets) {
        if (t.targetType === 'COST_CENTER') addEdge(rule.sourceCostCenterId, t.targetId);
      }
    }
    for (const targetId of targetCostCenterIds) {
      addEdge(sourceCostCenterId, targetId);
    }

    const visited = new Set<string>();
    const onStack = new Set<string>();
    const path: string[] = [];

    const findCycleFrom = (node: string): string[] | null => {
      visited.add(node);
      onStack.add(node);
      path.push(node);
      for (const next of graph.get(node) ?? []) {
        if (onStack.has(next)) {
          return path.slice(path.indexOf(next)).concat(next);
        }
        if (!visited.has(next)) {
          const found = findCycleFrom(next);
          if (found) return found;
        }
      }
      onStack.delete(node);
      path.pop();
      return null;
    };

    for (const node of graph.keys()) {
      if (visited.has(node)) continue;
      const cycle = findCycleFrom(node);
      if (cycle) {
        throw new ValidationAppError(
          `Allocation cycle detected: adding this rule would create a closed allocation loop through cost centers ${cycle.join(' -> ')} (spec section 74)`,
        );
      }
    }
  }
}
