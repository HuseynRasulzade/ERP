import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { RequestContextService } from '../common/context/request-context.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { COUNTING_STATUSES, INVENTORY_COUNT_ADJUSTMENT_TYPE, INVENTORY_COUNT_SESSION_TYPE } from './inventory-count.constants';
import { CountIncompleteError, CountInvalidStateError, CountSnapshotExistsError, CountWarehouseAccessError } from './inventory-count.errors';
import { InventoryCountScopeService, ResolvedScope } from './inventory-count-scope.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryFreezeService } from './inventory-freeze.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';

export type PlanRow = Awaited<ReturnType<PrismaService['inventoryCountPlan']['findFirstOrThrow']>>;
export type SessionRow = Awaited<ReturnType<PrismaService['inventoryCountSession']['findFirstOrThrow']>>;

/**
 * InventoryCountSessionService (spec sections 7, 10, 11-14, 69-70) — the
 * session lifecycle (start, snapshot, freeze/unfreeze, complete counting,
 * cancel/reopen) plus the shared helpers every other Phase 12 service uses
 * to load the plan's current session, guard its status transitions with
 * optimistic concurrency, and enforce warehouse-level count access and
 * blind-count visibility.
 */
@Injectable()
export class InventoryCountSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly requestContext: RequestContextService,
    private readonly scopes: InventoryCountScopeService,
    private readonly snapshots: InventorySnapshotService,
    private readonly freezes: InventoryFreezeService,
    private readonly events: InventoryCountEventsService,
  ) {}

  // -- shared helpers -------------------------------------------------------

  async loadPlan(tenantId: string, membershipId: string, organizationId: string, planId: string, tx?: PrismaTransactionClient): Promise<PlanRow> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const db = tx ?? this.prisma;
    const plan = await db.inventoryCountPlan.findFirst({ where: { id: planId, tenantId, organizationId } });
    if (!plan) throw new NotFoundAppError('InventoryCount', planId);
    return plan;
  }

  async loadContext(tenantId: string, membershipId: string, organizationId: string, planId: string, tx?: PrismaTransactionClient): Promise<{ plan: PlanRow; session: SessionRow }> {
    const plan = await this.loadPlan(tenantId, membershipId, organizationId, planId, tx);
    if (!plan.currentSessionId) throw new CountInvalidStateError('This inventory count has no active session; start the count first.');
    const db = tx ?? this.prisma;
    const session = await db.inventoryCountSession.findFirst({ where: { id: plan.currentSessionId, tenantId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', plan.currentSessionId);
    return { plan, session };
  }

  assertStatus(session: SessionRow, allowed: string[], action: string) {
    if (!allowed.includes(session.status)) {
      throw new CountInvalidStateError(`Cannot ${action}: inventory count session ${session.sessionNumber} is ${session.status} (allowed: ${allowed.join(', ')}).`);
    }
  }

  /** Optimistic-concurrency guarded session update (the session row's
   * `version` is bumped on every transition). */
  async updateSession(tx: PrismaTransactionClient, session: SessionRow, data: Record<string, unknown>): Promise<SessionRow> {
    const res = await tx.inventoryCountSession.updateMany({ where: { id: session.id, version: session.version }, data: { ...data, version: { increment: 1 } } });
    if (res.count === 0) throw new ConcurrencyConflictError();
    return tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
  }

  resolveScope(tenantId: string, organizationId: string, planId: string, tx?: PrismaTransactionClient): Promise<ResolvedScope> {
    return this.scopes.resolve(tenantId, organizationId, planId, tx);
  }

  /** Ids of this session's own adjustment documents — excluded from
   * "post-snapshot movements" (they ARE the count's result). */
  async ownAdjustmentIds(tenantId: string, sessionId: string, tx?: PrismaTransactionClient): Promise<string[]> {
    const db = tx ?? this.prisma;
    const docs = await db.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId }, select: { id: true } });
    return docs.map((d) => d.id);
  }

  /** Accounting (book) quantity visibility (spec sections 18-20, 118):
   * hidden from everybody while a blind count is still counting; after
   * that only for holders of INVENTORY_COUNT_VIEW_ACCOUNTING_QTY. */
  canSeeAccountingQty(session: SessionRow): boolean {
    if (!this.requestContext.hasPermission(PermissionCodes.INVENTORY_COUNT_VIEW_ACCOUNTING_QTY)) return false;
    if (session.blindCount && ['READY', ...COUNTING_STATUSES].includes(session.status)) return false;
    return true;
  }

  canSeeCost(): boolean {
    return this.requestContext.hasPermission(PermissionCodes.INVENTORY_COUNT_VIEW_COST);
  }

  hasPermission(code: string): boolean {
    return this.requestContext.hasPermission(code);
  }

  /** Warehouse-level count access (spec section 76): a counter must be on
   * the plan's team, be the plan's responsible/manager, be assigned to a
   * sheet/task of that warehouse — or hold the all-warehouses permission. */
  async assertCanCount(tenantId: string, plan: PlanRow, session: SessionRow, warehouseId: string, userId: string, tx?: PrismaTransactionClient) {
    if (this.requestContext.hasPermission(PermissionCodes.INVENTORY_VIEW_ALL_WAREHOUSES)) return;
    if (plan.responsibleUserId === userId || plan.countManagerId === userId) return;
    const db = tx ?? this.prisma;
    const team = await db.inventoryCountTeamMember.findFirst({ where: { tenantId, planId: plan.id, userId, role: { not: 'OBSERVER' } } });
    if (team) return;
    const sheet = await db.inventoryCountSheet.findFirst({ where: { tenantId, sessionId: session.id, warehouseId, OR: [{ assignedUserId: userId }, { tasks: { some: { assignedUserId: userId } } }] } });
    if (sheet) return;
    const wh = await db.warehouse.findFirst({ where: { id: warehouseId }, select: { code: true } });
    throw new CountWarehouseAccessError(wh?.code ?? warehouseId);
  }

  // -- lifecycle ------------------------------------------------------------

  async start(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const plan = await this.loadPlan(tenantId, membershipId, organizationId, planId);
    if (plan.status !== 'DRAFT') throw new CountInvalidStateError(`Inventory count ${plan.documentNumber} is ${plan.status}; only a DRAFT plan can be started.`);
    const scope = await this.scopes.resolve(tenantId, organizationId, planId); // throws "no inventory scope" when empty
    if (scope.warehouseIds.length === 0) throw new ValidationAppError('The inventory count scope resolves to no warehouse');
    const rules = await this.scopes.activeRules(tenantId, planId);

    return this.prisma.runInTransaction(async (tx) => {
      const attempts = await tx.inventoryCountSession.count({ where: { tenantId, planId } });
      const sessionNumber = attempts === 0 ? plan.documentNumber : `${plan.documentNumber}-R${attempts + 1}`;
      const session = await tx.inventoryCountSession.create({
        data: {
          tenantId,
          organizationId,
          planId,
          sessionNumber,
          status: 'READY',
          freezePolicy: plan.freezePolicy,
          blindCount: plan.blindCountEnabled,
          accountingQuantityVisibility: plan.blindCountEnabled ? 'HIDDEN' : 'VISIBLE',
          scopeRevision: rules[0]?.revision ?? 1,
          startedBy: userId,
        },
      });
      const res = await tx.inventoryCountPlan.updateMany({ where: { id: planId, version: plan.version }, data: { status: 'IN_PROGRESS', currentSessionId: session.id, version: { increment: 1 } } });
      if (res.count === 0) throw new ConcurrencyConflictError();
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_SESSION_STARTED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'START', userId, newValues: { sessionNumber, planId, scopeRevision: session.scopeRevision, freezePolicy: session.freezePolicy } }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.STARTED, { sessionId: session.id, planId }, { sessionNumber }, tx);
      return session;
    });
  }

  async snapshot(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, opts: { restart?: boolean; reason?: string }) {
    const { plan, session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    if (session.snapshotVersion > 0 && !opts.restart) throw new CountSnapshotExistsError(session.snapshotVersion);
    if (opts.restart) {
      if (!opts.reason) throw new ValidationAppError('A controlled snapshot restart requires a reason');
      this.assertStatus(session, ['SNAPSHOT_CREATED', 'COUNTING'], 'restart the snapshot');
      const entries = await this.prisma.inventoryCountEntry.count({ where: { tenantId, sessionId: session.id, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } });
      if (entries > 0) throw new CountInvalidStateError('The snapshot cannot be recreated after counting has started; cancel/reopen the session instead.');
    } else {
      this.assertStatus(session, ['READY'], 'create the snapshot');
    }
    const scope = await this.scopes.resolve(tenantId, organizationId, plan.id);

    return this.prisma.runInTransaction(async (tx) => {
      const snapshotAt = new Date();
      const version = session.snapshotVersion + 1;
      const result = await this.snapshots.createSnapshot(tenantId, organizationId, session.id, version, scope, snapshotAt, tx);
      const updated = await this.updateSession(tx, session, { snapshotVersion: version, snapshotAt, status: 'SNAPSHOT_CREATED', reconciliationStatus: 'IN_PROGRESS' });
      await this.events.audit(
        tenantId,
        { eventType: opts.restart ? 'INVENTORY_COUNT_SNAPSHOT_RESTARTED' : 'INVENTORY_COUNT_SNAPSHOT_GENERATED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'SNAPSHOT', userId, newValues: { snapshotVersion: version, snapshotAt, lineCount: result.lineCount }, reason: opts.reason },
        tx,
      );
      await this.events.emit(tenantId, InventoryCountEvents.SNAPSHOT_CREATED, { sessionId: session.id, planId: plan.id }, { snapshotVersion: version, lineCount: result.lineCount }, tx);
      return { session: updated, snapshotVersion: version, snapshotAt, lineCount: result.lineCount };
    });
  }

  async freeze(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { plan, session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    this.assertStatus(session, ['READY', 'SNAPSHOT_CREATED', 'COUNTING', 'RECOUNT_REQUIRED', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'APPROVED'], 'freeze stock movements');
    if (session.freezePolicy === 'NO_FREEZE_WITH_MOVEMENT_TRACKING') {
      throw new ValidationAppError('This count uses NO_FREEZE_WITH_MOVEMENT_TRACKING; post-snapshot movements are reconciled instead of frozen.');
    }
    if (session.freezeActive) return session;
    const scope = await this.scopes.resolve(tenantId, organizationId, plan.id);
    return this.prisma.runInTransaction(async (tx) => {
      const lockCount = await this.freezes.activate(tenantId, session, session.freezePolicy, scope, userId, tx);
      const updated = await this.updateSession(tx, session, { freezeActive: true });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_FREEZE_ENABLED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'FREEZE', userId, newValues: { policy: session.freezePolicy, lockCount } }, tx);
      return updated;
    });
  }

  async unfreeze(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, reason?: string) {
    const { session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    if (!session.freezeActive) return session;
    return this.prisma.runInTransaction(async (tx) => {
      const released = await this.freezes.release(tenantId, session.id, userId, tx);
      const updated = await this.updateSession(tx, session, { freezeActive: false });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_FREEZE_RELEASED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'UNFREEZE', userId, newValues: { released }, reason }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.FREEZE_RELEASED, { sessionId: session.id, planId: session.planId }, { released }, tx);
      return updated;
    });
  }

  /** Counting finished (spec section 30): every sheet must be COMPLETED.
   * Fixes the global count cutoff; variances are calculated right after
   * (and only now — blind count, spec section 118). */
  async completeCount(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    this.assertStatus(session, ['SNAPSHOT_CREATED', 'COUNTING'], 'complete counting');
    const sheets = await this.prisma.inventoryCountSheet.findMany({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' } } });
    if (sheets.length === 0) throw new CountIncompleteError('Counting cannot be completed: no count sheets have been generated.');
    const open = sheets.filter((s) => s.status !== 'COMPLETED');
    if (open.length > 0) throw new CountIncompleteError(`Counting cannot be completed: ${open.length} count sheet(s) are not completed (${open.map((s) => s.sheetNumber).join(', ')}).`, { openSheets: open.map((s) => s.sheetNumber) });
    return this.prisma.runInTransaction(async (tx) => {
      const now = new Date();
      const updated = await this.updateSession(tx, session, { status: 'UNDER_REVIEW', countCutoffAt: now, completedAt: now, completedBy: userId });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_COMPLETED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'COMPLETE', userId, newValues: { countCutoffAt: now } }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.COMPLETED, { sessionId: session.id, planId: session.planId }, { countCutoffAt: now.toISOString() }, tx);
      return updated;
    });
  }

  /**
   * Cancel (spec section 70) — only while no count adjustment is posted
   * (a posted one must first be reversed via the document unpost, i.e. a
   * controlled reversal). Snapshot/entries/recounts/variances are never
   * deleted. `reopen` additionally returns the plan to DRAFT so its scope
   * can go through a controlled revision and a new session be started.
   */
  async cancel(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, reason: string | undefined, reopen: boolean) {
    const { plan, session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    if (!reason) throw new ValidationAppError('A reason is required to cancel or reopen an inventory count session');
    this.assertStatus(session, ['READY', 'SNAPSHOT_CREATED', 'COUNTING', 'RECOUNT_REQUIRED', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'RECONCILED'], reopen ? 'reopen' : 'cancel');
    const posted = await this.prisma.inventoryCountAdjustment.count({ where: { tenantId, sessionId: session.id, postingStatus: 'POSTED' } });
    if (posted > 0) throw new CountInvalidStateError(`Inventory count session ${session.sessionNumber} has ${posted} posted adjustment document(s); unpost them (controlled reversal) before cancelling.`);

    return this.prisma.runInTransaction(async (tx) => {
      await this.freezes.release(tenantId, session.id, userId, tx);
      await tx.inventoryCountAdjustment.updateMany({ where: { tenantId, sessionId: session.id, postingStatus: 'NOT_POSTED', status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: userId } });
      await tx.approvalStep.updateMany({ where: { tenantId, documentType: INVENTORY_COUNT_SESSION_TYPE, documentId: session.id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
      const updated = await this.updateSession(tx, session, { status: 'CANCELLED', freezeActive: false, cancelledAt: new Date(), cancelledBy: userId, cancelReason: reason });
      await tx.inventoryCountPlan.update({ where: { id: plan.id }, data: reopen ? { status: 'DRAFT', currentSessionId: null, version: { increment: 1 } } : { status: 'CANCELLED', version: { increment: 1 } } });
      await this.events.audit(tenantId, { eventType: reopen ? 'INVENTORY_COUNT_SESSION_REOPENED' : 'INVENTORY_COUNT_SESSION_CANCELLED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: reopen ? 'REOPEN' : 'CANCEL', userId, oldValues: { status: session.status }, reason }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.CANCELLED, { sessionId: session.id, planId: plan.id }, { reopen, reason }, tx);
      return updated;
    });
  }

  async getSessionDetail(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { plan, session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    const locks = await this.prisma.inventoryCountFreezeLock.findMany({ where: { tenantId, sessionId: session.id, active: true } });
    return { plan, session, freezeLocks: locks };
  }

  /** Movement tracking view (spec sections 14, 64): every in-scope movement
   * recorded after the snapshot, with its cutoff classification. */
  async postSnapshotMovements(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { plan, session } = await this.loadContext(tenantId, membershipId, organizationId, planId);
    if (!session.snapshotAt) return [];
    const scope = await this.scopes.resolve(tenantId, organizationId, plan.id);
    const own = await this.ownAdjustmentIds(tenantId, session.id);
    const rows = await this.snapshots.getMovementsAfter(tenantId, organizationId, scope, session.snapshotAt, null, own);
    const showQty = this.canSeeAccountingQty(session);
    return rows.map((m) => ({
      ...m,
      quantity: showQty ? m.quantity.toString() : undefined,
      beforeGlobalCutoff: session.countCutoffAt ? m.recordedAt <= session.countCutoffAt : null,
      isOwnAdjustment: m.registrarDocumentType === INVENTORY_COUNT_ADJUSTMENT_TYPE,
    }));
  }
}
