import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalService } from '../approvals/approval.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole } from '../approvals/role-resolution.util';
import { INVENTORY_COUNT_SESSION_TYPE, dec } from './inventory-count.constants';
import { CountRecountPendingError, CountSegregationOfDutiesError, CountUnresolvedVariancesError } from './inventory-count.errors';
import { InventoryCountSessionService, PlanRow, SessionRow } from './inventory-count-session.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';

const STEP_ROLE: Record<string, string> = {
  WAREHOUSE_SUPERVISOR: 'WAREHOUSE_SUPERVISOR',
  FINANCE: 'FINANCE_USER',
  DIRECTOR: 'DIRECTOR',
  ACCOUNTING: 'ACCOUNTING_USER',
};

/** Default value-tier routing (spec section 48): < 100 → warehouse
 * manager; 100–5,000 → finance manager; above → CFO/director. */
const DEFAULT_THRESHOLDS: { upTo: number | null; stepTypes: string[] }[] = [
  { upTo: 100, stepTypes: ['WAREHOUSE_SUPERVISOR'] },
  { upTo: 5000, stepTypes: ['FINANCE'] },
  { upTo: null, stepTypes: ['DIRECTOR'] },
];

const OPEN_BLOCKING = ['RECOUNT_REQUIRED', 'UNDER_INVESTIGATION'];

/**
 * Approval plan provider for a count session — plugs the session into the
 * platform's approval foundation (ApprovalService / ApprovalStep, the
 * pending-approvals inbox) instead of a bespoke approval table. Routing is
 * value-tiered (plan.approvalThresholds, default spec section 48 tiers)
 * plus a FINANCE step whenever a single shortage line reaches the plan's
 * critical-shortage value (segregation of duties, spec section 74).
 */
@Injectable()
export class InventoryCountApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = INVENTORY_COUNT_SESSION_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    const session = await tx.inventoryCountSession.findFirst({ where: { id: documentId, tenantId }, include: { plan: true } });
    if (!session) return null;
    return { ...session, number: session.sessionNumber, createdBy: session.submittedBy };
  }

  async setApprovalStatus(_tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.inventoryCountSession.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, _organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    const plan = document.plan as PlanRow;
    if (!plan.approvalRequired) return [];
    const lines = await tx.inventoryVariance.findMany({ where: { tenantId, sessionId: document.id, calculationVersion: document.calculationVersion, varianceType: { not: 'MATCH' }, resolutionStatus: { notIn: ['SUPERSEDED', 'MATCHED'] } } });
    if (lines.length === 0) return [];
    const total = lines.reduce((s, l) => s.plus(dec(l.valueDifference).abs()), new Decimal(0));
    const thresholds = (plan.approvalThresholds as any as typeof DEFAULT_THRESHOLDS | null) ?? DEFAULT_THRESHOLDS;
    const tier = thresholds.find((t) => t.upTo == null || total.lt(t.upTo)) ?? thresholds[thresholds.length - 1];
    const steps = [...tier.stepTypes];
    const critical = plan.criticalShortageValue ? dec(plan.criticalShortageValue) : null;
    if (critical && lines.some((l) => dec(l.quantityDifference).lt(0) && dec(l.valueDifference).abs().gte(critical)) && !steps.includes('FINANCE')) steps.push('FINANCE');
    return steps.map((stepType, i) => ({ sequence: i + 1, stepType: stepType as ApprovalStepType }));
  }

  async resolveApprover(tenantId: string, _organizationId: string, stepType: ApprovalStepType, _document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    const role = STEP_ROLE[stepType];
    return role ? userHasRole(tenantId, userId, role, tx) : false;
  }

  getCreatedBy(document: any): string | null {
    return document.submittedBy ?? null;
  }
}

/**
 * InventoryCountApprovalService (spec sections 48, 57, 74): submit for
 * approval, approve/reject through ApprovalService, with the count-
 * specific segregation-of-duties rules layered on top (counter ≠
 * approver; the warehouse's responsible keeper may not approve their own
 * warehouse's count alone).
 */
@Injectable()
export class InventoryCountApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly approvals: ApprovalService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async submit(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['UNDER_REVIEW', 'RECOUNT_REQUIRED'], 'submit for approval');
    await this.assertReadyForApproval(tenantId, plan, session);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.approvalStep.deleteMany({ where: { tenantId, documentType: INVENTORY_COUNT_SESSION_TYPE, documentId: session.id } });
      let s = await this.sessions.updateSession(tx, session, { status: 'PENDING_APPROVAL', submittedAt: new Date(), submittedBy: userId, approvalStatus: 'PENDING' });
      await this.approvals.createStepsForDocument(tenantId, organizationId, INVENTORY_COUNT_SESSION_TYPE, session.id, tx);
      s = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_SUBMITTED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'SUBMIT', userId, newValues: { approvalStatus: s.approvalStatus } }, tx);
      if (s.approvalStatus === 'NOT_REQUIRED') s = await this.markApproved(tenantId, plan, s, userId, tx, true);
      return s;
    });
  }

  async approve(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, comment?: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['PENDING_APPROVAL'], 'approve');
    await this.assertSegregation(tenantId, plan, session, userId);
    const result = await this.approvals.approve(tenantId, organizationId, INVENTORY_COUNT_SESSION_TYPE, session.id, userId, comment);
    if (result.approvalStatus !== 'APPROVED') return this.prisma.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
    return this.prisma.runInTransaction(async (tx) => {
      const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
      return this.markApproved(tenantId, plan, fresh, userId, tx, false, comment);
    });
  }

  async reject(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, comment?: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['PENDING_APPROVAL'], 'reject');
    await this.approvals.reject(tenantId, organizationId, INVENTORY_COUNT_SESSION_TYPE, session.id, userId, comment);
    return this.prisma.runInTransaction(async (tx) => {
      const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
      const updated = await this.sessions.updateSession(tx, fresh, { status: 'UNDER_REVIEW' });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_VARIANCES_REJECTED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'REJECT', userId, reason: comment }, tx);
      return updated;
    });
  }

  steps(tenantId: string, sessionId: string) {
    return this.approvals.getSteps(tenantId, INVENTORY_COUNT_SESSION_TYPE, sessionId);
  }

  /** Blocking conditions before approval (spec sections 44, 69, 83, 85, 114). */
  async assertReadyForApproval(tenantId: string, plan: PlanRow, session: SessionRow, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const pending = await db.inventoryRecount.count({ where: { tenantId, sessionId: session.id, resultStatus: 'PENDING' } });
    if (pending > 0) throw new CountRecountPendingError(pending);
    const lines = await db.inventoryVariance.findMany({
      where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' } },
      include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (session.calculationVersion === 0) throw new CountUnresolvedVariancesError('Variances have not been calculated yet.');
    const blocking = lines.filter((l) => OPEN_BLOCKING.includes(l.resolutionStatus));
    if (blocking.length > 0) throw new CountUnresolvedVariancesError(`${blocking.length} variance line(s) are still under recount/investigation.`, { lines: blocking.map((l) => l.id) });
    const unknownPending = lines.filter((l) => l.varianceType === 'UNKNOWN_PRODUCT');
    if (unknownPending.length > 0) throw new CountUnresolvedVariancesError(`${unknownPending.length} unknown item(s) await supervisor review.`);
    const undecided = lines.filter((l) => l.varianceType !== 'MATCH' && !l.decisions[0] && !l.suggestedResolution);
    if (undecided.length > 0) {
      throw new CountUnresolvedVariancesError(`${undecided.length} variance line(s) (uncounted items / unknown products) need an explicit decision before approval — count them (explicit zero), recount, or decide NO_ADJUSTMENT.`, {
        lines: undecided.map((l) => ({ id: l.id, varianceType: l.varianceType })),
      });
    }
    const confirm = lines.filter((l) => l.varianceType !== 'MATCH' && l.recountAttempts > 0 && !l.decisions[0]?.finalPhysicalQty && ['SUPERVISOR_CONFIRMED', 'MANUAL_APPROVED'].includes(plan.finalQuantityRule));
    if (confirm.length > 0) throw new CountUnresolvedVariancesError(`${confirm.length} recounted line(s) need a supervisor-confirmed final quantity.`);
  }

  private async assertSegregation(tenantId: string, plan: PlanRow, session: SessionRow, userId: string) {
    if (plan.forbidCounterApproval) {
      const counted = await this.prisma.inventoryCountEntry.count({ where: { tenantId, sessionId: session.id, countedBy: userId } });
      const recounted = await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId: session.id, countedBy: userId } });
      if (counted + recounted > 0) throw new CountSegregationOfDutiesError('Segregation of duties: a counter cannot approve the variances of a count they took part in.');
    }
    if (plan.forbidWarehouseKeeperSelfApproval) {
      const whIds = (await this.prisma.inventoryVariance.findMany({ where: { tenantId, sessionId: session.id }, select: { warehouseId: true }, distinct: ['warehouseId'] })).map((w) => w.warehouseId);
      const keepers = await this.prisma.warehouse.findMany({ where: { id: { in: whIds } }, include: { responsible: true } });
      if (keepers.some((w) => (w.responsible as any)?.userId === userId)) throw new CountSegregationOfDutiesError('Segregation of duties: the warehouse keeper cannot approve the count of their own warehouse.');
    }
  }

  private async markApproved(tenantId: string, plan: PlanRow, session: SessionRow, userId: string, tx: PrismaTransactionClient, automatic: boolean, comment?: string) {
    const now = new Date();
    const lines = await tx.inventoryVariance.findMany({
      where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: { notIn: ['SUPERSEDED', 'MATCHED'] } },
      include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    for (const l of lines) {
      const d = l.decisions[0];
      await tx.inventoryVarianceDecision.create({
        data: {
          tenantId,
          varianceId: l.id,
          finalPhysicalQty: l.physicalQuantity?.toString() ?? null,
          acceptedDifference: l.quantityDifference.toString(),
          resolutionType: d?.resolutionType ?? l.suggestedResolution ?? 'NO_ADJUSTMENT',
          reasonCode: d?.reasonCode ?? l.reasonCode,
          approvedCost: d?.approvedCost ?? null,
          decidedBy: d?.decidedBy ?? userId,
          approver: userId,
          approvedAt: now,
          isAutomatic: automatic,
          comment: comment ?? (automatic ? 'No approval required' : undefined),
        },
      });
    }
    await tx.inventoryVariance.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { resolutionStatus: 'APPROVED', approvedBy: userId, approvedAt: now } });
    const updated = await this.sessions.updateSession(tx, session, { status: 'APPROVED', approvedAt: now, approvedBy: userId, ...(automatic ? { approvalStatus: 'NOT_REQUIRED' } : {}) });
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_VARIANCES_APPROVED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'APPROVE', userId, newValues: { lineCount: lines.length, automatic }, reason: comment }, tx);
    await this.events.emit(tenantId, InventoryCountEvents.VARIANCE_APPROVED, { sessionId: session.id, planId: plan.id }, { lineCount: lines.length, automatic }, tx);
    return updated;
  }
}
