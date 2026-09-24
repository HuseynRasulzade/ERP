import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CountSessionInvalidStateError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { StartInventoryCountSessionDto } from './dto/inventory-count-session.dto';

const SESSION_TYPE = 'INVENTORY_COUNT_SESSION';
const SEQUENCE_PREFIX = 'ICS';

/**
 * InventoryCountSessionService — the actual count run against a READY
 * plan (spec sections 6-10). Lifecycle: DRAFT (created, scope still
 * frozen from here on — see InventoryCountScopeService) ->
 * SNAPSHOT_CREATED (immutable balance written) -> COUNTING (sheets
 * exist, entries may be submitted) -> UNDER_REVIEW (every sheet
 * completed; variance/recount/approval flow — Task #11/#12 — takes over
 * from there).
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

  async list(tenantId: string, membershipId: string, organizationId: string, planId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.inventoryCountSession.findMany({ where: { tenantId, organizationId, ...(planId ? { inventoryCountPlanId: planId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const session = await this.prisma.inventoryCountSession.findFirst({ where: { id, tenantId, organizationId }, include: { sheets: true } });
    if (!session) throw new NotFoundAppError('InventoryCountSession', id);
    return session;
  }

  async start(tenantId: string, membershipId: string, organizationId: string, userId: string, planId: string, dto: StartInventoryCountSessionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const plan = await tx.inventoryCountPlan.findFirst({ where: { id: planId, tenantId, organizationId } });
      if (!plan) throw new NotFoundAppError('InventoryCountPlan', planId);
      if (plan.status !== 'READY') throw new CountSessionInvalidStateError('Cannot start a count session from a plan that is not READY');

      const allocated = await this.numbering.allocateNumber(tenantId, SESSION_TYPE, plan.planDate, tx);
      const session = await tx.inventoryCountSession.create({
        data: {
          tenantId,
          organizationId,
          inventoryCountPlanId: planId,
          sessionNumber: allocated.formatted,
          status: 'DRAFT',
          freezePolicy: plan.freezePolicy,
          blindCount: plan.blindCountEnabled,
          cutoffMode: plan.cutoffMode,
          countCutoffAt: dto.countCutoffAt ? new Date(dto.countCutoffAt) : undefined,
          createdBy: userId,
        },
      });

      await tx.inventoryCountPlan.update({ where: { id: planId }, data: { status: 'ACTIVE', updatedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SESSION_STARTED', entityType: SESSION_TYPE, entityId: session.id, action: 'CREATE', userId, newValues: { planId, sessionNumber: session.sessionNumber } }, tx);
      return session;
    });
  }

  async createSnapshot(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (session.status !== 'DRAFT') throw new CountSessionInvalidStateError('Snapshot can only be generated for a session that is still DRAFT');

      const cutoffDate = session.countCutoffAt ?? new Date();
      const linesWritten = await this.snapshot.generate(tenantId, organizationId, sessionId, cutoffDate, tx);

      const updated = await tx.inventoryCountSession.update({
        where: { id: sessionId },
        data: { status: 'SNAPSHOT_CREATED', snapshotAt: new Date(), countCutoffAt: cutoffDate, version: { increment: 1 } },
      });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_SNAPSHOT_CREATED', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId, newValues: { linesWritten } }, tx);
      return updated;
    });
  }

  async beginCounting(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (session.status !== 'SNAPSHOT_CREATED') throw new CountSessionInvalidStateError('Counting can only begin once a session has a snapshot');

      const sheetCount = await tx.inventoryCountSheet.count({ where: { tenantId, sessionId } });
      if (sheetCount === 0) throw new ValidationAppError('Cannot begin counting — no count sheets have been generated for this session');

      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'COUNTING', startedAt: new Date(), startedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_STARTED_COUNTING', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  async complete(tenantId: string, membershipId: string, organizationId: string, userId: string, sessionId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const session = await tx.inventoryCountSession.findFirst({ where: { id: sessionId, tenantId, organizationId }, include: { sheets: true } });
      if (!session) throw new NotFoundAppError('InventoryCountSession', sessionId);
      if (session.status !== 'COUNTING') throw new CountSessionInvalidStateError('Only a session that is COUNTING can be marked complete');

      const incomplete = session.sheets.filter((s) => s.status !== 'COMPLETED');
      if (incomplete.length > 0) throw new ValidationAppError(`Cannot complete this session — ${incomplete.length} count sheet(s) are not yet completed`);

      const updated = await tx.inventoryCountSession.update({ where: { id: sessionId }, data: { status: 'UNDER_REVIEW', completedAt: new Date(), completedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COUNT_COMPLETED', entityType: SESSION_TYPE, entityId: sessionId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SESSION_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: SESSION_TYPE, documentType: SESSION_TYPE, prefix: SEQUENCE_PREFIX, padding: 4, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
