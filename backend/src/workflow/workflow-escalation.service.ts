import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowSLAService } from './workflow-sla.service';

/**
 * WorkflowEscalationService (docx spec Phase 26, sections 69-72).
 * NEVER auto-approves purely because an SLA expired (spec section 70's
 * own critical rule) — every action here either reminds, notifies,
 * reassigns, or marks the step breached; none of them creates an
 * `ApprovalDecision`. Intended to be invoked by an external scheduler
 * (not built in this phase) calling `runDueEscalations` periodically —
 * disclosed, docs/WORKFLOW_ENGINE.md section F.
 */
@Injectable()
export class WorkflowEscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sla: WorkflowSLAService,
  ) {}

  async runDueEscalations(tenantId: string) {
    const overdue = await this.sla.findOverdue(tenantId);
    const results = [];
    for (const stepInstance of overdue) {
      if (!stepInstance.definition.escalationRuleId) continue;
      const rule = await this.prisma.escalationRule.findFirst({ where: { id: stepInstance.definition.escalationRuleId, tenantId } });
      if (!rule) continue;
      const hoursOverdue = (Date.now() - (stepInstance.deadline?.getTime() ?? Date.now())) / 3600000;
      if (hoursOverdue < rule.afterHours) continue;
      results.push(await this.applyEscalation(tenantId, stepInstance.id, rule));
    }
    return results;
  }

  private async applyEscalation(tenantId: string, stepInstanceId: string, rule: { id: string; action: string; targetRoleCode: string | null }) {
    const stepInstance = await this.prisma.workflowStepInstance.findUniqueOrThrow({ where: { id: stepInstanceId }, include: { instance: true, assignments: { where: { status: 'PENDING' } } } });

    switch (rule.action) {
      case 'REMIND':
        // Reminders never create a workflow decision (spec section 71) —
        // this build records the reminder as an audit event only; actual
        // delivery is an external notification concern.
        await this.audit.record({ tenantId, organizationId: stepInstance.instance.organizationId, eventType: 'WORKFLOW_ESCALATION_REMINDER', eventCategory: 'WORKFLOW', entityType: 'WorkflowStepInstance', entityId: stepInstance.id, action: 'REMIND' });
        break;
      case 'MARK_BREACHED':
        await this.prisma.workflowException.create({ data: { tenantId, workflowInstanceId: stepInstance.workflowInstanceId, exceptionType: 'SLA_CALCULATION_ERROR', severity: 'WARNING', message: `Step ${stepInstance.id} breached its SLA deadline.` } });
        await this.audit.record({ tenantId, organizationId: stepInstance.instance.organizationId, eventType: 'WORKFLOW_SLA_BREACHED', eventCategory: 'WORKFLOW', entityType: 'WorkflowStepInstance', entityId: stepInstance.id, action: 'UPDATE', severity: 'WARNING' });
        break;
      case 'ADD_APPROVER':
      case 'REASSIGN':
      case 'NOTIFY_MANAGER':
      case 'ESCALATE_TO_ROLE':
        // Foundation only — recorded as an audit event describing the
        // intended escalation; actually resolving+adding a new approver
        // row requires the same ApproverResolutionService this step's
        // own rule already used, which this service deliberately does
        // not duplicate/re-invoke automatically (disclosed,
        // docs/WORKFLOW_ENGINE.md section F).
        await this.audit.record({ tenantId, organizationId: stepInstance.instance.organizationId, eventType: `WORKFLOW_ESCALATION_${rule.action}`, eventCategory: 'WORKFLOW', entityType: 'WorkflowStepInstance', entityId: stepInstance.id, action: rule.action, metadata: { targetRoleCode: rule.targetRoleCode } });
        break;
    }
    return { stepInstanceId: stepInstance.id, action: rule.action };
  }
}
