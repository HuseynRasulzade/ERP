import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface WorkflowHealthFinding {
  check: string;
  count: number;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  blocking: boolean;
}

/**
 * WorkflowHealthService (docx spec Phase 26, sections 154-155).
 * Computed live — same "rebuildable projection" convention as every
 * other Health service in this codebase. Feeds Phase 30's own
 * organization-wide Accounting Health engine (spec section 177).
 */
@Injectable()
export class WorkflowHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string): Promise<WorkflowHealthFinding[]> {
    const findings: WorkflowHealthFinding[] = [];

    const unresolvedExceptions = await this.prisma.workflowException.count({ where: { tenantId, resolved: false, severity: { in: ['ERROR', 'BLOCKING'] } } });
    if (unresolvedExceptions > 0) findings.push({ check: 'UNRESOLVED_WORKFLOW_EXCEPTION', count: unresolvedExceptions, severity: 'BLOCKING', blocking: true });

    const overdueSteps = await this.prisma.workflowStepInstance.count({ where: { tenantId, status: 'ACTIVE', deadline: { lt: new Date() } } });
    if (overdueSteps > 0) findings.push({ check: 'OVERDUE_STEP', count: overdueSteps, severity: 'WARNING', blocking: false });

    const activeStepsNoApprover = await this.prisma.workflowStepInstance.count({ where: { tenantId, status: 'ACTIVE', assignments: { none: {} } } });
    if (activeStepsNoApprover > 0) findings.push({ check: 'ACTIVE_STEP_NO_APPROVER', count: activeStepsNoApprover, severity: 'BLOCKING', blocking: true });

    const stalePending = await this.prisma.workflowInstance.count({ where: { tenantId, status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING'] }, startedAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
    if (stalePending > 0) findings.push({ check: 'STALE_PENDING_WORKFLOW', count: stalePending, severity: 'WARNING', blocking: false });

    // Duplicate active workflow for the same business object/action
    // (spec section 154's own "duplicate active workflow").
    const activeInstances = await this.prisma.workflowInstance.groupBy({ by: ['businessObjectType', 'businessObjectId', 'requestedAction'], where: { tenantId, status: { in: ['PENDING', 'IN_PROGRESS', 'WAITING'] } }, _count: { _all: true } });
    const duplicates = activeInstances.filter((g) => g._count._all > 1).length;
    if (duplicates > 0) findings.push({ check: 'DUPLICATE_ACTIVE_WORKFLOW', count: duplicates, severity: 'ERROR', blocking: false });

    const approvedNotExecutedStale = await this.prisma.workflowInstance.count({ where: { tenantId, status: 'APPROVED', executionStatus: 'NOT_EXECUTED', completedAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
    if (approvedNotExecutedStale > 0) findings.push({ check: 'APPROVED_NOT_EXECUTED_STALE', count: approvedNotExecutedStale, severity: 'INFO', blocking: false });

    return findings;
  }
}
