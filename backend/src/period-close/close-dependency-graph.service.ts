import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CLOSE_STEP_DEFINITIONS } from './close-step-definitions';

/**
 * CloseDependencyGraphService (docx spec Phase 22, sections 12-15, 121-122).
 * Generic directed-graph algorithms — topological order (Kahn's
 * algorithm), cycle detection, and transitive descendant lookup — that
 * operate purely on `CloseStepDependency` rows, independent of the fixed
 * step list in `close-step-definitions.ts`. Seeding that fixed list into
 * rows (rather than hand-writing a linear sequence) is what lets a
 * dependency-cycle configuration genuinely fail validation instead of
 * "cycles can't happen because the list is hard-coded" (spec section 15).
 */
@Injectable()
export class CloseDependencyGraphService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotently (re)seed the fixed step-dependency edges for a tenant.
   * Safe to call repeatedly — upserts by the unique (tenant, predecessor,
   * successor) key. */
  async seedDependencies(tenantId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    for (const step of CLOSE_STEP_DEFINITIONS) {
      for (const predecessor of step.dependsOn) {
        await client.closeStepDependency.upsert({
          where: { tenantId_predecessorStep_successorStep: { tenantId, predecessorStep: predecessor, successorStep: step.code } },
          create: { tenantId, predecessorStep: predecessor, successorStep: step.code, dependencyType: 'MUST_COMPLETE', blocking: true },
          update: {},
        });
      }
    }
  }

  async getEdges(tenantId: string): Promise<{ predecessorStep: string; successorStep: string }[]> {
    return this.prisma.closeStepDependency.findMany({ where: { tenantId }, select: { predecessorStep: true, successorStep: true } });
  }

  /** Kahn's algorithm. Throws ValidationAppError if the graph (built from
   * `edges` restricted to `nodes`) contains a cycle (spec section 15's own
   * "A depends B, B depends C, C depends A => configuration invalid"). */
  topologicalOrder(nodes: string[], edges: { predecessorStep: string; successorStep: string }[]): string[] {
    const nodeSet = new Set(nodes);
    const relevantEdges = edges.filter((e) => nodeSet.has(e.predecessorStep) && nodeSet.has(e.successorStep));
    const inDegree = new Map<string, number>(nodes.map((n) => [n, 0]));
    const adjacency = new Map<string, string[]>(nodes.map((n) => [n, []]));
    for (const edge of relevantEdges) {
      adjacency.get(edge.predecessorStep)!.push(edge.successorStep);
      inDegree.set(edge.successorStep, (inDegree.get(edge.successorStep) ?? 0) + 1);
    }

    const queue = nodes.filter((n) => (inDegree.get(n) ?? 0) === 0).sort();
    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const successor of adjacency.get(current) ?? []) {
        const remaining = (inDegree.get(successor) ?? 0) - 1;
        inDegree.set(successor, remaining);
        if (remaining === 0) {
          queue.push(successor);
          queue.sort();
        }
      }
    }

    if (order.length !== nodes.length) {
      const unresolved = nodes.filter((n) => !order.includes(n));
      throw new ValidationAppError(`Close dependency graph contains a cycle involving: ${unresolved.join(', ')} (spec section 15)`);
    }
    return order;
  }

  /** All steps that transitively depend on `stepCode` (spec section 122's
   * "dependency graph descendants automatically INVALIDATED"). */
  transitiveDescendants(stepCode: string, edges: { predecessorStep: string; successorStep: string }[]): Set<string> {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.predecessorStep)) adjacency.set(edge.predecessorStep, []);
      adjacency.get(edge.predecessorStep)!.push(edge.successorStep);
    }
    const visited = new Set<string>();
    const stack = [...(adjacency.get(stepCode) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(...(adjacency.get(next) ?? []));
    }
    return visited;
  }

  async validateNoCycle(tenantId: string): Promise<void> {
    const edges = await this.getEdges(tenantId);
    const nodes = Array.from(new Set(edges.flatMap((e) => [e.predecessorStep, e.successorStep])));
    this.topologicalOrder(nodes, edges);
  }
}
