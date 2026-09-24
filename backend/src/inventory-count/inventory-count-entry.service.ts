import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { COUNTING_STATUSES, INVENTORY_COUNT_SESSION_TYPE, stockLineKey } from './inventory-count.constants';
import {
  CountDuplicateEntryError,
  CountImportInvalidError,
  CountInvalidStateError,
  CountOutOfScopeError,
  CountSerialDuplicateError,
  CountUnitConversionError,
} from './inventory-count.errors';
import { InventoryCountSessionService, PlanRow, SessionRow } from './inventory-count-session.service';
import { InventoryCountSheetService } from './inventory-count-sheet.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';
import { ResolvedScope } from './inventory-count-scope.service';
import { CountEntryItemDto, ImportEntriesDto, ReviewUnknownItemDto, ScanDto, UpdateEntryDto } from './dto/inventory-count.dto';

interface ResolvedEntry {
  sheetId: string;
  taskId: string | null;
  warehouseId: string;
  locationId: string | null;
  productId: string | null;
  characteristicId: string | null;
  batchId: string | null;
  serialId: string | null;
  serialNumberText: string | null;
  ownershipType: string;
  ownerCounterpartyId: string | null;
  stockStatus: string;
  unitId: string | null;
  countedQuantity: Decimal;
  conversionFactor: Decimal;
  baseQuantity: Decimal;
  entryMethod: string;
  barcode: string | null;
  notes: string | null;
  evidenceAttachmentId: string | null;
  clientEntryId: string | null;
  countedAt: Date;
  unknownItemDescription: string | null;
}

const PHYSICAL_STATUSES = ['AVAILABLE', 'QUARANTINE', 'QUALITY_CONTROL', 'REJECTED', 'DAMAGED', 'BLOCKED', 'EXPIRED'];

/**
 * InventoryCountEntryService (spec sections 21-24, 29, 79-86, 104).
 * Every entry is validated against the session scope, the sheet,
 * warehouse count access, unit conversion (historical factor frozen on
 * the entry), serial uniqueness and the duplicate-entry policy, and is
 * idempotent on `clientEntryId` (mobile/offline/API/import re-sends never
 * double count). Entries are never deleted: edits bump `entryVersion` and
 * write an `InventoryCountEntryVersion` row; wrong lines are VOIDED.
 */
@Injectable()
export class InventoryCountEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly sheets: InventoryCountSheetService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async record(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, items: CountEntryItemDto[]) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'record count entries');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);

    return this.prisma.runInTransaction(async (tx) => {
      const out = [];
      for (const item of items) {
        if (item.clientEntryId) {
          const existing = await tx.inventoryCountEntry.findFirst({ where: { sessionId: session.id, clientEntryId: item.clientEntryId } });
          if (existing) {
            out.push({ ...existing, idempotentReplay: true });
            continue;
          }
        }
        const resolved = await this.resolveItem(tenantId, organizationId, plan, session, scope, item, userId, tx);
        out.push(await this.insert(tenantId, plan, session, resolved, userId, tx));
      }
      if (session.status === 'SNAPSHOT_CREATED') await this.sessions.updateSession(tx, session, { status: 'COUNTING' });
      return out;
    });
  }

  /** Scanner flow (spec section 23). Resolves the barcode to a product /
   * serial / batch; repeated scans either increment the open entry or
   * create separate entries per the sheet's barcode mode. */
  async scan(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, dto: ScanDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'scan count entries');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);

    return this.prisma.runInTransaction(async (tx) => {
      if (dto.clientEntryId) {
        const existing = await tx.inventoryCountEntry.findFirst({ where: { sessionId: session.id, clientEntryId: dto.clientEntryId } });
        if (existing) return { ...existing, idempotentReplay: true };
      }
      const code = dto.barcode.trim();
      const item: CountEntryItemDto = { sheetId: dto.sheetId, taskId: dto.taskId, locationId: dto.locationId, stockStatus: dto.stockStatus, unitId: dto.unitId, quantity: dto.quantity ?? 1, entryMethod: 'BARCODE', barcode: code, clientEntryId: dto.clientEntryId };

      const serial = await tx.serialNumber.findFirst({ where: { tenantId, organizationId, serialNumber: code } });
      if (serial) {
        item.productId = serial.productId;
        item.serialId = serial.id;
        item.quantity = 1;
      } else {
        const product = await tx.product.findFirst({ where: { tenantId, organizationId, OR: [{ barcode: code }, { sku: code }, { code }] } });
        if (product) item.productId = product.id;
        else {
          const batch = await tx.batch.findFirst({ where: { tenantId, organizationId, batchNumber: code } });
          if (!batch) throw new ValidationAppError(`Barcode ${code} does not resolve to any product, batch or serial of this organization`);
          item.productId = batch.productId;
          item.batchId = batch.id;
        }
      }

      const resolved = await this.resolveItem(tenantId, organizationId, plan, session, scope, item, userId, tx);
      const sheet = await tx.inventoryCountSheet.findFirstOrThrow({ where: { id: resolved.sheetId } });
      if (!resolved.serialId && !resolved.serialNumberText && sheet.barcodeMode === 'INCREMENT') {
        const key = stockLineKey(resolved);
        const open = await tx.inventoryCountEntry.findFirst({
          where: { tenantId, sessionId: session.id, sheetId: sheet.id, lineKey: key, entryMethod: 'BARCODE', status: 'ACTIVE', unitId: resolved.unitId, countedBy: userId },
          orderBy: { countedAt: 'desc' },
        });
        if (open) {
          const newQty = new Decimal(open.countedQuantity.toString()).plus(resolved.countedQuantity);
          const newBase = newQty.times(open.conversionFactor.toString());
          const updated = await tx.inventoryCountEntry.update({ where: { id: open.id }, data: { countedQuantity: newQty.toString(), baseQuantity: newBase.toString(), isExplicitZero: newQty.isZero(), countedAt: new Date(), entryVersion: { increment: 1 } } });
          await tx.inventoryCountEntryVersion.create({
            data: { tenantId, entryId: open.id, entryVersion: updated.entryVersion, changeType: 'SCAN_INCREMENT', oldQuantity: open.countedQuantity.toString(), newQuantity: newQty.toString(), oldBaseQty: open.baseQuantity.toString(), newBaseQty: newBase.toString(), changedBy: userId, reason: `scan ${code}` },
          });
          return updated;
        }
      }
      const created = await this.insert(tenantId, plan, session, resolved, userId, tx);
      if (session.status === 'SNAPSHOT_CREATED') await this.sessions.updateSession(tx, session, { status: 'COUNTING' });
      return created;
    });
  }

  /**
   * CSV import (spec sections 80, 104). Header (case-insensitive):
   * warehouse, location, product_code, barcode, characteristic, batch,
   * serial, quantity, unit[, status, external_entry_id]. All rows are
   * validated first; any invalid row rejects the whole file (nothing is
   * imported) — an unknown product is never silently created.
   */
  async importCsv(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, dto: ImportEntriesDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'import count entries');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);
    const rows = this.parseCsv(dto.csv);
    if (rows.length === 0) throw new ValidationAppError('The import file has no data rows');

    return this.prisma.runInTransaction(async (tx) => {
      const errors: { row: number; message: string }[] = [];
      const resolvedRows: { resolved: ResolvedEntry | null; replay: boolean }[] = [];
      for (const [i, r] of rows.entries()) {
        try {
          const externalId = r.external_entry_id || r.client_entry_id || null;
          if (externalId) {
            const existing = await tx.inventoryCountEntry.findFirst({ where: { sessionId: session.id, clientEntryId: externalId } });
            if (existing) {
              resolvedRows.push({ resolved: null, replay: true });
              continue;
            }
          }
          const item = await this.importRowToItem(tenantId, organizationId, dto.sheetId, r, tx);
          item.clientEntryId = externalId ?? undefined;
          resolvedRows.push({ resolved: await this.resolveItem(tenantId, organizationId, plan, session, scope, item, userId, tx), replay: false });
        } catch (e) {
          errors.push({ row: i + 2, message: (e as Error).message });
        }
      }
      if (errors.length > 0) throw new CountImportInvalidError({ errors });
      let imported = 0;
      let replayed = 0;
      for (const r of resolvedRows) {
        if (r.replay || !r.resolved) {
          replayed += 1;
          continue;
        }
        await this.insert(tenantId, plan, session, r.resolved, userId, tx);
        imported += 1;
      }
      if (session.status === 'SNAPSHOT_CREATED') await this.sessions.updateSession(tx, session, { status: 'COUNTING' });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ENTRIES_IMPORTED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'IMPORT', userId, newValues: { imported, replayed } }, tx);
      return { imported, replayed };
    });
  }

  async list(tenantId: string, membershipId: string, organizationId: string, planId: string, filter: { sheetId?: string; includeHistory?: boolean }) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    return this.prisma.inventoryCountEntry.findMany({
      where: { tenantId, sessionId: session.id, ...(filter.sheetId ? { sheetId: filter.sheetId } : {}) },
      include: filter.includeHistory ? { versions: { orderBy: { entryVersion: 'asc' } } } : undefined,
      orderBy: { countedAt: 'asc' },
    });
  }

  /** Count change (spec section 29) — the old value is preserved in the
   * version history; allowed only until the sheet is completed (after
   * that a correction must be a recount, spec section 79). */
  async update(tenantId: string, membershipId: string, organizationId: string, planId: string, entryId: string, userId: string, dto: UpdateEntryDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'change a count entry');
    const entry = await this.loadEditable(tenantId, session, entryId);
    await this.sessions.assertCanCount(tenantId, plan, session, entry.warehouseId, userId);
    if (entry.serialId || entry.serialNumberText) {
      if (dto.quantity !== 0 && dto.quantity !== 1) throw new ValidationAppError('A serial entry quantity can only be 0 or 1');
    }
    const newQty = new Decimal(dto.quantity);
    const newBase = newQty.times(entry.conversionFactor.toString());
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryCountEntry.update({ where: { id: entry.id }, data: { countedQuantity: newQty.toString(), baseQuantity: newBase.toString(), isExplicitZero: newQty.isZero(), entryVersion: { increment: 1 } } });
      await tx.inventoryCountEntryVersion.create({
        data: { tenantId, entryId: entry.id, entryVersion: updated.entryVersion, changeType: 'QUANTITY_CHANGED', oldQuantity: entry.countedQuantity.toString(), newQuantity: newQty.toString(), oldBaseQty: entry.baseQuantity.toString(), newBaseQty: newBase.toString(), changedBy: userId, reason: dto.reason },
      });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ENTRY_CHANGED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'UPDATE_ENTRY', userId, oldValues: { entryId, quantity: entry.countedQuantity.toString() }, newValues: { entryId, quantity: newQty.toString() }, reason: dto.reason }, tx);
      return updated;
    });
  }

  async void(tenantId: string, membershipId: string, organizationId: string, planId: string, entryId: string, userId: string, reason?: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, COUNTING_STATUSES, 'void a count entry');
    if (!reason) throw new ValidationAppError('A reason is required to void a count entry');
    const entry = await this.loadEditable(tenantId, session, entryId);
    await this.sessions.assertCanCount(tenantId, plan, session, entry.warehouseId, userId);
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryCountEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED', entryVersion: { increment: 1 } } });
      await tx.inventoryCountEntryVersion.create({ data: { tenantId, entryId: entry.id, entryVersion: updated.entryVersion, changeType: 'VOIDED', oldQuantity: entry.countedQuantity.toString(), newQuantity: null, changedBy: userId, reason } });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ENTRY_VOIDED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'VOID_ENTRY', userId, oldValues: { entryId, quantity: entry.countedQuantity.toString() }, reason }, tx);
      return updated;
    });
  }

  /** Unknown item supervisor review (spec section 83): ACCEPT maps the
   * found item onto an EXISTING product (a counter never creates product
   * master data); REJECT discards it from the count. */
  async reviewUnknown(tenantId: string, membershipId: string, organizationId: string, planId: string, entryId: string, userId: string, dto: ReviewUnknownItemDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, [...COUNTING_STATUSES, 'UNDER_REVIEW', 'RECOUNT_REQUIRED'], 'review an unknown item');
    const entry = await this.prisma.inventoryCountEntry.findFirst({ where: { id: entryId, tenantId, sessionId: session.id, status: 'PENDING_REVIEW' } });
    if (!entry) throw new NotFoundAppError('Unknown inventory item', entryId);
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);
    return this.prisma.runInTransaction(async (tx) => {
      let data: Record<string, unknown>;
      if (dto.action === 'ACCEPT') {
        if (!dto.productId) throw new ValidationAppError('productId (an existing product) is required to accept an unknown item');
        const product = await tx.product.findFirst({ where: { id: dto.productId, tenantId, organizationId } });
        if (!product) throw new ValidationAppError('Product not found in this organization');
        const row = { ...entry, productId: product.id };
        if (!scope.matches(row)) throw new CountOutOfScopeError(`Product ${product.code} is outside the scope of inventory count ${session.sessionNumber}.`);
        const unitId = entry.unitId ?? product.baseUnitId;
        const factor = await this.conversionFactor(tenantId, unitId, product.baseUnitId, tx);
        data = { productId: product.id, unitId, conversionFactor: factor.toString(), baseQuantity: new Decimal(entry.countedQuantity.toString()).times(factor).toString(), status: 'ACTIVE', lineKey: stockLineKey(row) };
      } else {
        data = { status: 'REJECTED' };
      }
      const updated = await tx.inventoryCountEntry.update({ where: { id: entry.id }, data: { ...data, reviewedBy: userId, reviewedAt: new Date(), entryVersion: { increment: 1 } } });
      await tx.inventoryCountEntryVersion.create({ data: { tenantId, entryId: entry.id, entryVersion: updated.entryVersion, changeType: 'REVIEWED', oldQuantity: entry.countedQuantity.toString(), newQuantity: entry.countedQuantity.toString(), changedBy: userId, reason: `${dto.action}${dto.comment ? `: ${dto.comment}` : ''}` } });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_UNKNOWN_ITEM_REVIEWED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: dto.action, userId, newValues: { entryId, productId: dto.productId ?? null }, reason: dto.comment }, tx);
      return updated;
    });
  }

  // -- internals ------------------------------------------------------------

  private async loadEditable(tenantId: string, session: SessionRow, entryId: string) {
    const entry = await this.prisma.inventoryCountEntry.findFirst({ where: { id: entryId, tenantId, sessionId: session.id } });
    if (!entry) throw new NotFoundAppError('InventoryCountEntry', entryId);
    if (entry.status !== 'ACTIVE' && entry.status !== 'PENDING_REVIEW') throw new CountInvalidStateError(`Count entry is ${entry.status}`);
    const sheet = await this.prisma.inventoryCountSheet.findFirstOrThrow({ where: { id: entry.sheetId } });
    if (sheet.status === 'COMPLETED') throw new CountInvalidStateError(`Count sheet ${sheet.sheetNumber} is completed; correct the count through a recount instead.`);
    return entry;
  }

  private async insert(tenantId: string, plan: PlanRow, session: SessionRow, r: ResolvedEntry, userId: string, tx: PrismaTransactionClient) {
    const isUnknown = !r.productId;
    const lineKey = isUnknown ? null : stockLineKey(r);

    // Serial uniqueness (spec sections 23, 30, 82): a serial counts once per session.
    if (r.serialId || r.serialNumberText) {
      const dup = await tx.inventoryCountEntry.findFirst({
        where: { tenantId, sessionId: session.id, status: 'ACTIVE', ...(r.serialId ? { serialId: r.serialId } : { productId: r.productId, serialNumberText: r.serialNumberText }) },
      });
      if (dup) {
        let label = r.serialNumberText;
        if (!label && r.serialId) label = (await tx.serialNumber.findFirst({ where: { id: r.serialId }, select: { serialNumber: true } }))?.serialNumber ?? r.serialId;
        throw new CountSerialDuplicateError(label!);
      }
    }
    if (!isUnknown && plan.duplicateEntryPolicy === 'BLOCK_DUPLICATE') {
      const dup = await tx.inventoryCountEntry.findFirst({ where: { tenantId, sessionId: session.id, lineKey, status: 'ACTIVE' } });
      if (dup) throw new CountDuplicateEntryError();
    }

    const entry = await tx.inventoryCountEntry.create({
      data: {
        tenantId,
        sessionId: session.id,
        sheetId: r.sheetId,
        taskId: r.taskId,
        lineKey,
        warehouseId: r.warehouseId,
        locationId: r.locationId,
        productId: r.productId,
        characteristicId: r.characteristicId,
        batchId: r.batchId,
        serialId: r.serialId,
        serialNumberText: r.serialNumberText,
        ownershipType: r.ownershipType,
        ownerCounterpartyId: r.ownerCounterpartyId,
        stockStatus: r.stockStatus,
        unitId: r.unitId,
        countedQuantity: r.countedQuantity.toString(),
        conversionFactor: r.conversionFactor.toString(),
        baseQuantity: r.baseQuantity.toString(),
        isExplicitZero: r.countedQuantity.isZero(),
        countedAt: r.countedAt,
        countedBy: userId,
        entryMethod: r.entryMethod,
        barcode: r.barcode,
        notes: r.notes,
        evidenceAttachmentId: r.evidenceAttachmentId,
        clientEntryId: r.clientEntryId,
        status: isUnknown ? 'PENDING_REVIEW' : 'ACTIVE',
        unknownItemDescription: r.unknownItemDescription,
      },
    });
    await tx.inventoryCountEntryVersion.create({ data: { tenantId, entryId: entry.id, entryVersion: 1, changeType: 'CREATED', newQuantity: entry.countedQuantity.toString(), newBaseQty: entry.baseQuantity.toString(), changedBy: userId } });
    await tx.inventoryCountSheet.updateMany({ where: { id: r.sheetId, status: 'OPEN' }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    if (r.taskId) await tx.inventoryCountTask.updateMany({ where: { id: r.taskId, status: 'OPEN' }, data: { status: 'IN_PROGRESS', startAt: new Date() } });
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_ENTRY_RECORDED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'ENTER', userId, newValues: { entryId: entry.id, lineKey, quantity: entry.countedQuantity.toString(), baseQuantity: entry.baseQuantity.toString(), method: entry.entryMethod } }, tx);
    await this.events.emit(tenantId, InventoryCountEvents.ENTRY_RECORDED, { sessionId: session.id, planId: plan.id }, { entryId: entry.id, lineKey, method: entry.entryMethod }, tx);
    return entry;
  }

  private async resolveItem(tenantId: string, organizationId: string, plan: PlanRow, session: SessionRow, scope: ResolvedScope, item: CountEntryItemDto, userId: string, tx: PrismaTransactionClient): Promise<ResolvedEntry> {
    const sheet = await tx.inventoryCountSheet.findFirst({ where: { id: item.sheetId, tenantId, sessionId: session.id } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', item.sheetId);
    if (sheet.status === 'COMPLETED' || sheet.status === 'CANCELLED') throw new CountInvalidStateError(`Count sheet ${sheet.sheetNumber} is ${sheet.status}.`);
    if (item.warehouseId && item.warehouseId !== sheet.warehouseId) throw new ValidationAppError('Entry warehouse does not match the count sheet warehouse');
    await this.sessions.assertCanCount(tenantId, plan, session, sheet.warehouseId, userId, tx);

    let taskId: string | null = null;
    let locationId = item.locationId ?? null;
    if (item.taskId) {
      const task = await tx.inventoryCountTask.findFirst({ where: { id: item.taskId, sheetId: sheet.id } });
      if (!task) throw new ValidationAppError('Task does not belong to this count sheet');
      if (task.status === 'COMPLETED') throw new CountInvalidStateError('This count task is already completed');
      taskId = task.id;
      locationId = locationId ?? task.locationId;
    }
    if (locationId) {
      const loc = await tx.warehouseLocation.findFirst({ where: { id: locationId, tenantId, warehouseId: sheet.warehouseId } });
      if (!loc) throw new ValidationAppError('Location does not belong to the count sheet warehouse');
      if (sheet.locationScope && !(await this.sheets.subtree(tenantId, sheet.locationScope, tx)).includes(locationId)) throw new CountOutOfScopeError(`Location ${loc.code} is outside count sheet ${sheet.sheetNumber}.`);
    }

    // Product
    let product = null as null | { id: string; code: string; baseUnitId: string; serialTrackingMode: string; batchTrackingMode: string };
    if (item.productId) product = await tx.product.findFirst({ where: { id: item.productId, tenantId, organizationId } });
    else if (item.productCode) product = await tx.product.findFirst({ where: { code: item.productCode, tenantId, organizationId } });
    else if (item.barcode) product = await tx.product.findFirst({ where: { tenantId, organizationId, OR: [{ barcode: item.barcode }, { sku: item.barcode }] } });
    if ((item.productId || item.productCode) && !product) throw new ValidationAppError(`Unknown product ${item.productId ?? item.productCode} — products are never created from a count; report it as an unknown item instead.`);

    const quantity = new Decimal(item.quantity);
    if (quantity.isNegative()) throw new ValidationAppError('Counted quantity cannot be negative');
    const stockStatus = item.stockStatus ?? 'AVAILABLE';
    if (!PHYSICAL_STATUSES.includes(stockStatus)) throw new ValidationAppError(`Invalid stock status ${stockStatus}`);

    if (!product) {
      if (!item.unknownItemDescription && !item.barcode) throw new ValidationAppError('An entry needs a product (id/code/barcode) or an unknown-item description');
      return {
        sheetId: sheet.id, taskId, warehouseId: sheet.warehouseId, locationId, productId: null, characteristicId: null, batchId: null, serialId: null,
        serialNumberText: item.serialNumber ?? null, ownershipType: item.ownershipType ?? 'OWN', ownerCounterpartyId: item.ownerCounterpartyId ?? null, stockStatus,
        unitId: item.unitId ?? null, countedQuantity: quantity, conversionFactor: new Decimal(1), baseQuantity: quantity, entryMethod: item.entryMethod ?? 'MANUAL',
        barcode: item.barcode ?? null, notes: item.notes ?? null, evidenceAttachmentId: item.evidenceAttachmentId ?? null, clientEntryId: item.clientEntryId ?? null,
        countedAt: item.countedAt ? new Date(item.countedAt) : new Date(), unknownItemDescription: item.unknownItemDescription ?? `Unknown barcode ${item.barcode}`,
      };
    }

    // Batch
    let batchId: string | null = null;
    if (item.batchId) {
      const b = await tx.batch.findFirst({ where: { id: item.batchId, tenantId, organizationId, productId: product.id } });
      if (!b) throw new ValidationAppError('Batch does not belong to this product');
      batchId = b.id;
    } else if (item.batchNumber) {
      const b = await tx.batch.findFirst({ where: { tenantId, organizationId, productId: product.id, batchNumber: item.batchNumber } });
      if (!b) throw new ValidationAppError(`Unknown batch ${item.batchNumber} for product ${product.code}`);
      batchId = b.id;
    }
    if (!batchId && product.batchTrackingMode === 'REQUIRED' && !quantity.isZero()) throw new ValidationAppError(`Product ${product.code} is batch-controlled: count it per batch`);

    // Serial
    let serialId: string | null = null;
    let serialNumberText: string | null = null;
    if (item.serialId) {
      const s = await tx.serialNumber.findFirst({ where: { id: item.serialId, tenantId, organizationId, productId: product.id } });
      if (!s) throw new ValidationAppError('Serial does not belong to this product');
      serialId = s.id;
    } else if (item.serialNumber) {
      const s = await tx.serialNumber.findFirst({ where: { tenantId, organizationId, productId: product.id, serialNumber: item.serialNumber } });
      if (s) serialId = s.id;
      else serialNumberText = item.serialNumber;
    }
    if ((serialId || serialNumberText) && !quantity.eq(1) && !quantity.isZero()) throw new ValidationAppError('A serial-numbered unit is counted with quantity 1 (or an explicit 0)');
    if (!serialId && !serialNumberText && product.serialTrackingMode === 'REQUIRED' && !quantity.isZero()) throw new ValidationAppError(`Product ${product.code} is serial-controlled: record the actual serial numbers found`);

    // Unit conversion (spec section 22) — historical factor frozen on the entry.
    const unitId = item.unitId ?? product.baseUnitId;
    const factor = await this.conversionFactor(tenantId, unitId, product.baseUnitId, tx);

    const resolved: ResolvedEntry = {
      sheetId: sheet.id,
      taskId,
      warehouseId: sheet.warehouseId,
      locationId,
      productId: product.id,
      characteristicId: item.characteristicId ?? null,
      batchId,
      serialId,
      serialNumberText,
      ownershipType: item.ownershipType ?? 'OWN',
      ownerCounterpartyId: item.ownerCounterpartyId ?? null,
      stockStatus,
      unitId,
      countedQuantity: quantity,
      conversionFactor: factor,
      baseQuantity: quantity.times(factor),
      entryMethod: item.entryMethod ?? 'MANUAL',
      barcode: item.barcode ?? null,
      notes: item.notes ?? null,
      evidenceAttachmentId: item.evidenceAttachmentId ?? null,
      clientEntryId: item.clientEntryId ?? null,
      countedAt: item.countedAt ? new Date(item.countedAt) : new Date(),
      unknownItemDescription: null,
    };
    if (!scope.matches(resolved)) throw new CountOutOfScopeError(`Product ${product.code} at this location/status is outside the scope of inventory count ${session.sessionNumber}.`);
    return resolved;
  }

  async conversionFactor(tenantId: string, unitId: string, baseUnitId: string, tx: PrismaTransactionClient): Promise<Decimal> {
    if (unitId === baseUnitId) return new Decimal(1);
    const direct = await tx.unitConversion.findFirst({ where: { tenantId, fromUnitId: unitId, toUnitId: baseUnitId, active: true } });
    if (direct) return new Decimal(direct.factor.toString());
    const inverse = await tx.unitConversion.findFirst({ where: { tenantId, fromUnitId: baseUnitId, toUnitId: unitId, active: true } });
    if (inverse) return new Decimal(1).div(inverse.factor.toString());
    const units = await tx.unitOfMeasure.findMany({ where: { id: { in: [unitId, baseUnitId] } }, select: { id: true, code: true } });
    const code = (id: string) => units.find((u) => u.id === id)?.code ?? id;
    throw new CountUnitConversionError(code(unitId), code(baseUnitId));
  }

  private async importRowToItem(tenantId: string, organizationId: string, sheetId: string, r: Record<string, string>, tx: PrismaTransactionClient): Promise<CountEntryItemDto> {
    const quantity = Number(r.quantity);
    if (r.quantity === undefined || r.quantity === '' || Number.isNaN(quantity) || quantity < 0) throw new ValidationAppError(`Invalid quantity "${r.quantity ?? ''}"`);
    const item: CountEntryItemDto = { sheetId, quantity, entryMethod: 'IMPORT' };
    if (r.warehouse) {
      const wh = await tx.warehouse.findFirst({ where: { tenantId, organizationId, code: r.warehouse } });
      if (!wh) throw new ValidationAppError(`Unknown warehouse ${r.warehouse}`);
      item.warehouseId = wh.id;
      if (r.location) {
        const loc = await tx.warehouseLocation.findFirst({ where: { tenantId, warehouseId: wh.id, code: r.location } });
        if (!loc) throw new ValidationAppError(`Unknown location ${r.location}`);
        item.locationId = loc.id;
      }
    } else if (r.location) {
      const sheet = await tx.inventoryCountSheet.findFirst({ where: { id: sheetId } });
      const loc = await tx.warehouseLocation.findFirst({ where: { tenantId, warehouseId: sheet?.warehouseId, code: r.location } });
      if (!loc) throw new ValidationAppError(`Unknown location ${r.location}`);
      item.locationId = loc.id;
    }
    if (r.product_code) item.productCode = r.product_code;
    else if (r.barcode) {
      item.barcode = r.barcode;
      const p = await tx.product.findFirst({ where: { tenantId, organizationId, OR: [{ barcode: r.barcode }, { sku: r.barcode }] } });
      if (!p) throw new ValidationAppError(`Unknown product barcode ${r.barcode}`);
      item.productId = p.id;
    } else throw new ValidationAppError('product_code or barcode is required');
    if (r.characteristic) item.characteristicId = r.characteristic;
    if (r.batch) item.batchNumber = r.batch;
    if (r.serial) item.serialNumber = r.serial;
    if (r.status) item.stockStatus = r.status;
    if (r.unit) {
      const u = await tx.unitOfMeasure.findFirst({ where: { tenantId, code: r.unit } });
      if (!u) throw new ValidationAppError(`Unknown unit ${r.unit}`);
      item.unitId = u.id;
    }
    return item;
  }

  private parseCsv(csv: string): Record<string, string>[] {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const header = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return lines.slice(1).map((line) => {
      const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      header.forEach((h, i) => (row[h] = cells[i] ?? ''));
      return row;
    });
  }

  hasReviewPermission() {
    return this.sessions.hasPermission(PermissionCodes.INVENTORY_COUNT_REVIEW);
  }
}
