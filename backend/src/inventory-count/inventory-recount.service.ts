import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { INVENTORY_COUNT_SESSION_TYPE } from './inventory-count.constants';
import { CountInvalidStateError, CountSegregationOfDutiesError } from './inventory-count.errors';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventoryVarianceService } from './inventory-variance.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';
import { CompleteRecountDto, RequestRecountDto } from './dto/inventory-count.dto';

/**
 * InventoryRecountService (spec sections 37-41, 112). A recount is its own
 * row and never overwrites the original count (which stays in the entry
 * history); the final physical quantity is re-derived by the variance
 * engine's generic final-quantity rule after every completed recount.
 * Independent recount (four-eyes) and blind recount are plan policies.
 */
@Injectable()
export class InventoryRecountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly variances: InventoryVarianceService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async request(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string, dto: RequestRecountDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['UNDER_REVIEW', 'RECOUNT_REQUIRED'], 'request a recount');
    return this.prisma.runInTransaction(async (tx) => {
      const created = [];
      for (const varianceId of dto.varianceIds) {
        const v = await tx.inventoryVariance.findFirst({ where: { id: varianceId, tenantId, sessionId: session.id }, include: { recounts: true } });
        if (!v) throw new NotFoundAppError('InventoryVariance', varianceId);
        if (v.recounts.some((r) => r.resultStatus === 'PENDING')) continue;
        const done = v.recounts.filter((r) => r.resultStatus === 'COMPLETED').length;
        if (done >= plan.maxRecountAttempts) throw new ValidationAppError(`Variance ${v.lineKey} already reached the maximum of ${plan.maxRecountAttempts} recount attempts`);
        const recount = await tx.inventoryRecount.create({ data: { tenantId, sessionId: session.id, varianceId: v.id, recountNumber: v.recounts.length + 1, assignedUserId: dto.assignedUserId, requestedBy: userId, reason: dto.reason } });
        await tx.inventoryVariance.update({ where: { id: v.id }, data: { resolutionStatus: 'RECOUNT_REQUIRED', recountStatus: 'PENDING' } });
        created.push(recount);
      }
      if (created.length > 0 && session.status !== 'RECOUNT_REQUIRED') await this.sessions.updateSession(tx, session, { status: 'RECOUNT_REQUIRED' });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_RECOUNT_CREATED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'RECOUNT_REQUEST', userId, newValues: { recountIds: created.map((r) => r.id), assignedUserId: dto.assignedUserId }, reason: dto.reason }, tx);
      if (created.length > 0) await this.events.emit(tenantId, InventoryCountEvents.RECOUNT_REQUESTED, { sessionId: session.id, planId: plan.id }, { count: created.length, automatic: false }, tx);
      return created;
    });
  }

  /** Recount list; with blind recount the original count is withheld
   * from anyone without variance-review permission (spec section 112). */
  async list(tenantId: string, membershipId: string, organizationId: string, planId: string, filter: { status?: string } = {}) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const rows = await this.prisma.inventoryRecount.findMany({
      where: { tenantId, sessionId: session.id, ...(filter.status ? { resultStatus: filter.status } : {}) },
      include: { variance: true },
      orderBy: [{ requestedAt: 'asc' }],
    });
    const showOriginal = !plan.blindRecount || this.sessions.hasPermission(PermissionCodes.INVENTORY_COUNT_REVIEW);
    const showQty = this.sessions.canSeeAccountingQty(session);
    const products = await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.variance.productId).filter((x): x is string => !!x) } }, select: { id: true, code: true, name: true } });
    const locations = await this.prisma.warehouseLocation.findMany({ where: { id: { in: rows.map((r) => r.variance.locationId).filter((x): x is string => !!x) } }, select: { id: true, code: true } });
    const pm = new Map(products.map((p) => [p.id, p]));
    const lm = new Map(locations.map((l) => [l.id, l.code]));
    return rows.map((r) => ({
      id: r.id,
      varianceId: r.varianceId,
      recountNumber: r.recountNumber,
      assignedUserId: r.assignedUserId,
      requestedAt: r.requestedAt,
      completedAt: r.completedAt,
      countedBy: r.countedBy,
      physicalQuantity: r.physicalQuantity,
      reason: r.reason,
      isAutomatic: r.isAutomatic,
      resultStatus: r.resultStatus,
      warehouseId: r.variance.warehouseId,
      locationId: r.variance.locationId,
      locationCode: r.variance.locationId ? lm.get(r.variance.locationId) ?? null : null,
      productId: r.variance.productId,
      productCode: r.variance.productId ? pm.get(r.variance.productId)?.code : null,
      productName: r.variance.productId ? pm.get(r.variance.productId)?.name : null,
      batchId: r.variance.batchId,
      serialId: r.variance.serialId,
      stockStatus: r.variance.stockStatus,
      ...(showOriginal ? { originalCountedQuantity: r.variance.countedQuantity } : {}),
      ...(showQty ? { adjustedAccountingQuantity: r.variance.adjustedAccountingQuantity } : {}),
    }));
  }

  async complete(tenantId: string, membershipId: string, organizationId: string, planId: string, recountId: string, userId: string, dto: CompleteRecountDto) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['RECOUNT_REQUIRED', 'UNDER_REVIEW'], 'complete a recount');
    const recount = await this.prisma.inventoryRecount.findFirst({ where: { id: recountId, tenantId, sessionId: session.id }, include: { variance: true } });
    if (!recount) throw new NotFoundAppError('InventoryRecount', recountId);
    if (recount.resultStatus !== 'PENDING') throw new CountInvalidStateError(`Recount #${recount.recountNumber} is already ${recount.resultStatus}`);
    await this.sessions.assertCanCount(tenantId, plan, session, recount.variance.warehouseId, userId);
    if (recount.assignedUserId && recount.assignedUserId !== userId && !this.sessions.hasPermission(PermissionCodes.INVENTORY_COUNT_OVERRIDE_VARIANCE)) {
      throw new CountSegregationOfDutiesError('This recount is assigned to another counter.');
    }
    if (plan.requireIndependentRecount) {
      const originalCounters = await this.prisma.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, lineKey: recount.variance.lineKey }, select: { countedBy: true } });
      if (originalCounters.some((e) => e.countedBy === userId)) throw new CountSegregationOfDutiesError('Independent recount required: the recount must be performed by a different counter than the original count.');
    }
    if ((recount.variance.serialId || recount.variance.serialNumberText) && dto.physicalQuantity !== 0 && dto.physicalQuantity !== 1) throw new ValidationAppError('A serial recount quantity can only be 0 or 1');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);

    return this.prisma.runInTransaction(async (tx) => {
      await tx.inventoryRecount.update({ where: { id: recount.id }, data: { resultStatus: 'COMPLETED', physicalQuantity: new Decimal(dto.physicalQuantity).toString(), completedAt: new Date(), startedAt: recount.startedAt ?? new Date(), countedBy: userId, notes: dto.notes } });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_RECOUNT_COMPLETED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'RECOUNT_COMPLETE', userId, oldValues: { countedQuantity: recount.variance.countedQuantity?.toString() ?? null }, newValues: { recountId, recountNumber: recount.recountNumber, physicalQuantity: String(dto.physicalQuantity) } }, tx);
      const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
      const summary = await this.variances.persist(tenantId, plan, fresh, scope, userId, tx);
      return { recountId, summary };
    });
  }
}
