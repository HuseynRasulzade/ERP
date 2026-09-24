import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { INVENTORY_COUNT_SESSION_TYPE, COUNTING_STATUSES } from './inventory-count.constants';
import { CountIncompleteError, CountInvalidStateError, CountSerialDuplicateError } from './inventory-count.errors';
import { InventoryCountSessionService, SessionRow } from './inventory-count-session.service';
import { InventoryCountEventsService } from './inventory-count-events.service';
import { CreateTaskDto, GenerateSheetsDto } from './dto/inventory-count.dto';

/**
 * Count sheets & tasks (spec sections 16-20, 30, 72). A sheet covers one
 * warehouse (or one top-level location subtree of it); a task narrows a
 * sheet to one location for one counter/team. Expected-line payloads obey
 * blind count: accounting quantities are never serialized while a blind
 * count is counting, and a FULL blind count does not even list the
 * expected items.
 */
@Injectable()
export class InventoryCountSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async generate(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, dto: GenerateSheetsDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['SNAPSHOT_CREATED', 'COUNTING'], 'generate count sheets');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);

    return this.prisma.runInTransaction(async (tx) => {
      const existing = await tx.inventoryCountSheet.count({ where: { tenantId, sessionId: session.id } });
      if (existing > 0) throw new CountInvalidStateError('Count sheets have already been generated for this session.');
      let seq = 0;
      const created = [];
      for (const warehouseId of scope.warehouseIds) {
        let locationRoots: (string | null)[] = [null];
        if (dto.splitByLocation) {
          const where = scope.locationInclude
            ? { tenantId, warehouseId, id: { in: Array.from(scope.locationInclude) } }
            : { tenantId, warehouseId, parentLocationId: null, active: true };
          const locs = await tx.warehouseLocation.findMany({ where, orderBy: { code: 'asc' } });
          const inScopeIds = new Set(locs.map((l) => l.id));
          const roots = locs.filter((l) => !l.parentLocationId || !inScopeIds.has(l.parentLocationId));
          if (roots.length > 0) locationRoots = roots.map((l) => l.id);
        }
        for (const locationScope of locationRoots) {
          seq += 1;
          const sheet = await tx.inventoryCountSheet.create({
            data: {
              tenantId,
              sessionId: session.id,
              sheetNumber: `${session.sessionNumber}-S${String(seq).padStart(2, '0')}`,
              warehouseId,
              locationScope,
              assignedUserId: dto.assignedUserId,
              blindCount: session.blindCount,
              sequence: seq,
              barcodeMode: dto.barcodeMode ?? plan.repeatedScanMode,
            },
          });
          created.push(sheet);
        }
      }
      if (session.status === 'SNAPSHOT_CREATED') await this.sessions.updateSession(tx, session, { status: 'COUNTING' });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_SHEETS_GENERATED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'GENERATE_SHEETS', userId, newValues: { sheetCount: created.length } }, tx);
      return created;
    });
  }

  async list(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const sheets = await this.prisma.inventoryCountSheet.findMany({ where: { tenantId, sessionId: session.id }, include: { tasks: true }, orderBy: { sequence: 'asc' } });
    const counts = await this.prisma.inventoryCountEntry.groupBy({ by: ['sheetId'], where: { tenantId, sessionId: session.id, status: 'ACTIVE' }, _count: { _all: true } });
    const bySheet = new Map(counts.map((c) => [c.sheetId, c._count._all]));
    return sheets.map((s) => ({ ...s, entryCount: bySheet.get(s.id) ?? 0 }));
  }

  /** The sheet as the counter sees it (spec sections 18-20, 110). */
  async getSheet(tenantId: string, membershipId: string, organizationId: string, planId: string, sheetId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId: session.id }, include: { tasks: true } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    const showQty = this.sessions.canSeeAccountingQty(session);
    const expected = plan.fullBlindCount ? null : await this.expectedLines(tenantId, session, sheet, showQty);
    const entries = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sheetId: sheet.id }, orderBy: { countedAt: 'asc' } });
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: sheet.warehouseId }, select: { id: true, code: true, name: true } });
    return { ...sheet, warehouse, blindCount: session.blindCount, fullBlindCount: plan.fullBlindCount, accountingQuantityVisible: showQty, expectedLines: expected, entries };
  }

  /** Expected snapshot lines of a sheet, enriched for display. */
  async expectedLines(tenantId: string, session: SessionRow, sheet: { warehouseId: string; locationScope: string | null }, showQty: boolean, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const locationIds = sheet.locationScope ? await this.subtree(tenantId, sheet.locationScope, db) : null;
    const lines = await db.inventoryCountSnapshotLine.findMany({
      where: { tenantId, sessionId: session.id, snapshotVersion: session.snapshotVersion, warehouseId: sheet.warehouseId, ...(locationIds ? { locationId: { in: locationIds } } : {}) },
      orderBy: [{ locationId: 'asc' }, { productId: 'asc' }],
    });
    const products = await db.product.findMany({ where: { id: { in: Array.from(new Set(lines.map((l) => l.productId))) } }, select: { id: true, code: true, name: true, barcode: true, baseUnitId: true, batchTrackingMode: true, serialTrackingMode: true } });
    const locs = await db.warehouseLocation.findMany({ where: { id: { in: lines.map((l) => l.locationId).filter((x): x is string => !!x) } }, select: { id: true, code: true } });
    const batches = await db.batch.findMany({ where: { id: { in: lines.map((l) => l.batchId).filter((x): x is string => !!x) } }, select: { id: true, batchNumber: true, expiryDate: true } });
    const serials = await db.serialNumber.findMany({ where: { id: { in: lines.map((l) => l.serialId).filter((x): x is string => !!x) } }, select: { id: true, serialNumber: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const lm = new Map(locs.map((l) => [l.id, l.code]));
    const bm = new Map(batches.map((b) => [b.id, b]));
    const sm = new Map(serials.map((s) => [s.id, s.serialNumber]));
    return lines.map((l) => ({
      lineKey: l.lineKey,
      warehouseId: l.warehouseId,
      locationId: l.locationId,
      locationCode: l.locationId ? lm.get(l.locationId) ?? null : null,
      productId: l.productId,
      productCode: pm.get(l.productId)?.code,
      productName: pm.get(l.productId)?.name,
      batchRequired: pm.get(l.productId)?.batchTrackingMode === 'REQUIRED',
      serialRequired: pm.get(l.productId)?.serialTrackingMode === 'REQUIRED',
      characteristicId: l.characteristicId,
      batchId: l.batchId,
      batchNumber: l.batchId ? bm.get(l.batchId)?.batchNumber ?? null : null,
      serialId: l.serialId,
      serialNumber: l.serialId ? sm.get(l.serialId) ?? null : null,
      ownershipType: l.ownershipType,
      stockStatus: l.stockStatus,
      unitId: l.unitId,
      ...(showQty ? { accountingQuantity: l.accountingQuantity.toString() } : {}),
    }));
  }

  async subtree(tenantId: string, rootId: string, db: PrismaTransactionClient | PrismaService = this.prisma): Promise<string[]> {
    const out = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length > 0) {
      const children = await db.warehouseLocation.findMany({ where: { tenantId, parentLocationId: { in: frontier } }, select: { id: true } });
      frontier = children.map((c) => c.id).filter((id) => !out.has(id));
      frontier.forEach((id) => out.add(id));
    }
    return Array.from(out);
  }

  async createTask(tenantId: string, membershipId: string, organizationId: string, planId: string, sheetId: string, userId: string, dto: CreateTaskDto) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'create a count task');
    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId: session.id } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    if (sheet.status === 'COMPLETED') throw new CountInvalidStateError(`Count sheet ${sheet.sheetNumber} is already completed.`);
    if (dto.locationId) {
      const loc = await this.prisma.warehouseLocation.findFirst({ where: { id: dto.locationId, tenantId, warehouseId: sheet.warehouseId } });
      if (!loc) throw new ValidationAppError('Task location does not belong to the sheet warehouse');
      if (sheet.locationScope && !(await this.subtree(tenantId, sheet.locationScope)).includes(dto.locationId)) throw new ValidationAppError('Task location is outside the sheet location scope');
    }
    const task = await this.prisma.inventoryCountTask.create({ data: { tenantId, sessionId: session.id, sheetId, locationId: dto.locationId, assignedUserId: dto.assignedUserId } });
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_TASK_CREATED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'CREATE_TASK', userId, newValues: { sheetId, taskId: task.id, locationId: dto.locationId, assignedUserId: dto.assignedUserId } });
    return task;
  }

  async completeTask(tenantId: string, membershipId: string, organizationId: string, planId: string, taskId: string, userId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const task = await this.prisma.inventoryCountTask.findFirst({ where: { id: taskId, tenantId, sessionId: session.id } });
    if (!task) throw new NotFoundAppError('InventoryCountTask', taskId);
    if (task.status === 'COMPLETED') return task;
    const updated = await this.prisma.inventoryCountTask.update({ where: { id: taskId }, data: { status: 'COMPLETED', finishAt: new Date(), progress: new Decimal(100).toString(), startAt: task.startAt ?? new Date() } });
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_TASK_COMPLETED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'COMPLETE_TASK', userId, newValues: { taskId } });
    return updated;
  }

  /** Sheet completion checks (spec section 30). */
  async completeSheet(tenantId: string, membershipId: string, organizationId: string, planId: string, sheetId: string, userId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'complete a count sheet');
    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId: session.id }, include: { tasks: true } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    if (sheet.status === 'COMPLETED') return sheet;

    const openTasks = sheet.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
    if (openTasks.length > 0) throw new CountIncompleteError(`Count sheet ${sheet.sheetNumber} has ${openTasks.length} incomplete task(s).`);

    const entries = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } } });
    const pendingUnknown = entries.filter((e) => e.sheetId === sheet.id && e.status === 'PENDING_REVIEW');
    if (pendingUnknown.length > 0) throw new CountIncompleteError(`Count sheet ${sheet.sheetNumber} has ${pendingUnknown.length} unknown item(s) awaiting supervisor review.`);

    const seen = new Map<string, number>();
    for (const e of entries.filter((x) => x.status === 'ACTIVE' && (x.serialId || x.serialNumberText))) {
      const k = e.serialId ?? `${e.productId}:${e.serialNumberText}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if ((seen.get(k) ?? 0) > 1) throw new CountSerialDuplicateError(e.serialNumberText ?? e.serialId!);
    }

    if (plan.requireFullCoverage) {
      const expected = await this.expectedLines(tenantId, session, sheet, false);
      const counted = new Set(entries.filter((e) => e.sheetId === sheet.id && e.status === 'ACTIVE').map((e) => e.lineKey));
      const missing = expected.filter((l) => !counted.has(l.lineKey));
      if (missing.length > 0) {
        throw new CountIncompleteError(`Count sheet ${sheet.sheetNumber} cannot be completed: ${missing.length} expected line(s) are uncounted (enter an explicit 0 for items that are physically absent).`, {
          uncounted: missing.map((m) => ({ productCode: m.productCode, locationCode: m.locationCode, batchNumber: m.batchNumber, serialNumber: m.serialNumber })),
        });
      }
    }

    const res = await this.prisma.inventoryCountSheet.updateMany({ where: { id: sheet.id, version: sheet.version }, data: { status: 'COMPLETED', completedAt: new Date(), completedBy: userId, startedAt: sheet.startedAt ?? new Date(), version: { increment: 1 } } });
    if (res.count === 0) throw new CountInvalidStateError('The count sheet was changed concurrently; refresh and retry.');
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_SHEET_COMPLETED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'COMPLETE_SHEET', userId, newValues: { sheetId, sheetNumber: sheet.sheetNumber } });
    return this.prisma.inventoryCountSheet.findFirst({ where: { id: sheet.id } });
  }

  /** Printable count sheet (spec section 72) — accounting quantities are
   * never included for a blind count. */
  async printable(tenantId: string, membershipId: string, organizationId: string, planId: string, sheetId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId: session.id } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId }, select: { code: true, name: true } });
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: sheet.warehouseId }, select: { code: true, name: true } });
    const team = await this.prisma.inventoryCountTeamMember.findMany({ where: { tenantId, planId: plan.id } });
    const users = await this.prisma.user.findMany({ where: { id: { in: team.map((t) => t.userId) } }, select: { id: true, displayName: true, email: true } });
    const um = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
    const showQty = !session.blindCount && this.sessions.canSeeAccountingQty(session);
    const lines = plan.fullBlindCount ? [] : await this.expectedLines(tenantId, session, sheet, showQty);
    return {
      inventoryCountNumber: plan.documentNumber,
      sessionNumber: session.sessionNumber,
      sheetNumber: sheet.sheetNumber,
      organization: org,
      warehouse,
      locationScope: sheet.locationScope,
      countDate: session.snapshotAt ?? plan.planDate,
      blindCount: session.blindCount,
      teamMembers: team.map((t) => ({ role: t.role, name: um.get(t.userId) ?? t.userId })),
      lines: lines.map((l) => ({ ...l, physicalQuantity: null })),
      signatureFields: ['Counter', 'Team lead', 'Warehouse representative', 'Finance representative'],
    };
  }
}
