import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CloseDependencyGraphService } from './close-dependency-graph.service';
import { PeriodCloseStepExecutor } from './period-close-step-executor.service';
import { FinancialPeriodService } from './financial-period.service';
import { PeriodLockService } from './period-lock.service';
import { CloseIssueService } from './close-issue.service';
import { CLOSE_STEP_DEFINITIONS } from './close-step-definitions';

/**
 * PeriodCloseOrchestrator (docx spec Phase 22, sections 7-9, 27-28,
 * 132-137). Owns the `PeriodCloseRun`/`PeriodCloseStep` state machine.
 * Each step is its own DB transaction (via `PeriodCloseStepExecutor`'s
 * own calls into subledger services, each already transactional) — this
 * orchestrator never wraps the whole run in one transaction (spec
 * section 132), and re-running `run()` on an existing run only executes
 * steps that are not already SUCCESS/SKIPPED (spec sections 27-28,
 * 133 crash recovery). Step execution is sequential in topological order
 * in this build — independent-branch parallelism (spec section 137) is
 * not implemented (disclosed simplification, docs/MONTH_CLOSE.md section N).
 */
@Injectable()
export class PeriodCloseOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly graph: CloseDependencyGraphService,
    private readonly executor: PeriodCloseStepExecutor,
    private readonly financialPeriod: FinancialPeriodService,
    private readonly lock: PeriodLockService,
    private readonly issues: CloseIssueService,
  ) {}

  private async assertSingleAuthoritativeRun(tenantId: string, financialPeriodId: string, closeType: string) {
    if (closeType === 'PREVIEW' || closeType === 'DIAGNOSTIC') return; // read-only, may run concurrently (spec section 134)
    const active = await this.prisma.periodCloseRun.findFirst({ where: { tenantId, financialPeriodId, closeType: { notIn: ['PREVIEW', 'DIAGNOSTIC'] }, status: { in: ['CREATED', 'VALIDATING', 'RUNNING', 'WAITING_DEPENDENCY', 'FINALIZING'] } } });
    if (active) throw new ValidationAppError(`An authoritative close run (${active.id}) is already in progress for this period (spec section 134 — one at a time).`);
  }

  /** Creates a run and executes it start-to-finish (or resumes an
   * existing incomplete run when one is passed via `resumeRunId`). */
  async start(tenantId: string, userId: string, financialPeriodId: string, closeType: 'PREVIEW' | 'PRE_CLOSE' | 'REGULAR_CLOSE' | 'RECLOSE' | 'YEAR_END_CLOSE' | 'DIAGNOSTIC') {
    await this.assertSingleAuthoritativeRun(tenantId, financialPeriodId, closeType);
    await this.graph.seedDependencies(tenantId);

    const financialPeriod = await this.financialPeriod.get(tenantId, financialPeriodId);
    if (closeType !== 'PREVIEW' && closeType !== 'DIAGNOSTIC') {
      await this.lock.assertNotHardClosed(tenantId, financialPeriodId);
    }

    const supersedesRun = closeType === 'RECLOSE' ? await this.prisma.periodCloseRun.findFirst({ where: { tenantId, financialPeriodId, status: 'COMPLETED' }, orderBy: { calculationVersion: 'desc' } }) : null;

    const run = await this.prisma.periodCloseRun.create({
      data: {
        tenantId,
        financialPeriodId,
        organizationId: financialPeriod.organizationId,
        closeType,
        status: 'RUNNING',
        startedAt: new Date(),
        initiatedBy: userId,
        calculationVersion: (supersedesRun?.calculationVersion ?? 0) + 1,
        periodDataVersionAtStart: financialPeriod.dataVersion,
        supersedesRunId: supersedesRun?.id,
        totalSteps: CLOSE_STEP_DEFINITIONS.length,
      },
    });

    const inProgressStatus = closeType === 'PREVIEW' || closeType === 'DIAGNOSTIC' ? financialPeriod.status : closeType === 'PRE_CLOSE' ? 'PRE_CLOSE' : 'CLOSE_IN_PROGRESS';
    await this.financialPeriod.setStatus(tenantId, financialPeriodId, inProgressStatus, { closeRunId: run.id });
    await this.audit.record({ tenantId, eventType: closeType === 'PREVIEW' ? 'PERIOD_PRE_CLOSE_STARTED' : 'PERIOD_CLOSE_STARTED', entityType: 'PeriodCloseRun', entityId: run.id, action: 'CREATE', userId, newValues: { closeType } });

    if (supersedesRun) {
      // RECLOSE inherits every non-invalidated step's already-SUCCESS
      // result rather than re-running it from scratch — only invalidated
      // steps (and anything downstream, already marked INVALIDATED at
      // reopen-approval time) are re-executed (spec section 123).
      const previousSteps = await this.prisma.periodCloseStep.findMany({ where: { tenantId, closeRunId: supersedesRun.id } });
      for (const step of previousSteps) {
        await this.prisma.periodCloseStep.create({
          data: { tenantId, closeRunId: run.id, stepCode: step.stepCode, name: step.name, sequence: step.sequence, dependencyGroup: step.dependencyGroup, status: step.status === 'INVALIDATED' ? 'NOT_STARTED' : step.status, serviceName: step.serviceName, resultSummary: step.resultSummary ?? undefined },
        });
      }
    } else {
      const edges = await this.graph.getEdges(tenantId);
      const order = this.graph.topologicalOrder(CLOSE_STEP_DEFINITIONS.map((s) => s.code), edges);
      for (const [index, stepCode] of order.entries()) {
        const def = CLOSE_STEP_DEFINITIONS.find((s) => s.code === stepCode)!;
        await this.prisma.periodCloseStep.create({ data: { tenantId, closeRunId: run.id, stepCode, name: def.name, sequence: index, dependencyGroup: def.dependencyGroup, status: 'NOT_STARTED' } });
      }
    }

    return this.resume(tenantId, userId, run.id);
  }

  /** Executes every step of an existing run that is not yet
   * SUCCESS/SKIPPED, in topological order, stopping at the first
   * genuinely BLOCKING failure (successors of a blocked step become
   * WAITING_DEPENDENCY, not silently skipped). Safe to call repeatedly —
   * this IS the crash-recovery / retry path (spec sections 27-28, 133). */
  async resume(tenantId: string, userId: string, closeRunId: string) {
    const run = await this.prisma.periodCloseRun.findUniqueOrThrow({ where: { id: closeRunId } });
    const financialPeriod = await this.financialPeriod.get(tenantId, run.financialPeriodId);
    const edges = await this.graph.getEdges(tenantId);
    const steps = await this.prisma.periodCloseStep.findMany({ where: { tenantId, closeRunId } });
    const order = this.graph.topologicalOrder(steps.map((s) => s.stepCode), edges);
    const stepByCode = new Map(steps.map((s) => [s.stepCode, s]));
    const predecessorsOf = new Map<string, string[]>();
    for (const edge of edges) {
      if (!predecessorsOf.has(edge.successorStep)) predecessorsOf.set(edge.successorStep, []);
      predecessorsOf.get(edge.successorStep)!.push(edge.predecessorStep);
    }

    let successCount = 0;
    let warningCount = 0;
    let failedCount = 0;
    let blocked = false;

    for (const stepCode of order) {
      const step = stepByCode.get(stepCode)!;
      if (step.status === 'SUCCESS' || step.status === 'SKIPPED') {
        if (step.status === 'SUCCESS') successCount++;
        continue;
      }

      const predecessors = (predecessorsOf.get(stepCode) ?? []).map((p) => stepByCode.get(p));
      const predecessorBlocked = predecessors.some((p) => p && !['SUCCESS', 'SKIPPED', 'WARNING'].includes(p.status));
      if (predecessorBlocked || blocked) {
        await this.prisma.periodCloseStep.update({ where: { id: step.id }, data: { status: 'BLOCKED' } });
        continue;
      }

      const skipReason = await this.executor.shouldSkip(stepCode, tenantId, run.organizationId);
      if (skipReason) {
        await this.prisma.periodCloseStep.update({ where: { id: step.id }, data: { status: 'SKIPPED', startedAt: new Date(), completedAt: new Date(), resultSummary: { reason: skipReason } } });
        continue;
      }

      await this.prisma.periodCloseStep.update({ where: { id: step.id }, data: { status: 'RUNNING', startedAt: new Date() } });
      await this.prisma.periodCloseRun.update({ where: { id: run.id }, data: { currentStep: stepCode } });

      let outcome;
      try {
        outcome = await this.executor.execute(stepCode, {
          tenantId,
          organizationId: run.organizationId,
          userId,
          closeRunId: run.id,
          periodStart: financialPeriod.periodStart,
          periodEnd: financialPeriod.periodEnd,
          period: this.toPeriodString(financialPeriod.periodStart),
          closeType: run.closeType,
          dryRun: run.closeType === 'PREVIEW' || run.closeType === 'DIAGNOSTIC' || run.closeType === 'PRE_CLOSE',
        });
      } catch (err) {
        outcome = { status: 'FAILED' as const, summary: {}, errors: [err instanceof Error ? err.message : String(err)] };
      }

      await this.prisma.periodCloseStep.update({
        where: { id: step.id },
        data: { status: outcome.status, completedAt: new Date(), resultSummary: outcome.summary as object, warnings: outcome.warnings ?? [], errors: outcome.errors ?? [] },
      });

      for (const message of outcome.errors ?? []) {
        await this.issues.create(tenantId, run.id, { stepId: step.id, issueCode: `${stepCode}_ERROR`, severity: outcome.status === 'BLOCKED' ? 'BLOCKING' : 'ERROR', blocking: outcome.status === 'BLOCKED' || outcome.status === 'FAILED', sourceModule: stepCode, description: message });
      }
      for (const message of outcome.warnings ?? []) {
        await this.issues.create(tenantId, run.id, { stepId: step.id, issueCode: `${stepCode}_WARNING`, severity: 'WARNING', blocking: false, sourceModule: stepCode, description: message });
      }

      if (outcome.status === 'SUCCESS') successCount++;
      else if (outcome.status === 'WARNING') { successCount++; warningCount++; }
      else if (outcome.status === 'SKIPPED') { /* not counted */ }
      else { failedCount++; blocked = true; }
    }

    const blockingIssueCount = await this.issues.blockingCount(tenantId, run.id);
    const allDone = (await this.prisma.periodCloseStep.findMany({ where: { tenantId, closeRunId } })).every((s) => ['SUCCESS', 'SKIPPED', 'WARNING'].includes(s.status));

    const status = blockingIssueCount > 0 || blocked ? 'BLOCKED' : allDone ? (run.closeType === 'PREVIEW' || run.closeType === 'DIAGNOSTIC' ? 'COMPLETED' : 'COMPLETED') : 'WAITING_DEPENDENCY';

    const updatedRun = await this.prisma.periodCloseRun.update({
      where: { id: run.id },
      data: { status, successfulSteps: successCount, warningSteps: warningCount, failedSteps: failedCount, blockingIssueCount, completedAt: status === 'COMPLETED' ? new Date() : undefined, currentStep: null },
    });

    if (status === 'COMPLETED' && run.closeType !== 'PREVIEW' && run.closeType !== 'DIAGNOSTIC') {
      // The FINAL_LOCK step itself already called PeriodLockService.hardClose
      // (or, for PRE_CLOSE, deliberately left the period OPEN) — this
      // orchestrator only records the run-level completion event.
      await this.audit.record({ tenantId, eventType: run.closeType === 'RECLOSE' ? 'PERIOD_RECLOSED' : 'PERIOD_CLOSE_COMPLETED', entityType: 'PeriodCloseRun', entityId: run.id, action: 'UPDATE', userId });
    } else if (status === 'BLOCKED' && run.closeType !== 'PREVIEW' && run.closeType !== 'DIAGNOSTIC') {
      // Revert the umbrella CLOSE_IN_PROGRESS/PRE_CLOSE marker so ordinary
      // readiness re-checks (and a future retry) see an accurate state —
      // the period itself is NOT reopened, just no longer "in progress."
      const currentStatus = (await this.financialPeriod.get(tenantId, run.financialPeriodId)).status;
      if (currentStatus === 'CLOSE_IN_PROGRESS' || currentStatus === 'PRE_CLOSE') {
        await this.financialPeriod.setStatus(tenantId, run.financialPeriodId, 'OPEN');
      }
    }

    return this.prisma.periodCloseRun.findUniqueOrThrow({ where: { id: updatedRun.id }, include: { steps: true, issues: true } });
  }

  async retryStep(tenantId: string, userId: string, closeRunId: string, stepCode: string) {
    const step = await this.prisma.periodCloseStep.findFirst({ where: { tenantId, closeRunId, stepCode } });
    if (!step) throw new ValidationAppError(`Step ${stepCode} not found on run ${closeRunId}`);
    if (!step.retryable) throw new ValidationAppError(`Step ${stepCode} is not retryable`);
    await this.prisma.periodCloseStep.update({ where: { id: step.id }, data: { status: 'NOT_STARTED' } });
    await this.prisma.periodCloseRun.update({ where: { id: closeRunId }, data: { retryCount: { increment: 1 }, status: 'RUNNING' } });
    return this.resume(tenantId, userId, closeRunId);
  }

  async getRun(tenantId: string, closeRunId: string) {
    return this.prisma.periodCloseRun.findFirstOrThrow({ where: { id: closeRunId, tenantId }, include: { steps: { orderBy: { sequence: 'asc' } }, issues: true, reconciliationResults: true } });
  }

  private toPeriodString(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
