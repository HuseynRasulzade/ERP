import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PeriodLockService } from './period-lock.service';
import { CloseDependencyGraphService } from './close-dependency-graph.service';

/**
 * PeriodReopenService (docx spec Phase 22, sections 116-124). The
 * original close run's rows are NEVER deleted (spec section 124) —
 * reopen only INVALIDATES the affected step and its transitive
 * dependency-graph descendants on the run, leaving v1 fully intact for
 * `PeriodCloseOrchestrator.reclose` to build v2 from.
 */
@Injectable()
export class PeriodReopenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly lock: PeriodLockService,
    private readonly graph: CloseDependencyGraphService,
  ) {}

  async request(tenantId: string, userId: string, dto: { financialPeriodId: string; reason: string; affectedModules?: string[]; sourceDocumentType?: string; sourceDocumentId?: string }) {
    if (!dto.reason) throw new ValidationAppError('A reopen request requires an explicit reason');
    const latestRun = await this.prisma.periodCloseRun.findFirst({ where: { tenantId, financialPeriodId: dto.financialPeriodId, closeType: { in: ['REGULAR_CLOSE', 'RECLOSE', 'YEAR_END_CLOSE'] } }, orderBy: { createdAt: 'desc' } });
    const impactAnalysis = latestRun ? await this.impactAnalysis(tenantId, latestRun.id, dto.affectedModules ?? []) : { affectedSteps: [] };

    const request = await this.prisma.periodReopenRequest.create({
      data: {
        tenantId,
        financialPeriodId: dto.financialPeriodId,
        requestedBy: userId,
        reason: dto.reason,
        affectedModules: dto.affectedModules ?? [],
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        impactAnalysis,
        status: 'PENDING',
      },
    });
    await this.audit.record({ tenantId, eventType: 'PERIOD_REOPEN_REQUESTED', entityType: 'PeriodReopenRequest', entityId: request.id, action: 'CREATE', userId, reason: dto.reason });
    return request;
  }

  /** Impact analysis (spec sections 118, 120-122): given the entry
   * step(s) affected, compute the FULL transitive descendant set on the
   * latest close run's own dependency edges. */
  private async impactAnalysis(tenantId: string, closeRunId: string, entrySteps: string[]) {
    const edges = await this.graph.getEdges(tenantId);
    const affected = new Set<string>(entrySteps);
    for (const step of entrySteps) {
      for (const d of this.graph.transitiveDescendants(step, edges)) affected.add(d);
    }
    const steps = await this.prisma.periodCloseStep.findMany({ where: { tenantId, closeRunId, stepCode: { in: Array.from(affected) } } });
    return { affectedSteps: steps.map((s) => ({ stepCode: s.stepCode, name: s.name, currentStatus: s.status })) };
  }

  async approve(tenantId: string, userId: string, requestId: string) {
    const request = await this.get(tenantId, requestId);
    if (request.status !== 'PENDING') throw new ValidationAppError(`Reopen request is ${request.status}, not PENDING`);

    const financialPeriod = await this.prisma.financialPeriod.findUniqueOrThrow({ where: { id: request.financialPeriodId } });
    const latestRun = await this.prisma.periodCloseRun.findFirst({ where: { tenantId, financialPeriodId: request.financialPeriodId, closeType: { in: ['REGULAR_CLOSE', 'RECLOSE', 'YEAR_END_CLOSE'] } }, orderBy: { createdAt: 'desc' } });

    const impact = request.impactAnalysis as { affectedSteps?: { stepCode: string }[] } | null;
    const invalidatedStepCodes = (impact?.affectedSteps ?? []).map((s) => s.stepCode);

    if (latestRun && invalidatedStepCodes.length > 0) {
      await this.prisma.periodCloseStep.updateMany({ where: { tenantId, closeRunId: latestRun.id, stepCode: { in: invalidatedStepCodes } }, data: { status: 'INVALIDATED' } });
    }

    await this.lock.reopen(tenantId, financialPeriod.id, userId, request.reason);

    const updated = await this.prisma.periodReopenRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), invalidatedSteps: invalidatedStepCodes },
    });
    await this.audit.record({ tenantId, eventType: 'PERIOD_REOPENED', entityType: 'PeriodReopenRequest', entityId: request.id, action: 'UPDATE', userId, newValues: { invalidatedStepCodes } });
    await this.audit.record({ tenantId, eventType: 'CLOSE_STEPS_INVALIDATED', entityType: 'PeriodCloseRun', entityId: latestRun?.id ?? 'none', action: 'UPDATE', userId, newValues: { invalidatedStepCodes } });
    return updated;
  }

  async reject(tenantId: string, userId: string, requestId: string, note?: string) {
    const request = await this.get(tenantId, requestId);
    if (request.status !== 'PENDING') throw new ValidationAppError(`Reopen request is ${request.status}, not PENDING`);
    return this.prisma.periodReopenRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', approvedBy: userId, approvedAt: new Date() } });
  }

  list(tenantId: string, financialPeriodId: string) {
    return this.prisma.periodReopenRequest.findMany({ where: { tenantId, financialPeriodId }, orderBy: { requestDate: 'desc' } });
  }

  private async get(tenantId: string, id: string) {
    const request = await this.prisma.periodReopenRequest.findFirst({ where: { id, tenantId } });
    if (!request) throw new NotFoundAppError('PeriodReopenRequest', id);
    return request;
  }
}
