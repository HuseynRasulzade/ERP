import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ConflictAppError, ValidationAppError, PermissionDeniedError } from '../common/errors/app-error';
import { AuditService } from '../audit/audit.service';
import { WorkflowInstanceService } from '../workflow/workflow-instance.service';
import { WorkflowExecutionGateService } from '../workflow/workflow-execution-gate.service';
import { IntegrationCommandRegistry, IntegrationActorContext } from '../integration/integration-command-registry.service';
import { AIAssistantDefinitionService } from './ai-assistant-definition.service';
import { AIProposalRevalidationRegistry } from './ai-proposal-revalidation-registry.service';
import { RetrievedEvidenceItem } from './ai-retrieval.service';

const CRITICAL_RISK_ACTION_TYPES = new Set(['PERIOD_REOPEN', 'MANUAL_JOURNAL', 'PAYROLL_OVERRIDE', 'PAYROLL_FINALIZE', 'TAX_FILING', 'FIXED_ASSET_DISPOSAL', 'STOCK_ADJUSTMENT', 'PERMISSION_ESCALATION', 'BANK_PAYMENT_SEND', 'BENEFICIARY_CHANGE']);

export interface CreateProposalInput {
  organizationId?: string;
  interactionId?: string;
  assistantCode: string;
  actionType: string;
  targetDomain: string;
  targetEntityType?: string;
  targetEntityId?: string;
  proposedCommand: Record<string, unknown>;
  rationale: string;
  confidenceLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  evidence: RetrievedEvidenceItem[];
  idempotencyKey: string; // one per interaction+intent — spec section 185, never a duplicate proposal on retry
  expiresAt?: Date;
  createdBy?: string;
}

/**
 * AIActionProposalService (docx spec Phase 29, "Propose Action"/"Assist
 * Execution" roles, sections 42-55, 187-188). Spec's own critical rule
 * (section 52/234): AI never autonomously executes payment, period
 * reopen, payroll finalization, manual journal, tax filing, FA
 * disposal, stock adjustment, or permission escalation — those
 * `actionType`s are hard-coded CRITICAL here regardless of what risk
 * level a caller passes in, and CRITICAL always requires Phase 26
 * workflow approval before `execute` will even attempt the domain
 * command.
 *
 * `execute` reuses Phase 28's `IntegrationCommandRegistry` — the SAME
 * registry and `IntegrationCommandHandler` contract a business module
 * registers for governed imports — as the ONE deterministic domain
 * command dispatch path (spec section 53-54's "no AI-specific business
 * bypass"). The actor context is tagged `actorType: 'AI_ASSISTED'` so
 * every downstream audit/permission check can see the action originated
 * from an AI-assisted flow.
 */
@Injectable()
export class AIActionProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assistants: AIAssistantDefinitionService,
    private readonly workflowInstances: WorkflowInstanceService,
    private readonly executionGate: WorkflowExecutionGateService,
    private readonly commandRegistry: IntegrationCommandRegistry,
    private readonly revalidation: AIProposalRevalidationRegistry,
  ) {}

  async create(tenantId: string, input: CreateProposalInput) {
    const riskLevel = CRITICAL_RISK_ACTION_TYPES.has(input.actionType) ? 'CRITICAL' : input.riskLevel;
    await this.assistants.assertActionRiskAllowed(tenantId, input.assistantCode, riskLevel);

    const existing = await this.prisma.aIActionProposal.findFirst({ where: { tenantId, idempotencyKey: input.idempotencyKey } });
    if (existing) return existing; // spec section 185 — same interaction retried must never create a second logical proposal

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.aIActionProposal.create({
        data: {
          tenantId,
          organizationId: input.organizationId,
          interactionId: input.interactionId,
          actionType: input.actionType,
          targetDomain: input.targetDomain,
          targetEntityType: input.targetEntityType,
          targetEntityId: input.targetEntityId,
          proposedCommand: input.proposedCommand as object,
          rationale: input.rationale,
          confidenceLevel: input.confidenceLevel ?? 'MEDIUM',
          riskLevel,
          status: 'READY_FOR_REVIEW',
          expiresAt: input.expiresAt ?? new Date(Date.now() + 24 * 3_600_000),
          idempotencyKey: input.idempotencyKey,
          createdBy: input.createdBy,
        },
      });
      if (input.evidence.length > 0) {
        await tx.aIEvidenceReference.createMany({ data: input.evidence.map((e) => ({ tenantId, actionProposalId: row.id, evidenceType: e.evidenceType, entityType: e.entityType, entityId: e.entityId, asOf: e.asOf, versionTag: e.versionTag, summary: e.summary })) });
      }
      await this.audit.record({ tenantId, organizationId: input.organizationId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: 'AIActionProposal', entityId: row.id, operation: 'CREATE', action: 'CREATE', userId: input.createdBy ?? null, metadata: { actionType: input.actionType, riskLevel, confidenceLevel: row.confidenceLevel } }, tx);
      return row;
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.aIActionProposal.findFirst({ where: { id, tenantId }, include: { items: true, evidence: true } });
    if (!row) throw new NotFoundAppError('AIActionProposal', id);
    return row;
  }

  private async assertNotExpired(tenantId: string, id: string) {
    const proposal = await this.get(tenantId, id);
    if (proposal.expiresAt && proposal.expiresAt < new Date() && proposal.status !== 'EXPIRED') {
      await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new ConflictAppError(`Proposal ${id} has expired`);
    }
    if (['EXPIRED', 'CANCELLED', 'REJECTED', 'EXECUTED'].includes(proposal.status)) {
      throw new ConflictAppError(`Proposal ${id} is ${proposal.status}`);
    }
    return proposal;
  }

  /** Accept always re-validates eligibility (spec section 46-47) —
   * accepting a stale/over-consumed proposal is refused rather than
   * silently honored, and the caller is expected to regenerate. */
  async accept(tenantId: string, userId: string, id: string) {
    const proposal = await this.assertNotExpired(tenantId, id);
    const revalidation = await this.revalidation.revalidate(tenantId, proposal.actionType, proposal.proposedCommand as Record<string, unknown>);
    if (!revalidation.valid) {
      await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'STALE' } });
      throw new ConflictAppError(`Proposal ${id} is stale: ${revalidation.reason ?? 'source eligibility changed since generation'}`);
    }

    const needsWorkflow = proposal.riskLevel === 'HIGH' || proposal.riskLevel === 'CRITICAL';
    const updated = await this.prisma.aIActionProposal.update({ where: { id }, data: { status: needsWorkflow ? 'APPROVAL_REQUIRED' : 'ACCEPTED' } });
    await this.audit.record({ tenantId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: 'AIActionProposal', entityId: id, operation: 'UPDATE', action: 'ACCEPT', userId, metadata: { riskLevel: proposal.riskLevel, needsWorkflow } });
    return updated;
  }

  async reject(tenantId: string, userId: string, id: string, reason?: string) {
    await this.assertNotExpired(tenantId, id);
    const updated = await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'REJECTED' } });
    await this.audit.record({ tenantId, eventType: 'ImportRejected', eventCategory: 'AI', entityType: 'AIActionProposal', entityId: id, operation: 'UPDATE', action: 'REJECT', userId, metadata: { reason } });
    return updated;
  }

  /** Routes an ACCEPTED HIGH/CRITICAL-risk proposal into Phase 26 for
   * approval (spec section 48). The proposal itself never shortens or
   * bypasses the normal approval route (spec section 170). */
  async routeForApproval(tenantId: string, userId: string, id: string, workflowDefinitionCode: string) {
    const proposal = await this.get(tenantId, id);
    if (proposal.status !== 'APPROVAL_REQUIRED') throw new ConflictAppError(`Proposal ${id} is ${proposal.status}, expected APPROVAL_REQUIRED`);

    const instance = await this.workflowInstances.start(tenantId, userId, {
      workflowDefinitionCode,
      organizationId: proposal.organizationId ?? '',
      businessObjectType: 'AIActionProposal',
      businessObjectId: proposal.id,
      requestedAction: proposal.actionType,
      businessVersion: 1,
      snapshotData: proposal.proposedCommand as Record<string, unknown>,
      context: { amount: (proposal.proposedCommand as Record<string, unknown>).amount as number | undefined, risk: proposal.riskLevel },
    });

    return this.prisma.aIActionProposal.update({ where: { id }, data: { workflowInstanceId: instance.id } });
  }

  /** The ONLY method that ever calls a real domain command. For
   * LOW/MODERATE risk (no workflow route), `accept` already left the
   * proposal ACCEPTED and this proceeds straight to revalidation +
   * execution; for HIGH/CRITICAL, `WorkflowExecutionGateService` must
   * report APPROVED first (spec section 182 — "execution wrapper must
   * require proof: accepted proposal, workflow approval if required,
   * current permissions, current domain version — before calling
   * command"). */
  async execute(tenantId: string, executorUserId: string, id: string, serviceAccountUserId: string) {
    const proposal = await this.assertNotExpired(tenantId, id);

    if (proposal.riskLevel === 'HIGH' || proposal.riskLevel === 'CRITICAL') {
      if (proposal.status !== 'APPROVED' && proposal.status !== 'APPROVAL_REQUIRED') {
        throw new ConflictAppError(`Proposal ${id} requires workflow approval before execution (status: ${proposal.status})`);
      }
      const gate = await this.executionGate.assertExecutionAllowed(tenantId, { businessObjectType: 'AIActionProposal', businessObjectId: proposal.id, requestedAction: proposal.actionType, currentBusinessVersion: 1, executorUserId });
      if (!gate.allowed) throw new PermissionDeniedError(gate.reason);
    } else if (proposal.status !== 'ACCEPTED') {
      throw new ConflictAppError(`Proposal ${id} must be ACCEPTED before execution (status: ${proposal.status})`);
    }

    // Execution-time revalidation is the SECOND, final check (spec
    // section 187) — a source change between accept() and execute()
    // must still block.
    const revalidation = await this.revalidation.revalidate(tenantId, proposal.actionType, proposal.proposedCommand as Record<string, unknown>);
    if (!revalidation.valid) {
      await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'STALE' } });
      throw new ConflictAppError(`Proposal ${id} became stale before execution: ${revalidation.reason}`);
    }

    await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'EXECUTING' } });

    if (!this.commandRegistry.has(proposal.actionType)) {
      await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'FAILED' } });
      throw new ValidationAppError(`No domain command handler registered for action type '${proposal.actionType}'`);
    }
    const handler = this.commandRegistry.get(proposal.actionType);
    const actor: IntegrationActorContext = { actorType: 'AI_ASSISTED', endpointId: 'AI_ASSISTANT', serviceAccountUserId };

    try {
      const result = await this.prisma.runInTransaction((tx) => handler.execute(tenantId, actor, proposal.proposedCommand as Record<string, unknown>, 'COMMAND_EVENT', tx));
      if (result.status === 'REJECTED' || result.status === 'FAILED') {
        await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'FAILED' } });
        await this.audit.record({ tenantId, eventType: 'ImportRejected', eventCategory: 'AI', entityType: 'AIActionProposal', entityId: id, operation: 'UPDATE', action: 'EXECUTION_FAILED', userId: executorUserId, metadata: { reason: result.rejectionReason } });
        throw new ValidationAppError(`Domain command rejected: ${result.rejectionReason}`);
      }

      const executed = await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'EXECUTED', executedDocumentType: result.targetEntityType, executedDocumentId: result.targetEntityId } });
      if (proposal.workflowInstanceId) await this.executionGate.markExecutionResult(tenantId, proposal.workflowInstanceId, 'EXECUTED');
      await this.audit.record({ tenantId, eventType: 'ImportProcessed', eventCategory: 'AI', entityType: result.targetEntityType ?? 'AIActionProposal', entityId: result.targetEntityId ?? id, operation: 'CREATE', action: 'AI_PROPOSAL_EXECUTED', userId: executorUserId, metadata: { proposalId: id, actionType: proposal.actionType, workflowInstanceId: proposal.workflowInstanceId } });
      return executed;
    } catch (err) {
      await this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'FAILED' } });
      throw err;
    }
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const proposal = await this.get(tenantId, id);
    if (proposal.status === 'EXECUTED') throw new ConflictAppError('Cannot cancel an already-executed proposal');
    return this.prisma.aIActionProposal.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
