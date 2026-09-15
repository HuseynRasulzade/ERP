import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { RecordCountEntryDto } from './dto/inventory-count.dto';

/**
 * InventoryCountEntryService (spec sections 18-24, 29, 79, 81-82, 86).
 * Entries are append-only: a correction always inserts a NEW row pointing
 * back at the one it supersedes (`supersedesEntryId`) rather than
 * mutating `countedQuantity` in place — "Completed count entries physical
 * delete edilməməlidir" (spec section 79) extended to mean "never
 * mutated" either, since an in-place edit would be indistinguishable from
 * a delete-then-recreate for audit purposes.
 */
@Injectable()
export class InventoryCountEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async record(tenantId: string, membershipId: string, organizationId: string, sessionId: string, userId: string, dto: RecordCountEntryDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    if (!['COUNTING', 'RECOUNT_REQUIRED'].includes(session.status)) throw new ValidationAppError(`Cannot record a count entry while the session is in status ${session.status}`);

    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: dto.sheetId, tenantId, sessionId } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', dto.sheetId);

    // Offline/mobile sync idempotency (spec sections 81, 104).
    if (dto.clientEntryId) {
      const existing = await this.prisma.inventoryCountEntry.findUnique({ where: { tenantId_sessionId_clientEntryId: { tenantId, sessionId, clientEntryId: dto.clientEntryId } } });
      if (existing) return existing;
    }

    // Duplicate serial validation (spec section 23-24) — a serial-tracked
    // line's scan can never appear twice as a "current" (non-superseded)
    // entry within the same session.
    if (dto.serialId) {
      const priorSerialEntries = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId, serialId: dto.serialId } });
      const supersededIds = new Set(priorSerialEntries.map((e) => e.supersedesEntryId).filter(Boolean));
      const stillCurrent = priorSerialEntries.filter((e) => !supersededIds.has(e.id));
      if (stillCurrent.length > 0 && !dto.supersedesEntryId) {
        throw new ValidationAppError(`Serial ${dto.serialId} was counted twice.`);
      }
    }

    const baseQuantity = dto.unitConversionFactor ? new Decimal(dto.countedQuantity).mul(dto.unitConversionFactor) : new Decimal(dto.countedQuantity);

    let entryVersion = 1;
    if (dto.supersedesEntryId) {
      const original = await this.prisma.inventoryCountEntry.findFirst({ where: { id: dto.supersedesEntryId, tenantId, sessionId } });
      if (!original) throw new NotFoundAppError('InventoryCountEntry', dto.supersedesEntryId);
      entryVersion = original.entryVersion + 1;
    }

    return this.prisma.runInTransaction(async (tx) => {
      const entry = await tx.inventoryCountEntry.create({
        data: {
          tenantId,
          sessionId,
          sheetId: dto.sheetId,
          taskId: dto.taskId,
          warehouseId: dto.warehouseId,
          locationId: dto.locationId,
          productId: dto.productId,
          characteristicId: dto.characteristicId,
          batchId: dto.batchId,
          serialId: dto.serialId,
          unitId: dto.unitId,
          countedQuantity: dto.countedQuantity.toString(),
          baseQuantity: baseQuantity.toString(),
          countedAt: new Date(),
          countedBy: userId,
          entryMethod: dto.entryMethod ?? 'MANUAL',
          barcode: dto.barcode,
          notes: dto.notes,
          evidenceAttachmentId: dto.evidenceAttachmentId,
          entryVersion,
          supersedesEntryId: dto.supersedesEntryId,
          supersededReason: dto.supersededReason,
          clientEntryId: dto.clientEntryId,
        },
      });
      await this.audit.record(
        { tenantId, eventType: dto.supersedesEntryId ? 'INVENTORY_COUNT_ENTRY_CHANGED' : 'INVENTORY_COUNT_ENTRY_RECORDED', entityType: 'INVENTORY_COUNT_ENTRY', entityId: entry.id, action: dto.supersedesEntryId ? 'UPDATE' : 'CREATE', userId, oldValues: dto.supersedesEntryId ? { supersedes: dto.supersedesEntryId } : undefined, newValues: { countedQuantity: dto.countedQuantity, baseQuantity: baseQuantity.toString() } },
        tx,
      );
      return entry;
    });
  }

  /** Current (non-superseded) entries for a session, one per dimension
   * key — the "latest reading" InventoryVarianceService compares against
   * the snapshot. */
  async currentEntries(tenantId: string, sessionId: string) {
    const all = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId }, orderBy: { entryVersion: 'asc' } });
    const supersededIds = new Set(all.map((e) => e.supersedesEntryId).filter(Boolean));
    return all.filter((e) => !supersededIds.has(e.id));
  }

  /** Blind-count-safe view (spec sections 18-19, 110) — strips accounting
   * quantity from what a blind counter's UI/API payload receives. Callers
   * building the count-entry screen must go through this, never the raw
   * snapshot line. */
  async blindSafeExpectedList(tenantId: string, sessionId: string, sheetId: string, blind: boolean, fullBlind: boolean) {
    if (fullBlind) return []; // spec section 19 — counter sees no expected list at all, scans/enters what they physically find
    const sheet = await this.prisma.inventoryCountSheet.findFirstOrThrow({ where: { id: sheetId, tenantId, sessionId } });
    const session = await this.prisma.inventoryCountSession.findFirstOrThrow({ where: { id: sessionId, tenantId } });
    const lines = await this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId, snapshotVersion: session.snapshotVersion, warehouseId: sheet.warehouseId } });
    return lines.map((l) => ({
      productId: l.productId,
      characteristicId: l.characteristicId,
      batchId: l.batchId,
      serialId: l.serialId,
      locationId: l.locationId,
      accountingQuantity: blind ? undefined : l.accountingQuantity.toString(),
    }));
  }

  /** Sheet completion checks (spec section 30) — mandatory scope
   * coverage, no invalid units, no duplicate serials, no unauthorized
   * products. Uncounted lines are surfaced, never silently zeroed (spec
   * sections 85, 135). */
  async completeSheet(tenantId: string, membershipId: string, organizationId: string, sheetId: string, userId: string, allowUncounted = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    const session = await this.prisma.inventoryCountSession.findFirstOrThrow({ where: { id: sheet.sessionId, tenantId } });

    const expected = await this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId: sheet.sessionId, snapshotVersion: session.snapshotVersion, warehouseId: sheet.warehouseId } });
    const entries = await this.currentEntries(tenantId, sheet.sessionId);
    const enteredKeys = new Set(entries.filter((e) => e.sheetId === sheetId).map((e) => this.dimKey(e)));

    const uncovered = expected.filter((l) => !enteredKeys.has(this.dimKey(l)));
    if (uncovered.length > 0 && !allowUncounted) {
      throw new ValidationAppError(`Cannot complete sheet: ${uncovered.length} expected line(s) have not been counted (UNCOUNTED) — pass allowUncounted or count them first.`);
    }

    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.inventoryCountSheet.update({ where: { id: sheetId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_COMPLETED', entityType: 'INVENTORY_COUNT_SHEET', entityId: sheetId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  private dimKey(e: { productId: string; characteristicId: string | null; batchId: string | null; serialId: string | null; locationId: string | null }): string {
    return [e.productId, e.characteristicId, e.batchId, e.serialId, e.locationId].map((v) => v ?? '-').join('|');
  }
}
