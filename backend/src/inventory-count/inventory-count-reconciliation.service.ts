import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { PHYSICAL_STOCK_STATUSES } from '../warehouse-inventory/inventory-movement.service';
import { INVENTORY_COUNT_ADJUSTMENT_TYPE, INVENTORY_COUNT_SESSION_TYPE, dec, stockLineKey } from './inventory-count.constants';
import { CountNotReconciledError } from './inventory-count.errors';
import { InventoryCountSessionService } from './inventory-count-session.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryFreezeService } from './inventory-freeze.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';

const ADJUSTING = ['ADJUST_STOCK', 'WRITE_OFF', 'SURPLUS_RECOGNITION', 'LOCATION_TRANSFER', 'STATUS_TRANSFER', 'BATCH_CORRECTION', 'SERIAL_CORRECTION'];

/**
 * InventoryCountReconciliationService (spec sections 67-69, 95-97, 113, 132).
 *
 * Quantity: for every variance key, the Phase 10 authoritative balance NOW
 *   must equal   final physical (adjusted lines) / adjusted accounting
 *                (NO_ADJUSTMENT lines)  +  in-scope movements recorded after
 *                the key's cutoff (allowed post-count movements).
 * Value:    every posted surplus/shortage line is costed (no unresolved
 *   cost), and the costed movement values equal the documents' totals.
 * GL:       the net inventory-account movement of the count's journal
 *   entries equals the subledger value change (surplus − shortage) within
 *   0.01 — full traceability Session → Adjustment → Movement → Journal.
 * BALANCED marks the session RECONCILED; `close` then enforces the close
 * rules and releases any freeze.
 */
@Injectable()
export class InventoryCountReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly snapshots: InventorySnapshotService,
    private readonly freezes: InventoryFreezeService,
    private readonly mappings: AccountingMappingService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async reconcile(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['APPROVED', 'POSTED', 'RECONCILED'], 'reconcile');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);
    const docs = await this.prisma.inventoryCountAdjustment.findMany({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' } }, include: { lines: true } });
    const variances = await this.prisma.inventoryVariance.findMany({
      where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion, resolutionStatus: { not: 'SUPERSEDED' } },
      include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const matches = await this.prisma.inventoryVarianceMatch.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion } });
    const own = docs.map((d) => d.id);

    // Quantity reconciliation.
    const afterCutoff = session.snapshotAt ? await this.snapshots.getMovementsAfter(tenantId, organizationId, scope, session.snapshotAt, null, own) : [];
    const liveRows = await this.prisma.inventoryMovement.groupBy({
      by: ['warehouseId', 'locationId', 'productId', 'batchId', 'serialId', 'ownershipType', 'ownerCounterpartyId', 'stockStatus'],
      where: { tenantId, organizationId, ...scope.movementWhere(), stockStatus: { in: PHYSICAL_STOCK_STATUSES } },
      _sum: { baseQuantity: true },
    });
    const live = new Map(liveRows.map((r) => [stockLineKey(r), new Decimal((r._sum.baseQuantity ?? 0).toString())]));
    const pendingDocs = docs.filter((d) => d.postingStatus !== 'POSTED');

    const discrepancies: Record<string, unknown>[] = [];
    let expectedTotal = new Decimal(0);
    let actualTotal = new Decimal(0);
    let snapshotTotal = new Decimal(0);
    let postIn = new Decimal(0);
    let postOut = new Decimal(0);
    let adjustedTotal = new Decimal(0);
    let physicalTotal = new Decimal(0);
    let surplusQty = new Decimal(0);
    let shortageQty = new Decimal(0);
    let unresolved = 0;
    for (const v of variances) {
      if (v.lineKey.startsWith('unknown:')) continue;
      snapshotTotal = snapshotTotal.plus(dec(v.accountingQuantity));
      postIn = postIn.plus(dec(v.postSnapshotInQuantity));
      postOut = postOut.plus(dec(v.postSnapshotOutQuantity));
      adjustedTotal = adjustedTotal.plus(dec(v.adjustedAccountingQuantity));
      physicalTotal = physicalTotal.plus(v.physicalQuantity != null ? dec(v.physicalQuantity) : dec(v.adjustedAccountingQuantity));
      const diff = dec(v.quantityDifference);
      if (diff.gt(0)) surplusQty = surplusQty.plus(diff);
      if (diff.lt(0)) shortageQty = shortageQty.plus(diff.abs());
      if (!['MATCHED', 'APPROVED', 'POSTED', 'AUTO_ACCEPTED'].includes(v.resolutionStatus)) unresolved += 1;

      const resolution = v.decisions[0]?.resolutionType ?? v.suggestedResolution ?? 'NO_ADJUSTMENT';
      const adjusted = ADJUSTING.includes(resolution) && v.physicalQuantity != null;
      const base = adjusted ? dec(v.physicalQuantity) : dec(v.adjustedAccountingQuantity);
      const cutoff = v.cutoffAt ?? session.countCutoffAt ?? new Date();
      const later = afterCutoff.filter((m) => m.lineKey === v.lineKey && m.recordedAt > cutoff).reduce((s, m) => s.plus(m.quantity), new Decimal(0));
      const expected = base.plus(later);
      // A found serial that had no master row at count time was registered
      // when its adjustment was created — reconcile it under its real id.
      let liveKey = v.lineKey;
      if (!v.serialId && v.serialNumberText && v.productId) {
        const sn = await this.prisma.serialNumber.findFirst({ where: { tenantId, organizationId, productId: v.productId, serialNumber: v.serialNumberText }, select: { id: true } });
        if (sn) liveKey = stockLineKey({ ...v, serialId: sn.id, serialNumberText: null });
      }
      const actual = live.get(liveKey) ?? new Decimal(0);
      expectedTotal = expectedTotal.plus(expected);
      actualTotal = actualTotal.plus(actual);
      if (!expected.eq(actual)) discrepancies.push({ lineKey: v.lineKey, varianceId: v.id, expected: expected.toString(), actual: actual.toString() });
    }
    const quantityReconciled = pendingDocs.length === 0 && discrepancies.length === 0;

    // Value reconciliation (Phase 11 handoff = movement provisional cost).
    let surplusValue = new Decimal(0);
    let shortageValue = new Decimal(0);
    const valueIssues: Record<string, unknown>[] = [];
    for (const d of docs) {
      if (d.operationType !== 'INVENTORY_SURPLUS' && d.operationType !== 'INVENTORY_SHORTAGE') continue;
      for (const l of d.lines) {
        if (d.postingStatus === 'POSTED' && (l.costingStatus === 'UNRESOLVED' || l.costingStatus == null)) valueIssues.push({ document: d.number, lineId: l.id, issue: 'UNCOSTED_LINE' });
        const amount = l.amount != null ? dec(l.amount) : new Decimal(0);
        if (d.operationType === 'INVENTORY_SURPLUS') surplusValue = surplusValue.plus(amount);
        else shortageValue = shortageValue.plus(amount);
      }
      if (d.postingStatus === 'POSTED') {
        const moves = await this.prisma.inventoryMovement.findMany({ where: { tenantId, registrarDocumentType: INVENTORY_COUNT_ADJUSTMENT_TYPE, registrarDocumentId: d.id } });
        const movedValue = moves.reduce((s, m) => s.plus(m.provisionalCost ? dec(m.provisionalCost).times(dec(m.baseQuantity).abs()) : 0), new Decimal(0)).toDecimalPlaces(2);
        const docValue = d.lines.reduce((s, l) => s.plus(l.amount != null ? dec(l.amount) : 0), new Decimal(0));
        if (movedValue.minus(docValue).abs().gt(new Decimal(0.01).times(Math.max(1, d.lines.length)))) valueIssues.push({ document: d.number, issue: 'MOVEMENT_VALUE_MISMATCH', movedValue: movedValue.toString(), documentValue: docValue.toString() });
      }
    }
    const valueReconciled = valueIssues.length === 0;
    const subledgerChange = surplusValue.minus(shortageValue);

    // GL reconciliation.
    let glChange = new Decimal(0);
    const journalEntries: { document: string | null; journalEntryId: string; journalNumber: string }[] = [];
    let inventoryAccountId: string | null = null;
    try {
      inventoryAccountId = (await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, session.adjustmentDate ?? new Date())).id;
    } catch {
      inventoryAccountId = null;
    }
    for (const d of docs.filter((x) => x.postingStatus === 'POSTED')) {
      const je = await this.prisma.journalEntry.findFirst({ where: { tenantId, sourceDocumentType: INVENTORY_COUNT_ADJUSTMENT_TYPE, sourceDocumentId: d.id, status: 'POSTED' }, include: { lines: true } });
      if (!je) continue;
      journalEntries.push({ document: d.number, journalEntryId: je.id, journalNumber: je.journalNumber });
      for (const l of je.lines) {
        if (l.accountId !== inventoryAccountId) continue;
        glChange = l.side === 'DEBIT' ? glChange.plus(dec(l.amountBase)) : glChange.minus(dec(l.amountBase));
      }
    }
    const glReconciled = glChange.minus(subledgerChange).abs().lte(0.01);

    const locationMismatchQty = matches.filter((m) => m.matchType === 'LOCATION_MISMATCH').reduce((s, m) => s.plus(dec(m.quantity)), new Decimal(0));
    const status = pendingDocs.length > 0 ? 'ADJUSTMENTS_PENDING' : quantityReconciled && valueReconciled && glReconciled ? 'BALANCED' : discrepancies.length > 0 ? 'DIFFERENCES_FOUND' : 'ERROR';
    const now = new Date();
    const details = { discrepancies: discrepancies.slice(0, 200), valueIssues, journalEntries, adjustments: docs.map((d) => ({ id: d.id, number: d.number, operationType: d.operationType, postingStatus: d.postingStatus, totalValue: d.totalValue?.toString() ?? null })) };
    const data = {
      snapshotTotalQty: snapshotTotal.toString(),
      postSnapshotInQty: postIn.toString(),
      postSnapshotOutQty: postOut.toString(),
      adjustedAccountingQty: adjustedTotal.toString(),
      physicalQty: physicalTotal.toString(),
      surplusQty: surplusQty.toString(),
      shortageQty: shortageQty.toString(),
      locationMismatchQty: locationMismatchQty.toString(),
      totalSurplusValue: surplusValue.toString(),
      totalShortageValue: shortageValue.toString(),
      netValueDifference: subledgerChange.toString(),
      adjustmentDocumentCount: docs.length,
      postedAdjustmentCount: docs.length - pendingDocs.length,
      unresolvedVarianceCount: unresolved,
      expectedFinalQty: expectedTotal.toString(),
      actualFinalQty: actualTotal.toString(),
      quantityReconciled,
      valueReconciled,
      glReconciled,
      subledgerValueChange: subledgerChange.toString(),
      glInventoryChange: glChange.toString(),
      details: details as any,
      status,
      reconciledAt: status === 'BALANCED' ? now : null,
      reconciledBy: status === 'BALANCED' ? userId : null,
    };

    return this.prisma.runInTransaction(async (tx) => {
      const rec = await tx.inventoryCountReconciliation.upsert({ where: { sessionId: session.id }, create: { tenantId, sessionId: session.id, ...data }, update: data });
      const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
      const sessionPatch: Record<string, unknown> = { reconciliationStatus: status };
      if (status === 'BALANCED' && fresh.status !== 'RECONCILED') {
        Object.assign(sessionPatch, { status: 'RECONCILED', reconciledAt: now });
        if (fresh.status === 'APPROVED') Object.assign(sessionPatch, { postedAt: fresh.postedAt ?? now });
      }
      const updated = await this.sessions.updateSession(tx, fresh, sessionPatch);
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_RECONCILED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'RECONCILE', userId, newValues: { status, quantityReconciled, valueReconciled, glReconciled, discrepancies: discrepancies.length } }, tx);
      if (status === 'BALANCED') await this.events.emit(tenantId, InventoryCountEvents.RECONCILED, { sessionId: session.id, planId: plan.id }, { netValueDifference: subledgerChange.toString() }, tx);
      return { session: updated, reconciliation: this.redact(rec) };
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, planId: string) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    const rec = await this.prisma.inventoryCountReconciliation.findUnique({ where: { sessionId: session.id } });
    return rec ? this.redact(rec) : null;
  }

  /** Session close rules (spec section 69). */
  async close(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    if (session.status === 'CLOSED') return session;
    this.sessions.assertStatus(session, ['RECONCILED'], 'close');
    const rec = await this.prisma.inventoryCountReconciliation.findUnique({ where: { sessionId: session.id } });
    const problems: string[] = [];
    if (!rec || rec.status !== 'BALANCED') problems.push('stock reconciliation is not BALANCED');
    if (rec && !rec.valueReconciled) problems.push('cost reconciliation is incomplete');
    if (rec && !rec.glReconciled) problems.push('accounting posting does not reconcile to the inventory subledger');
    const openSheets = await this.prisma.inventoryCountSheet.count({ where: { tenantId, sessionId: session.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    if (openSheets > 0) problems.push(`${openSheets} count sheet(s) not completed`);
    const pendingRecounts = await this.prisma.inventoryRecount.count({ where: { tenantId, sessionId: session.id, resultStatus: 'PENDING' } });
    if (pendingRecounts > 0) problems.push(`${pendingRecounts} recount(s) pending`);
    const unposted = await this.prisma.inventoryCountAdjustment.count({ where: { tenantId, sessionId: session.id, status: { not: 'CANCELLED' }, postingStatus: { not: 'POSTED' } } });
    if (unposted > 0) problems.push(`${unposted} adjustment document(s) not posted`);
    if (!['APPROVED', 'NOT_REQUIRED'].includes(session.approvalStatus) || !session.approvedAt) problems.push('approval is not complete');
    if (problems.length > 0) throw new CountNotReconciledError(`Inventory count session ${session.sessionNumber} cannot be closed: ${problems.join('; ')}.`, { problems });

    return this.prisma.runInTransaction(async (tx) => {
      await this.freezes.release(tenantId, session.id, userId, tx);
      const updated = await this.sessions.updateSession(tx, session, { status: 'CLOSED', closedAt: new Date(), closedBy: userId, freezeActive: false, reconciliationStatus: 'CLOSED' });
      await tx.inventoryCountReconciliation.update({ where: { sessionId: session.id }, data: { status: 'CLOSED' } });
      await tx.inventoryCountPlan.update({ where: { id: plan.id }, data: { status: 'CLOSED', version: { increment: 1 } } });
      await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_SESSION_CLOSED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'CLOSE', userId }, tx);
      await this.events.emit(tenantId, InventoryCountEvents.CLOSED, { sessionId: session.id, planId: plan.id }, {}, tx);
      return updated;
    });
  }

  private redact<T extends Record<string, any>>(rec: T): T {
    if (this.sessions.canSeeCost()) return rec;
    return { ...rec, totalSurplusValue: undefined, totalShortageValue: undefined, netValueDifference: undefined, subledgerValueChange: undefined, glInventoryChange: undefined };
  }
}
