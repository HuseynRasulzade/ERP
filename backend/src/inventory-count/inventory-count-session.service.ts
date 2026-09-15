import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { StartSessionDto } from './dto/inventory-count.dto';

const SESSION_TYPE = 'INVENTORY_COUNT_SESSION';
const SEQUENCE_PREFIX = 'IC-S';

/**
 * InventoryCountSessionService (spec sections 7, 16-17, 87). Orchestrates
 * the DRAFT -> READY -> SNAPSHOT_CREATED -> COUNTING -> ... -> CLOSED
 * lifecycle (spec section 7's status list). Freeze enforcement itself
 * lives in `inventory-freeze.guard.ts` (a single choke point inside
 * `InventoryMovementService`) — this service only flips
 * `status`/`snapshotAt` so that guard's own scope-lookup query finds an
 * active session to enforce against.
 */
@Injectable()
export class InventoryCountSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly snapshot: InventorySnapshotService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.inventoryCountSession.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.inventoryCountSession.findFirst({ where: { id, organizationId }, include: { plan: { include: { scopes: true } }, sheets: true, reconciliation: true } });
    if (!row) throw new NotFoundAppError('InventoryCountSession', id);
    return row;
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, planId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const plan = await this.prisma.inventoryCountPlan.findFirst({ where: { id: planId, organizationId } });
    if (!plan) throw new NotFoundAppError('InventoryCountPlan', planId);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SESSION_TYPE, new Date(), tx);
      const session = await tx.inventoryCountSession.create({
        data: { tenantId, organizationId, planId, sessionNumber: allocated.formatted, status: 'DRAFT', freezePolicy: plan.freezePolicy, blindCount: plan.blindCountEnabled },
      });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_STARTED', entityType: SESSION_TYPE, entityId: session.id, action: 'CREATE', userId, newValues: { sessionNumber: session.sessionNumber } }, tx);
      return session;
    });
  }

  async start(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string, dto: StartSessionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.getOrThrow(tenantId, organizationId, sessionId);
    const plan = await this.prisma.inventoryCountPlan.findFirstOrThrow({ where: { id: session.planId } });
    const scopeCount = await this.prisma.inventoryCountScope.count({ where: { planId: session.planId } });
    if (scopeCount === 0) throw new ValidationAppError('Count session cannot start because no inventory scope has been defined.');
    if (session.status !== 'DRAFT') throw new ValidationAppError(`Cannot start a session in status ${session.status}`);

    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryCountSession.update({
        where: { id: sessionId },
        data: { status: 'READY', startedAt: new Date(), startedBy: userId, cutoffMode: dto.cutoffMode ?? session.cutoffMode, fullBlindCount: dto.fullBlindCount ?? session.fullBlindCount, teamMembersJson: dto.teamMembersJson ?? session.teamMembersJson },
      });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_STARTED', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId, newValues: { status: 'READY' } }, tx);
      return updated;
    });
  }

  /** Snapshot generation (spec sections 8-10) — versioned, immutable once
   * written; `snapshotVersion` increments only on a controlled restart
   * (spec section 103), never implicitly. */
  async createSnapshot(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.getOrThrow(tenantId, organizationId, sessionId);
    if (!['READY', 'DRAFT'].includes(session.status)) throw new ValidationAppError(`Cannot snapshot a session in status ${session.status}`);

    const scopes = await this.prisma.inventoryCountScope.findMany({ where: { planId: session.planId } });
    const warehouseIds = [...new Set(scopes.map((s) => s.warehouseId).filter((v): v is string => !!v))];
    const productIds = [...new Set(scopes.map((s) => s.productId).filter((v): v is string => !!v))];

    const nextVersion = session.snapshotVersion + 1;
    const snapshotAt = new Date();

    return this.prisma.runInTransaction(async (tx) => {
      const lineCount = await this.snapshot.generate(tenantId, organizationId, sessionId, nextVersion, snapshotAt, { warehouseIds, productIds }, tx);
      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'SNAPSHOT_CREATED', snapshotAt, snapshotVersion: nextVersion } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_SNAPSHOT_CREATED', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId, newValues: { snapshotVersion: nextVersion, lineCount } }, tx);
      return updated;
    });
  }

  /** Freeze activation is implicit in reaching SNAPSHOT_CREATED+ status
   * for a HARD_FREEZE plan (the guard checks status membership, not a
   * separate boolean) — this method exists for the explicit
   * freeze/unfreeze commands spec section 109's UI describes, and for
   * SOFT_FREEZE sessions that still want an auditable freeze/unfreeze
   * toggle without a status change. */
  async setFrozen(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string, frozen: boolean) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.getOrThrow(tenantId, organizationId, sessionId);
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: frozen ? (session.status === 'DRAFT' || session.status === 'READY' ? 'SNAPSHOT_CREATED' : session.status) : 'UNDER_REVIEW' } });
      await this.audit.record({ tenantId, eventType: frozen ? 'INVENTORY_FREEZE_ACTIVATED' : 'INVENTORY_FREEZE_OVERRIDDEN', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  async transitionTo(tenantId: string, sessionId: string, status: string, userId: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_STATUS_CHANGED', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId, newValues: { status } }, tx);
      return updated;
    });
  }

  /** Generates one count sheet per warehouse in scope (spec section 16) —
   * a simple, correct default; splitting a sheet into per-location tasks
   * (spec section 17) is a follow-up call to `addTask` once sheets exist,
   * left to the caller/UI rather than guessed here. */
  async generateSheets(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.getOrThrow(tenantId, organizationId, sessionId);
    if (session.status !== 'SNAPSHOT_CREATED') throw new ValidationAppError('Cannot generate count sheets before a snapshot exists');

    const warehouses = await this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId, snapshotVersion: session.snapshotVersion }, distinct: ['warehouseId'], select: { warehouseId: true } });

    return this.prisma.runInTransaction(async (tx) => {
      const sheets = [];
      for (const [i, w] of warehouses.entries()) {
        const sheet = await tx.inventoryCountSheet.create({
          data: { tenantId, sessionId, sheetNumber: `${session.sessionNumber}-SH${i + 1}`, warehouseId: w.warehouseId, sequence: i, blindCount: session.blindCount, status: 'GENERATED' },
        });
        sheets.push(sheet);
      }
      await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'COUNTING' } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SHEETS_GENERATED', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId, newValues: { sheetCount: sheets.length } }, tx);
      return sheets;
    });
  }

  async addTask(tenantId: string, sheetId: string, locationId: string | undefined, assignedUserId: string | undefined) {
    return this.prisma.inventoryCountTask.create({ data: { tenantId, sheetId, locationId, assignedUserId } });
  }

  async getOrThrow(tenantId: string, organizationId: string, sessionId: string) {
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    return session;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SESSION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: SESSION_TYPE, documentType: SESSION_TYPE, prefix: SEQUENCE_PREFIX, padding: 4, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
