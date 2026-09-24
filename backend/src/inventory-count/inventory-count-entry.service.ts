import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { UnitConversionService } from '../counterparty-pricing/unit-conversion.service';
import { CountSerialDuplicateError, CountSessionInvalidStateError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SubmitInventoryCountEntryDto } from './dto/inventory-count-entry.dto';

/**
 * InventoryCountEntryService — capture of a physical count (spec sections
 * 21-29, 81, 86, 104). Deliberately never reads `InventoryCountSnapshotLine`
 * (the accounting/book quantity): under a blind count that figure must
 * never reach the counter, and the simplest way to guarantee that is for
 * this service to be structurally incapable of seeing it. Comparison
 * against the book quantity is Task #11's Variance engine, which runs
 * only after the sheet is submitted.
 *
 * A second submission for the exact same dimension tuple on the same
 * sheet is a CORRECTION, not a new entry (spec section 29) — the prior
 * value is preserved in `InventoryCountEntryVersion`, never overwritten
 * silently. `countedQuantity = 0` is a real, distinct entry from no entry
 * ever having been submitted for that tuple (spec section 86).
 */
@Injectable()
export class InventoryCountEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly unitConversion: UnitConversionService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, sessionId: string, sheetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSheetInSession(tenantId, organizationId, sessionId, sheetId);
    return this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sheetId, voided: false }, include: { serials: true }, orderBy: { countedAt: 'asc' } });
  }

  async submit(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, sheetId: string, dto: SubmitInventoryCountEntryDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (session.status !== 'COUNTING') throw new CountSessionInvalidStateError('Count entries can only be submitted while the session is COUNTING');

      const sheet = await tx.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId } });
      if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
      if (sheet.status === 'COMPLETED') throw new ValidationAppError('Cannot submit an entry against a completed count sheet');

      // Offline/mobile idempotency (spec sections 81, 104) — a retried
      // submission with the same clientEntryId is a no-op, not a
      // duplicate or a second correction.
      if (dto.clientEntryId) {
        const already = await tx.inventoryCountEntry.findFirst({ where: { tenantId, sessionId, clientEntryId: dto.clientEntryId, voided: false } });
        if (already) return tx.inventoryCountEntry.findFirst({ where: { id: already.id }, include: { serials: true } });
      }

      const product = await tx.product.findFirst({ where: { id: dto.productId, tenantId } });
      if (!product) throw new ValidationAppError('Entry references an unknown product');

      const countedQuantity = new Decimal(dto.countedQuantity);
      if (countedQuantity.lt(0)) throw new ValidationAppError('Counted quantity cannot be negative');

      let baseQuantity: Decimal;
      if (dto.unitId === product.baseUnitId) {
        baseQuantity = countedQuantity;
      } else {
        const converted = await this.unitConversion.convert(tenantId, dto.unitId, product.baseUnitId, countedQuantity);
        if (!converted) throw new ValidationAppError('No unit conversion is configured from the counted unit to this product\'s base unit');
        baseQuantity = converted;
      }

      if (dto.batchId) {
        const batch = await tx.batch.findFirst({ where: { id: dto.batchId, tenantId, productId: product.id } });
        if (!batch) throw new ValidationAppError('Entry references a batch that does not belong to this product');
      } else if (product.batchTrackingMode === 'REQUIRED') {
        throw new ValidationAppError(`Product ${product.code} requires a batch to be specified for counting`);
      }

      const ownershipType = dto.ownershipType ?? 'OWN';
      const qualityStatus = dto.qualityStatus ?? 'AVAILABLE';

      const serialNumbers = dto.serialNumbers ?? [];
      if (product.serialTrackingMode === 'REQUIRED' && serialNumbers.length === 0 && countedQuantity.gt(0)) {
        throw new ValidationAppError(`Product ${product.code} requires serial numbers to be specified for a nonzero count`);
      }
      if (serialNumbers.length > 0 && !baseQuantity.eq(serialNumbers.length)) {
        throw new ValidationAppError(`Counted quantity (${baseQuantity.toString()}) does not match the number of serial numbers provided (${serialNumbers.length})`);
      }
      const uniqueSerials = new Set(serialNumbers);
      if (uniqueSerials.size !== serialNumbers.length) {
        throw new CountSerialDuplicateError(serialNumbers.find((s, i) => serialNumbers.indexOf(s) !== i)!);
      }

      const existing = await tx.inventoryCountEntry.findFirst({
        where: { tenantId, sheetId, warehouseId: dto.warehouseId, locationId: dto.locationId ?? null, productId: product.id, batchId: dto.batchId ?? null, ownershipType, qualityStatus, voided: false },
      });

      if (serialNumbers.length > 0) {
        await this.assertSerialsNotDuplicated(tx, tenantId, sessionId, serialNumbers, existing?.id);
      }

      if (existing) {
        await tx.inventoryCountEntryVersion.create({
          data: { tenantId, entryId: existing.id, oldQuantity: existing.countedQuantity, newQuantity: baseQuantity.toString(), changedBy: userId, reason: dto.reason },
        });
        const updated = await tx.inventoryCountEntry.update({
          where: { id: existing.id },
          data: {
            countedQuantity: countedQuantity.toString(),
            baseQuantity: baseQuantity.toString(),
            unitId: dto.unitId,
            countedAt: new Date(),
            countedBy: userId,
            entryMethod: dto.entryMethod ?? existing.entryMethod,
            barcode: dto.barcode,
            notes: dto.notes,
            clientEntryId: dto.clientEntryId ?? existing.clientEntryId,
            entryVersion: { increment: 1 },
          },
        });
        await tx.inventoryCountEntrySerial.deleteMany({ where: { tenantId, entryId: existing.id } });
        for (const serialNumber of serialNumbers) {
          await tx.inventoryCountEntrySerial.create({ data: { tenantId, entryId: existing.id, serialNumber } });
        }
        await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_ENTRY_CORRECTED', entityType: 'INVENTORY_COUNT_ENTRY', entityId: existing.id, action: 'UPDATE', userId, oldValues: { countedQuantity: existing.countedQuantity.toString() }, newValues: { countedQuantity: countedQuantity.toString() } }, tx);
        return tx.inventoryCountEntry.findFirst({ where: { id: existing.id }, include: { serials: true } });
      }

      const created = await tx.inventoryCountEntry.create({
        data: {
          tenantId,
          sessionId,
          sheetId,
          warehouseId: dto.warehouseId,
          locationId: dto.locationId,
          productId: product.id,
          batchId: dto.batchId,
          ownershipType,
          qualityStatus,
          unitId: dto.unitId,
          countedQuantity: countedQuantity.toString(),
          baseQuantity: baseQuantity.toString(),
          countedBy: userId,
          entryMethod: dto.entryMethod ?? 'MANUAL',
          barcode: dto.barcode,
          notes: dto.notes,
          clientEntryId: dto.clientEntryId,
        },
      });
      for (const serialNumber of serialNumbers) {
        await tx.inventoryCountEntrySerial.create({ data: { tenantId, entryId: created.id, serialNumber } });
      }
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_ENTRY_SUBMITTED', entityType: 'INVENTORY_COUNT_ENTRY', entityId: created.id, action: 'CREATE', userId, newValues: { productId: product.id, countedQuantity: countedQuantity.toString() } }, tx);
      return tx.inventoryCountEntry.findFirst({ where: { id: created.id }, include: { serials: true } });
    });
  }

  async voidEntry(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, sheetId: string, entryId: string, reason?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSheetInSession(tenantId, organizationId, sessionId, sheetId);

    const entry = await this.prisma.inventoryCountEntry.findFirst({ where: { id: entryId, tenantId, sheetId } });
    if (!entry) throw new NotFoundAppError('InventoryCountEntry', entryId);
    if (entry.voided) return entry;

    const updated = await this.prisma.inventoryCountEntry.update({ where: { id: entryId }, data: { voided: true } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_ENTRY_VOIDED', entityType: 'INVENTORY_COUNT_ENTRY', entityId: entryId, action: 'UPDATE', userId, newValues: { reason } });
    return updated;
  }

  /** Supervisor-only comparison view (permission-gated at the controller
   * with INVENTORY_COUNT_VIEW_ACCOUNTING_QUANTITY) — the one place the
   * book quantity from `submit`'s blind path is allowed to surface. */
  async compareToSnapshot(tenantId: string, membershipId: string, organizationId: string, sessionId: string, sheetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const sheet = await this.assertSheetInSession(tenantId, organizationId, sessionId, sheetId);

    const [entries, snapshotLines] = await Promise.all([
      this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sheetId, voided: false }, include: { serials: true } }),
      this.prisma.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId, warehouseId: sheet.warehouseId, locationId: sheet.locationId } }),
    ]);

    const snapshotByKey = new Map(snapshotLines.map((l) => [this.tupleKey(l.productId, l.batchId, l.serialId, l.ownershipType, l.qualityStatus), l]));
    return entries.map((entry) => {
      const match = snapshotByKey.get(this.tupleKey(entry.productId, entry.batchId, null, entry.ownershipType, entry.qualityStatus));
      return { entry, accountingQuantity: match ? match.accountingQuantity.toString() : '0' };
    });
  }

  private tupleKey(productId: string, batchId: string | null, serialId: string | null, ownershipType: string, qualityStatus: string) {
    return [productId, batchId ?? '', serialId ?? '', ownershipType, qualityStatus].join('::');
  }

  private async assertSerialsNotDuplicated(tx: PrismaTransactionClient, tenantId: string, sessionId: string, serialNumbers: string[], excludeEntryId?: string) {
    const rows = await tx.inventoryCountEntrySerial.findMany({
      where: { tenantId, serialNumber: { in: serialNumbers }, entry: { sessionId, voided: false, ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}) } },
    });
    if (rows.length > 0) throw new CountSerialDuplicateError(rows[0].serialNumber);
  }

  private async assertSheetInSession(tenantId: string, organizationId: string, sessionId: string, sheetId: string) {
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    return sheet;
  }
}
