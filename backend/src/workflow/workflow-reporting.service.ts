import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WorkflowReportingService (docx spec Phase 26, sections 135-140). Basic
 * SLA/bottleneck/rejection/delegation aggregates computed live over
 * `WorkflowInstance`/`WorkflowStepInstance`/`ApprovalDecision` — no
 * separate reporting projection.
 */
@Injectable()
export class WorkflowReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async slaMetrics(tenantId: string, workflowDefinitionId?: string) {
    const instances = await this.prisma.workflowInstance.findMany({ where: { tenantId, workflowDefinitionId, completedAt: { not: null } }, select: { startedAt: true, completedAt: true, status: true } });
    if (instances.length === 0) return { totalInstances: 0, averageDurationHours: 0, breachedCount: 0, breachPct: 0 };
    const durations = instances.map((i) => (i.completedAt!.getTime() - i.startedAt.getTime()) / 3600000);
    const average = durations.reduce((s, d) => s + d, 0) / durations.length;
    const breached = await this.prisma.workflowException.count({ where: { tenantId, exceptionType: 'SLA_CALCULATION_ERROR' } });
    return { totalInstances: instances.length, averageDurationHours: Number(average.toFixed(1)), breachedCount: breached, breachPct: Number(((breached / instances.length) * 100).toFixed(1)) };
  }

  /** Bottleneck report (spec section 136) — average time-in-stage per
   * step definition, across all instances of a workflow. */
  async bottlenecks(tenantId: string, workflowVersionId: string) {
    const stepInstances = await this.prisma.workflowStepInstance.findMany({ where: { tenantId, definition: { workflowVersionId }, activatedAt: { not: null }, completedAt: { not: null } }, include: { definition: true } });
    const byStep = new Map<string, number[]>();
    for (const s of stepInstances) {
      const hours = (s.completedAt!.getTime() - s.activatedAt!.getTime()) / 3600000;
      if (!byStep.has(s.definition.stepCode)) byStep.set(s.definition.stepCode, []);
      byStep.get(s.definition.stepCode)!.push(hours);
    }
    return Array.from(byStep.entries()).map(([stepCode, durations]) => ({ stepCode, averageHours: Number((durations.reduce((s, d) => s + d, 0) / durations.length).toFixed(1)), count: durations.length })).sort((a, b) => b.averageHours - a.averageHours);
  }

  async rejectionReport(tenantId: string, workflowDefinitionId?: string) {
    const decisions = await this.prisma.approvalDecision.findMany({ where: { tenantId, decision: 'REJECT', instance: { workflowDefinitionId } }, select: { reasonCode: true, comment: true } });
    const byReason = new Map<string, number>();
    for (const d of decisions) {
      const key = d.reasonCode ?? 'UNSPECIFIED';
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    return Array.from(byReason.entries()).map(([reasonCode, count]) => ({ reasonCode, count }));
  }

  async approverWorkload(tenantId: string, userId: string) {
    const [pending, overdue, completed] = await Promise.all([
      this.prisma.approverAssignment.count({ where: { tenantId, userId, status: 'PENDING' } }),
      this.prisma.approverAssignment.count({ where: { tenantId, userId, status: 'PENDING', responseDeadline: { lt: new Date() } } }),
      this.prisma.approverAssignment.count({ where: { tenantId, userId, status: { in: ['APPROVED', 'REJECTED', 'CHANGE_REQUESTED'] } } }),
    ]);
    return { pending, overdue, completed };
  }

  /** Decisions made BY A DELEGATE on behalf of `delegatorUserId` — the
   * `ApprovalDecision.actorUserId` is the delegate; the assignment it
   * decided (`approverAssignmentId`) still carries the ORIGINAL
   * approver-of-record's own `userId` (spec section 34's own snapshot
   * principle — delegation never rewrites who was assigned). */
  async delegationReport(tenantId: string, delegatorUserId: string) {
    const decisions = await this.prisma.approvalDecision.count({ where: { tenantId, delegated: true, approverAssignmentId: { in: (await this.prisma.approverAssignment.findMany({ where: { tenantId, userId: delegatorUserId }, select: { id: true } })).map((a) => a.id) } } });
    return { delegatorUserId, delegatedDecisions: decisions };
  }
}
