/**
 * Phase 26 — Workflow / Approval Engine.
 *
 * Direct-service testing style matching phases 15-25's own test files.
 * Exercises effective-dated version resolution, sequential + parallel +
 * quorum execution modes, threshold-based conditional routing,
 * four-eyes self-approval blocking, manager-chain approver resolution
 * (via the Phase 26 `Employee.linkedUserId` bridge), material-change
 * reapproval invalidating a prior approval, the execution gate
 * (approve != execute, and a business-version mismatch blocks
 * execution), idempotent decisions, and cancel/restart history
 * preservation.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkflowDefinitionService } from '../src/workflow/workflow-definition.service';
import { WorkflowInstanceService } from '../src/workflow/workflow-instance.service';
import { ApprovalDecisionService } from '../src/workflow/approval-decision.service';
import { WorkflowExecutionGateService } from '../src/workflow/workflow-execution-gate.service';
import { WorkflowReapprovalService } from '../src/workflow/workflow-reapproval.service';
import { WorkflowCancellationService } from '../src/workflow/workflow-cancellation.service';

describe('Phase 26 — Workflow / Approval Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let definitions: WorkflowDefinitionService;
  let instances: WorkflowInstanceService;
  let decisions: ApprovalDecisionService;
  let executionGate: WorkflowExecutionGateService;
  let reapproval: WorkflowReapprovalService;
  let cancellation: WorkflowCancellationService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let requesterId: string;
  let managerUserId: string;
  let financeUserId: string;
  let committeeAUserId: string;
  let committeeBUserId: string;
  let committeeCUserId: string;
  let legalUserId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    definitions = app.get(WorkflowDefinitionService);
    instances = app.get(WorkflowInstanceService);
    decisions = app.get(ApprovalDecisionService);
    executionGate = app.get(WorkflowExecutionGateService);
    reapproval = app.get(WorkflowReapprovalService);
    cancellation = app.get(WorkflowCancellationService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p26-${run}`, name: 'Phase 26 tenant' } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG26-${run}`, name: 'Phase 26 org' } });

    const makeUser = async (label: string) => {
      const id = randomUUID();
      await prisma.user.create({ data: { id, email: `${label}-${run}@e2e.test`, passwordHash: 'x', displayName: label } });
      return id;
    };
    requesterId = await makeUser('requester');
    managerUserId = await makeUser('manager');
    financeUserId = await makeUser('finance');
    committeeAUserId = await makeUser('committee-a');
    committeeBUserId = await makeUser('committee-b');
    committeeCUserId = await makeUser('committee-c');
    legalUserId = await makeUser('legal');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createRule(code: string, userId: string) {
    return prisma.approverRule.create({ data: { tenantId, code: `${code}-${run}`, name: code, ruleType: 'SPECIFIC_USER', specificUserId: userId } });
  }

  it('applies threshold-based conditional routing with sequential + parallel + quorum stages', async () => {
    const managerRule = await createRule('MANAGER_RULE', managerUserId);
    const financeRule = await createRule('FINANCE_RULE', financeUserId);
    const committeeRule = await prisma.approverRule.create({ data: { tenantId, code: `COMMITTEE-${run}`, name: 'Committee', ruleType: 'SPECIFIC_USER', specificUserId: committeeAUserId } }); // placeholder; real committee uses 3 assignments below

    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `PAYMENT_APPROVAL-${run}`, name: 'Payment Approval', businessObjectType: 'PAYMENT_REQUEST', actionType: 'PAYMENT' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'BEFORE_PAYMENT' });

    await definitions.addStep(tenantId, version.id, { stepCode: 'MANAGER', name: 'Manager Approval', stage: 0, sequence: 0, executionMode: 'ALL_REQUIRED', approverRuleId: managerRule.id });
    await definitions.addStep(tenantId, version.id, { stepCode: 'FINANCE', name: 'Finance Approval', stage: 1, sequence: 0, executionMode: 'ALL_REQUIRED', approverRuleId: financeRule.id, conditionExpression: { op: 'GT', field: 'amount', value: 1000 } });
    await definitions.addStep(tenantId, version.id, { stepCode: 'COMMITTEE', name: 'Committee Quorum', stage: 2, sequence: 0, executionMode: 'QUORUM', quorumRequired: 2, approverRuleId: committeeRule.id, conditionExpression: { op: 'GT', field: 'amount', value: 10000 } });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    // --- Simple case: amount below every threshold — only Manager required ---
    const simple = await instances.start(tenantId, requesterId, {
      workflowDefinitionCode: definition.code,
      organizationId,
      businessObjectType: 'PAYMENT_REQUEST',
      businessObjectId: `PR-SIMPLE-${run}`,
      requestedAction: 'PAYMENT',
      businessVersion: 1,
      snapshotData: { amount: 500 },
      context: { amount: 500 },
    });
    const simpleManagerStep = simple.stepInstances.find((s) => s.status === 'ACTIVE');
    expect(simpleManagerStep).toBeDefined();
    await decisions.decide(tenantId, managerUserId, { workflowInstanceId: simple.id, stepInstanceId: simpleManagerStep!.id, decision: 'APPROVE', context: { amount: 500 } });
    const simpleFinal = await instances.get(tenantId, simple.id);
    expect(simpleFinal.status).toBe('APPROVED'); // Finance/Committee steps skipped by their own conditions

    // --- Threshold case: amount 15,000 requires Manager -> Finance -> Committee quorum ---
    const big = await instances.start(tenantId, requesterId, {
      workflowDefinitionCode: definition.code,
      organizationId,
      businessObjectType: 'PAYMENT_REQUEST',
      businessObjectId: `PR-BIG-${run}`,
      requestedAction: 'PAYMENT',
      businessVersion: 1,
      snapshotData: { amount: 15000 },
      context: { amount: 15000 },
    });
    const bigManagerStep = big.stepInstances.find((s) => s.status === 'ACTIVE')!;
    await decisions.decide(tenantId, managerUserId, { workflowInstanceId: big.id, stepInstanceId: bigManagerStep.id, decision: 'APPROVE', context: { amount: 15000 } });

    let afterManager = await instances.get(tenantId, big.id);
    const financeStep = afterManager.stepInstances.find((s) => s.status === 'ACTIVE')!;
    await decisions.decide(tenantId, financeUserId, { workflowInstanceId: big.id, stepInstanceId: financeStep.id, decision: 'APPROVE', context: { amount: 15000 } });

    // Committee quorum: reassign real 3-person committee via direct assignment rows since ApproverRule here is SPECIFIC_USER — instead assert quorum semantics using ApprovalDecisionService's own counting on a synthetic 3-assignment step.
    let afterFinance = await instances.get(tenantId, big.id);
    const committeeStep = afterFinance.stepInstances.find((s) => s.status === 'ACTIVE')!;
    // Replace the single auto-resolved assignment with three real committee members for a genuine quorum test.
    await prisma.approverAssignment.deleteMany({ where: { stepInstanceId: committeeStep.id } });
    await prisma.approverAssignment.createMany({
      data: [committeeAUserId, committeeBUserId, committeeCUserId].map((userId) => ({ tenantId, stepInstanceId: committeeStep.id, userId, resolvedFromRule: 'COMMITTEE', status: 'PENDING' })),
    });

    await decisions.decide(tenantId, committeeAUserId, { workflowInstanceId: big.id, stepInstanceId: committeeStep.id, decision: 'APPROVE', context: {} });
    let afterOneVote = await instances.get(tenantId, big.id);
    expect(afterOneVote.status).not.toBe('APPROVED'); // quorum 2 of 3 not yet met

    await decisions.decide(tenantId, committeeBUserId, { workflowInstanceId: big.id, stepInstanceId: committeeStep.id, decision: 'APPROVE', context: {} });
    const finalBig = await instances.get(tenantId, big.id);
    expect(finalBig.status).toBe('APPROVED'); // quorum met — third vote never required
    const thirdAssignment = await prisma.approverAssignment.findFirst({ where: { tenantId, stepInstanceId: committeeStep.id, userId: committeeCUserId } });
    expect(thirdAssignment?.status).toBe('SKIPPED');
  });

  it('requires ALL parallel approvers before advancing (Legal + Finance)', async () => {
    const legalRule = await createRule('LEGAL_RULE', legalUserId);
    const financeRule = await createRule('FINANCE_PARALLEL_RULE', financeUserId);
    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `PARALLEL_APPROVAL-${run}`, name: 'Parallel Approval', businessObjectType: 'CONTRACT', actionType: 'CUSTOM' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'MANUAL_START' });
    await definitions.addStep(tenantId, version.id, { stepCode: 'LEGAL', name: 'Legal', stage: 0, sequence: 0, executionMode: 'PARALLEL', approverRuleId: legalRule.id });
    await definitions.addStep(tenantId, version.id, { stepCode: 'FINANCE', name: 'Finance', stage: 0, sequence: 1, executionMode: 'PARALLEL', approverRuleId: financeRule.id });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    const instance = await instances.start(tenantId, requesterId, { workflowDefinitionCode: definition.code, organizationId, businessObjectType: 'CONTRACT', businessObjectId: `CT-${run}`, requestedAction: 'CUSTOM', businessVersion: 1, snapshotData: {}, context: {} });
    const steps = await prisma.workflowStepInstance.findMany({ where: { tenantId, workflowInstanceId: instance.id }, include: { definition: true } });
    const legal = steps.find((s) => s.definition.stepCode === 'LEGAL')!;
    const finance = steps.find((s) => s.definition.stepCode === 'FINANCE')!;
    expect(legal.status).toBe('ACTIVE');
    expect(finance.status).toBe('ACTIVE'); // both active simultaneously — true parallelism

    await decisions.decide(tenantId, legalUserId, { workflowInstanceId: instance.id, stepInstanceId: legal.id, decision: 'APPROVE', context: {} });
    const midway = await instances.get(tenantId, instance.id);
    expect(midway.status).not.toBe('APPROVED'); // Finance still pending

    await decisions.decide(tenantId, financeUserId, { workflowInstanceId: instance.id, stepInstanceId: finance.id, decision: 'APPROVE', context: {} });
    const final = await instances.get(tenantId, instance.id);
    expect(final.status).toBe('APPROVED');
  });

  it('enforces four-eyes: the workflow initiator cannot decide on their own request', async () => {
    const managerRule = await createRule('SELF_MANAGER_RULE', requesterId); // resolves to the requester themselves
    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `SELF_APPROVAL-${run}`, name: 'Self Approval Test', businessObjectType: 'EXPENSE_CLAIM', actionType: 'CUSTOM' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'MANUAL_START' });
    await definitions.addStep(tenantId, version.id, { stepCode: 'MANAGER', name: 'Manager', stage: 0, sequence: 0, approverRuleId: managerRule.id });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    const instance = await instances.start(tenantId, requesterId, { workflowDefinitionCode: definition.code, organizationId, businessObjectType: 'EXPENSE_CLAIM', businessObjectId: `EC-${run}`, requestedAction: 'CUSTOM', businessVersion: 1, snapshotData: {}, context: {} });
    // The requester is the only resolved approver -> four-eyes excludes them -> BLOCKING exception, workflow WAITING.
    expect(instance.status).toBe('WAITING');
    const exceptions = await prisma.workflowException.findMany({ where: { tenantId, workflowInstanceId: instance.id } });
    expect(exceptions.some((e) => e.exceptionType === 'SOD_CONFLICT' || e.exceptionType === 'APPROVER_NOT_RESOLVED')).toBe(true);
  });

  it('resolves a MANAGER approver via the Employee.linkedUserId bridge', async () => {
    const physicalPersonId = randomUUID();
    await prisma.physicalPerson.create({ data: { id: physicalPersonId, tenantId, firstName: 'Req', lastName: 'Uester', fullName: 'Req Uester' } });
    const managerPhysicalPersonId = randomUUID();
    await prisma.physicalPerson.create({ data: { id: managerPhysicalPersonId, tenantId, firstName: 'Man', lastName: 'Ager', fullName: 'Man Ager' } });

    const employeeId = randomUUID();
    await prisma.employee.create({ data: { id: employeeId, tenantId, physicalPersonId, linkedUserId: requesterId } });
    const managerEmployeeId = randomUUID();
    await prisma.employee.create({ data: { id: managerEmployeeId, tenantId, physicalPersonId: managerPhysicalPersonId, linkedUserId: managerUserId } });

    const departmentId = randomUUID();
    await prisma.department.create({ data: { id: departmentId, tenantId, organizationId, code: `DEPT-${run}`, name: 'Finance Dept' } });
    const positionId = randomUUID();
    await prisma.position.create({ data: { id: positionId, tenantId, code: `POS-${run}`, name: 'Analyst' } });

    const managerEmploymentId = randomUUID();
    await prisma.employment.create({ data: { id: managerEmploymentId, tenantId, employeeId: managerEmployeeId, organizationId, employmentType: 'FULL_TIME', employmentStartDate: new Date('2025-01-01'), departmentId, positionId } });
    const employmentId = randomUUID();
    await prisma.employment.create({ data: { id: employmentId, tenantId, employeeId, organizationId, employmentType: 'FULL_TIME', employmentStartDate: new Date('2026-01-01'), departmentId, positionId, managerEmploymentId } });

    const managerApproverRule = await prisma.approverRule.create({ data: { tenantId, code: `MGR_CHAIN-${run}`, name: 'Manager Chain', ruleType: 'MANAGER' } });
    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `HIRE_APPROVAL-${run}`, name: 'Manager Chain Approval', businessObjectType: 'HR_REQUEST', actionType: 'CUSTOM' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'MANUAL_START' });
    await definitions.addStep(tenantId, version.id, { stepCode: 'MANAGER', name: 'Manager', stage: 0, sequence: 0, approverRuleId: managerApproverRule.id });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    const instance = await instances.start(tenantId, requesterId, { workflowDefinitionCode: definition.code, organizationId, businessObjectType: 'HR_REQUEST', businessObjectId: `HR-${run}`, requestedAction: 'CUSTOM', businessVersion: 1, snapshotData: {}, context: { employmentId } });
    const assignment = await prisma.approverAssignment.findFirst({ where: { tenantId, stepInstance: { workflowInstanceId: instance.id } } });
    expect(assignment?.userId).toBe(managerUserId);
  });

  it('invalidates a prior approval on material change and requires reapproval, then blocks stale-approval execution via the execution gate', async () => {
    const managerRule = await createRule('MATCHANGE_MANAGER_RULE', managerUserId);
    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `MATCHANGE-${run}`, name: 'Material Change Test', businessObjectType: 'PAYMENT_REQUEST', actionType: 'PAYMENT' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'BEFORE_PAYMENT', reapprovalPolicy: [{ fieldPath: 'beneficiaryIban', action: 'FULL_RESTART' }] });
    await definitions.addStep(tenantId, version.id, { stepCode: 'MANAGER', name: 'Manager', stage: 0, sequence: 0, approverRuleId: managerRule.id });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    const instance = await instances.start(tenantId, requesterId, { workflowDefinitionCode: definition.code, organizationId, businessObjectType: 'PAYMENT_REQUEST', businessObjectId: `PR-MC-${run}`, requestedAction: 'PAYMENT', businessVersion: 1, snapshotData: { amount: 1000, beneficiaryIban: 'IBAN-A' }, context: { amount: 1000 } });
    const managerStep = instance.stepInstances.find((s) => s.status === 'ACTIVE')!;
    await decisions.decide(tenantId, managerUserId, { workflowInstanceId: instance.id, stepInstanceId: managerStep.id, decision: 'APPROVE', context: { amount: 1000 } });
    const approved = await instances.get(tenantId, instance.id);
    expect(approved.status).toBe('APPROVED');

    // Execution gate passes while nothing has changed.
    const passResult = await executionGate.assertExecutionAllowed(tenantId, { businessObjectType: 'PAYMENT_REQUEST', businessObjectId: `PR-MC-${run}`, requestedAction: 'PAYMENT', currentBusinessVersion: 1, executorUserId: financeUserId });
    expect(passResult.allowed).toBe(true);

    // Beneficiary bank changes — a HIGH_RISK material change (spec section 56).
    const result = await reapproval.notifyBusinessObjectChanged(tenantId, requesterId, instance.id, { amount: 1000, beneficiaryIban: 'IBAN-B' }, 2, { amount: 1000 });
    expect(result.materialChangeDetected).toBe(true);
    expect(result.action).toBe('FULL_RESTART');

    const original = await instances.get(tenantId, instance.id);
    expect(original.status).toBe('SUPERSEDED'); // spec section 82-85 — original retained, not deleted

    // The OLD business version (1) can no longer execute — snapshot/version mismatch.
    const staleGate = await executionGate.assertExecutionAllowed(tenantId, { businessObjectType: 'PAYMENT_REQUEST', businessObjectId: `PR-MC-${run}`, requestedAction: 'PAYMENT', currentBusinessVersion: 1, executorUserId: financeUserId });
    expect(staleGate.allowed).toBe(false);

    // New instance requires fresh approval before execution is allowed again.
    const newGateBeforeApproval = await executionGate.assertExecutionAllowed(tenantId, { businessObjectType: 'PAYMENT_REQUEST', businessObjectId: `PR-MC-${run}`, requestedAction: 'PAYMENT', currentBusinessVersion: 2, executorUserId: financeUserId });
    expect(newGateBeforeApproval.allowed).toBe(false); // new instance is PENDING, not yet APPROVED
  });

  it('is idempotent under a repeated decision request with the same key', async () => {
    const managerRule = await createRule('IDEMPOTENT_MANAGER_RULE', managerUserId);
    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `IDEMPOTENT-${run}`, name: 'Idempotency Test', businessObjectType: 'EXPENSE_CLAIM', actionType: 'CUSTOM' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'MANUAL_START' });
    await definitions.addStep(tenantId, version.id, { stepCode: 'MANAGER', name: 'Manager', stage: 0, sequence: 0, approverRuleId: managerRule.id });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    const instance = await instances.start(tenantId, requesterId, { workflowDefinitionCode: definition.code, organizationId, businessObjectType: 'EXPENSE_CLAIM', businessObjectId: `EC-IDEMP-${run}`, requestedAction: 'CUSTOM', businessVersion: 1, snapshotData: {}, context: {} });
    const managerStep = instance.stepInstances.find((s) => s.status === 'ACTIVE')!;
    const idempotencyKey = randomUUID();

    const first = await decisions.decide(tenantId, managerUserId, { workflowInstanceId: instance.id, stepInstanceId: managerStep.id, decision: 'APPROVE', context: {}, idempotencyKey });
    const second = await decisions.decide(tenantId, managerUserId, { workflowInstanceId: instance.id, stepInstanceId: managerStep.id, decision: 'APPROVE', context: {}, idempotencyKey });
    expect(second.id).toBe(first.id);

    const decisionCount = await prisma.approvalDecision.count({ where: { tenantId, workflowInstanceId: instance.id } });
    expect(decisionCount).toBe(1);
  });

  it('cancels a pending workflow and restarts it without losing history', async () => {
    const managerRule = await createRule('CANCEL_MANAGER_RULE', managerUserId);
    const definition = await definitions.createDefinition(tenantId, requesterId, { code: `CANCEL_RESTART-${run}`, name: 'Cancel Restart Test', businessObjectType: 'EXPENSE_CLAIM', actionType: 'CUSTOM' });
    const version = await definitions.createVersion(tenantId, requesterId, definition.id, { effectiveFrom: '2026-01-01', triggerType: 'MANUAL_START' });
    await definitions.addStep(tenantId, version.id, { stepCode: 'MANAGER', name: 'Manager', stage: 0, sequence: 0, approverRuleId: managerRule.id });
    await definitions.activateVersion(tenantId, requesterId, version.id);

    const instance = await instances.start(tenantId, requesterId, { workflowDefinitionCode: definition.code, organizationId, businessObjectType: 'EXPENSE_CLAIM', businessObjectId: `EC-CANCEL-${run}`, requestedAction: 'CUSTOM', businessVersion: 1, snapshotData: {}, context: {} });
    await cancellation.cancel(tenantId, requesterId, instance.id, 'No longer needed');
    const cancelled = await instances.get(tenantId, instance.id);
    expect(cancelled.status).toBe('CANCELLED');

    const restarted = await cancellation.restart(tenantId, requesterId, instance.id, {}, 2, {});
    expect(restarted.supersedesInstanceId).toBe(instance.id);

    const originalStillThere = await instances.get(tenantId, instance.id);
    expect(originalStillThere.status).toBe('CANCELLED'); // original never deleted or mutated by the restart
  });
});
