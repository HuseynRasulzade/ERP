import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountSessionInvalidStateError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { GenerateInventoryCountSheetsDto } from './dto/inventory-count-sheet.dto';

/**
 * InventoryCountSheetService (spec section 20) — a sheet is the unit of
 * work handed to one counter: everything expected at one warehouse+
 * location. Auto-generated from the session's own (immutable) snapshot
 * lines, one sheet per distinct (warehouse, location) pair actually
 * found there, plus any location the plan wants counted even though the
 * books currently show nothing there (a pure-surplus catch, via
 * `extraSheets`).
 */
@Injectable()
export class InventoryCountSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);
    return this.prisma.inventoryCountSheet.findMany({ where: { tenantId, sessionId }, orderBy: { sequence: 'asc' } });
  }

  async generate(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, dto: GenerateInventoryCountSheetsDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (session.status !== 'SNAPSHOT_CREATED') throw new CountSessionInvalidStateError('Count sheets can only be generated once a session has a snapshot');

      const existing = await tx.inventoryCountSheet.count({ where: { tenantId, sessionId } });
      if (existing > 0) throw new ValidationAppError('Count sheets have already been generated for this session');

      const snapshotLines = await tx.inventoryCountSnapshotLine.findMany({ where: { tenantId, sessionId }, select: { warehouseId: true, locationId: true } });
      const groups = new Map<string, { warehouseId: string; locationId: string | null }>();
      for (const line of snapshotLines) {
        const key = `${line.warehouseId}::${line.locationId ?? ''}`;
        if (!groups.has(key)) groups.set(key, { warehouseId: line.warehouseId, locationId: line.locationId });
      }
      for (const extra of dto.extraSheets ?? []) {
        const key = `${extra.warehouseId}::${extra.locationId ?? ''}`;
        if (!groups.has(key)) groups.set(key, { warehouseId: extra.warehouseId, locationId: extra.locationId ?? null });
      }
      if (groups.size === 0) throw new ValidationAppError('Cannot generate count sheets — the snapshot has no lines and no extra sheet was requested');

      const assignedByKey = new Map((dto.extraSheets ?? []).map((e) => [`${e.warehouseId}::${e.locationId ?? ''}`, e.assignedUserId]));

      let sequence = 0;
      const created = [];
      for (const group of groups.values()) {
        sequence += 1;
        const key = `${group.warehouseId}::${group.locationId ?? ''}`;
        const sheet = await tx.inventoryCountSheet.create({
          data: {
            tenantId,
            sessionId,
            sheetNumber: `${session.sessionNumber ?? sessionId.slice(0, 8)}-${String(sequence).padStart(3, '0')}`,
            warehouseId: group.warehouseId,
            locationId: group.locationId,
            assignedUserId: assignedByKey.get(key),
            blindCount: session.blindCount,
            sequence,
          },
        });
        created.push(sheet);
      }

      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SHEETS_GENERATED', entityType: 'INVENTORY_COUNT_SESSION', entityId: sessionId, action: 'CREATE', userId, newValues: { count: created.length } }, tx);
      return created;
    });
  }

  async assign(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, sheetId: string, assignedUserId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);

    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    if (sheet.status === 'COMPLETED') throw new ValidationAppError('Cannot reassign a completed count sheet');

    const updated = await this.prisma.inventoryCountSheet.update({ where: { id: sheetId }, data: { assignedUserId } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SHEET_ASSIGNED', entityType: 'INVENTORY_COUNT_SHEET', entityId: sheetId, action: 'UPDATE', userId, newValues: { assignedUserId } });
    return updated;
  }

  async complete(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string, sheetId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.assertSessionInOrg(tenantId, organizationId, sessionId);

    const sheet = await this.prisma.inventoryCountSheet.findFirst({ where: { id: sheetId, tenantId, sessionId } });
    if (!sheet) throw new NotFoundAppError('InventoryCountSheet', sheetId);
    if (sheet.status === 'COMPLETED') return sheet;

    const updated = await this.prisma.inventoryCountSheet.update({ where: { id: sheetId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SHEET_COMPLETED', entityType: 'INVENTORY_COUNT_SHEET', entityId: sheetId, action: 'UPDATE', userId });
    return updated;
  }

  private async assertSessionInOrg(tenantId: string, organizationId: string, sessionId: string) {
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
    return session;
  }
}
