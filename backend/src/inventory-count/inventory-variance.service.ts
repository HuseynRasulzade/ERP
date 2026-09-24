import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { INVENTORY_COUNT_SESSION_TYPE, dec, decOrNull, stockLineKey } from './inventory-count.constants';
import { CountInvalidStateError } from './inventory-count.errors';
import { InventoryCountSessionService, PlanRow, SessionRow } from './inventory-count-session.service';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { InventoryCountCostingService } from './inventory-count-costing.service';
import { InventoryCountEventsService, InventoryCountEvents } from './inventory-count-events.service';
import { ResolvedScope } from './inventory-count-scope.service';

export interface ComputedLine {
  lineKey: string;
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
  accountingQuantity: Decimal;
  postIn: Decimal;
  postOut: Decimal;
  adjusted: Decimal;
  counted: Decimal | null;
  physical: Decimal | null;
  diff: Decimal;
  countStatus: string;
  varianceType: string;
  direction: string;
  matchedQuantity: Decimal;
  cutoffAt: Date;
  unitCost: Decimal | null;
  costSource: string | null;
  costingStatus: string | null;
  valueDifference: Decimal | null;
  severity: string;
  withinTolerance: boolean;
  needsRecount: boolean;
  suggestedResolution: string | null;
  requiresInvestigation: boolean;
  requiresSupervisorConfirmation: boolean;
}

export interface ComputedMatch {
  matchType: string;
  shortageKey: string;
  surplusKey: string;
  quantity: Decimal;
}

const FINAL_STATUSES_KEEP = ['UNDER_INVESTIGATION', 'EXPLAINED'];

/**
 * InventoryVarianceService — the central variance engine (spec sections
 * 31-33, 37-43, 47, 59-60, 63-66, 84-86).
 *
 * For every reconciled dimension key (warehouse, location, product,
 * characteristic, batch, serial, ownership, quality status):
 *   accounting  = immutable snapshot quantity
 *   adjusted    = live balance recorded up to snapshot_at
 *                 + in-scope movements recorded after snapshot_at and up to
 *                   the key's cutoff (global / task completion / location
 *                   count timestamp), excluding the count's own adjustments
 *   physical    = final physical per the plan's final-quantity rule
 *                 (first count, recounts, supervisor decision)
 *   difference  = physical − adjusted
 * Lines are never netted per product; cross-dimension offsets (location,
 * quality status, batch, ownership, serial swaps) are recorded as
 * InventoryVarianceMatch rows so the net-zero mismatch stays visible AND
 * the right correction document type can be chosen later. Missing counts
 * are UNCOUNTED (never an implicit zero) unless the plan says so.
 *
 * `compute` is pure (no writes) so the adjustment service can re-run it as
 * the pre-post staleness check; `calculate` persists it.
 */
@Injectable()
export class InventoryVarianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: InventoryCountSessionService,
    private readonly snapshots: InventorySnapshotService,
    private readonly costing: InventoryCountCostingService,
    private readonly events: InventoryCountEventsService,
  ) {}

  async compute(tenantId: string, plan: PlanRow, session: SessionRow, scope: ResolvedScope, tx?: PrismaTransactionClient): Promise<{ lines: ComputedLine[]; matches: ComputedMatch[] }> {
    const db = tx ?? this.prisma;
    if (!session.snapshotAt) throw new CountInvalidStateError('No stock snapshot exists for this session.');
    const organizationId = session.organizationId;
    const globalCutoff = session.countCutoffAt ?? new Date();
    const own = await this.sessions.ownAdjustmentIds(tenantId, session.id, tx);

    // Sequential on purpose: these may run inside one interactive transaction.
    const snapshotLines = await this.snapshots.lines(tenantId, session.id, session.snapshotVersion, tx);
    const liveAtSnapshot = await this.snapshots.getInventoryBalance(tenantId, organizationId, scope, session.snapshotAt, { excludeDocumentIds: own }, tx);
    const postMovements = await this.snapshots.getMovementsAfter(tenantId, organizationId, scope, session.snapshotAt, null, own, tx);
    const entries = await db.inventoryCountEntry.findMany({ where: { tenantId, sessionId: session.id, status: { in: ['ACTIVE', 'PENDING_REVIEW'] } }, orderBy: { countedAt: 'asc' } });
    const existing = await db.inventoryVariance.findMany({
      where: { tenantId, sessionId: session.id },
      include: { recounts: { where: { resultStatus: 'COMPLETED' }, orderBy: { recountNumber: 'asc' } }, decisions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const tasks = await db.inventoryCountTask.findMany({ where: { tenantId, sessionId: session.id } });
    const sheets = await db.inventoryCountSheet.findMany({ where: { tenantId, sessionId: session.id } });
    const existingByKey = new Map(existing.map((v) => [v.lineKey, v]));

    type Dims = Omit<ComputedLine, 'accountingQuantity' | 'postIn' | 'postOut' | 'adjusted' | 'counted' | 'physical' | 'diff' | 'countStatus' | 'varianceType' | 'direction' | 'matchedQuantity' | 'cutoffAt' | 'unitCost' | 'costSource' | 'costingStatus' | 'valueDifference' | 'severity' | 'withinTolerance' | 'needsRecount' | 'suggestedResolution' | 'requiresInvestigation' | 'requiresSupervisorConfirmation'>;
    const dims = new Map<string, Dims>();
    const addDims = (key: string, d: any) => {
      if (dims.has(key)) return;
      dims.set(key, {
        lineKey: key,
        warehouseId: d.warehouseId,
        locationId: d.locationId ?? null,
        productId: d.productId ?? null,
        characteristicId: d.characteristicId ?? null,
        batchId: d.batchId ?? null,
        serialId: d.serialId ?? null,
        serialNumberText: d.serialNumberText ?? null,
        ownershipType: d.ownershipType ?? 'OWN',
        ownerCounterpartyId: d.ownerCounterpartyId ?? null,
        stockStatus: d.stockStatus ?? 'AVAILABLE',
        unitId: d.unitId ?? null,
      });
    };

    const snapQty = new Map<string, Decimal>();
    for (const s of snapshotLines) {
      snapQty.set(s.lineKey, dec(s.baseQuantity));
      addDims(s.lineKey, s);
    }
    const pre = new Map<string, Decimal>();
    for (const b of liveAtSnapshot) {
      pre.set(b.lineKey, b.quantity);
      addDims(b.lineKey, b);
    }

    // Counted quantities per the duplicate-entry policy (spec section 82).
    const countedByKey = new Map<string, { qty: Decimal; allExplicitZero: boolean; lastCountedAt: Date }>();
    const unknownEntries = entries.filter((e) => e.status === 'PENDING_REVIEW' || !e.productId);
    for (const e of entries) {
      if (e.status !== 'ACTIVE' || !e.productId || !e.lineKey) continue;
      addDims(e.lineKey, e);
      const cur = countedByKey.get(e.lineKey);
      const q = dec(e.baseQuantity);
      if (!cur) countedByKey.set(e.lineKey, { qty: q, allExplicitZero: q.isZero(), lastCountedAt: e.countedAt });
      else if (plan.duplicateEntryPolicy === 'LAST_COUNT') countedByKey.set(e.lineKey, { qty: q, allExplicitZero: q.isZero(), lastCountedAt: e.countedAt });
      else countedByKey.set(e.lineKey, { qty: cur.qty.plus(q), allExplicitZero: cur.allExplicitZero && q.isZero(), lastCountedAt: e.countedAt > cur.lastCountedAt ? e.countedAt : cur.lastCountedAt });
    }

    const serialCountedProducts = new Set(entries.filter((e) => e.status === 'ACTIVE' && e.productId && (e.serialId || e.serialNumberText)).map((e) => `${e.warehouseId}|${e.productId}`));

    // Per-key cutoff (spec sections 15, 65-66).
    const locationCountedAt = new Map<string, Date>();
    for (const e of entries) {
      if (e.status !== 'ACTIVE') continue;
      const k = `${e.warehouseId}|${e.locationId ?? '-'}`;
      const prev = locationCountedAt.get(k);
      if (!prev || e.countedAt > prev) locationCountedAt.set(k, e.countedAt);
    }
    const sheetSubtrees = new Map<string, string[] | null>();
    for (const sh of sheets) sheetSubtrees.set(sh.id, sh.locationScope ? await this.subtree(tenantId, sh.locationScope, db) : null);
    const cutoffFor = (d: Dims): Date => {
      if (plan.cutoffMode === 'LOCATION_COUNT_TIMESTAMP') return locationCountedAt.get(`${d.warehouseId}|${d.locationId ?? '-'}`) ?? globalCutoff;
      if (plan.cutoffMode === 'TASK_COMPLETION_CUTOFF') {
        const task = tasks.find((t) => t.finishAt && t.locationId && t.locationId === d.locationId);
        if (task?.finishAt) return task.finishAt;
        const sheet = sheets.find((sh) => sh.warehouseId === d.warehouseId && sh.completedAt && (!sheetSubtrees.get(sh.id) || (d.locationId && sheetSubtrees.get(sh.id)!.includes(d.locationId))));
        if (sheet?.completedAt) return sheet.completedAt;
      }
      return globalCutoff;
    };

    const postByKey = new Map<string, typeof postMovements>();
    for (const m of postMovements) {
      addDims(m.lineKey, m);
      const list = postByKey.get(m.lineKey) ?? [];
      list.push(m);
      postByKey.set(m.lineKey, list);
    }

    // Base units for keys that only came from entries/movements.
    const productIds = Array.from(new Set(Array.from(dims.values()).map((d) => d.productId).filter((x): x is string => !!x)));
    const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, baseUnitId: true } });
    const baseUnit = new Map(products.map((p) => [p.id, p.baseUnitId]));

    const lines: ComputedLine[] = [];
    for (const d of dims.values()) {
      const accounting = snapQty.get(d.lineKey) ?? new Decimal(0);
      const cutoffAt = cutoffFor(d);
      let postIn = new Decimal(0);
      let postOut = new Decimal(0);
      for (const m of postByKey.get(d.lineKey) ?? []) {
        if (m.recordedAt > cutoffAt) continue;
        if (m.quantity.gt(0)) postIn = postIn.plus(m.quantity);
        else postOut = postOut.plus(m.quantity.abs());
      }
      const adjusted = (pre.get(d.lineKey) ?? new Decimal(0)).plus(postIn).minus(postOut);
      const countedInfo = countedByKey.get(d.lineKey);
      const ex = existingByKey.get(d.lineKey);
      const decision = ex?.decisions[0];

      let counted: Decimal | null = countedInfo ? countedInfo.qty : null;
      let countStatus = countedInfo ? (countedInfo.qty.isZero() && countedInfo.allExplicitZero ? 'ZERO_COUNT' : 'COUNTED') : 'UNCOUNTED';
      if (!countedInfo && d.serialId && d.productId && serialCountedProducts.has(`${d.warehouseId}|${d.productId}`)) {
        // Serial count (spec section 24): once a serial-controlled product has
        // been counted in a warehouse, the recorded serial list IS the count —
        // an expected serial that was not recorded is missing, not uncounted.
        counted = new Decimal(0);
        countStatus = 'SERIAL_NOT_FOUND';
      } else if (!countedInfo && plan.uncountedPolicy === 'TREAT_AS_ZERO') {
        counted = new Decimal(0);
        countStatus = 'ASSUMED_ZERO';
      }
      if (!countedInfo && adjusted.isZero() && accounting.isZero()) continue; // nothing expected, nothing counted

      const recounts = (ex?.recounts ?? []).map((r) => dec(r.physicalQuantity));
      const { physical, requiresSupervisorConfirmation } = this.finalPhysical(counted, recounts, decision?.finalPhysicalQty != null ? dec(decision.finalPhysicalQty) : null, plan.finalQuantityRule);
      const diff = physical == null ? new Decimal(0) : physical.minus(adjusted);
      const isSerial = !!(d.serialId || d.serialNumberText);

      let varianceType: string;
      if (physical == null) varianceType = 'UNCOUNTED_ITEM';
      else if (diff.isZero()) varianceType = 'MATCH';
      else if (isSerial) varianceType = diff.lt(0) ? 'SERIAL_MISSING' : 'SERIAL_UNEXPECTED';
      else varianceType = diff.gt(0) ? 'SURPLUS' : 'SHORTAGE';

      lines.push({
        ...d,
        unitId: d.unitId ?? (d.productId ? baseUnit.get(d.productId) ?? null : null),
        accountingQuantity: accounting,
        postIn,
        postOut,
        adjusted,
        counted,
        physical,
        diff,
        countStatus,
        varianceType,
        direction: diff.gt(0) ? 'SURPLUS' : diff.lt(0) ? 'SHORTAGE' : 'NONE',
        matchedQuantity: new Decimal(0),
        cutoffAt,
        unitCost: null,
        costSource: null,
        costingStatus: null,
        valueDifference: null,
        severity: 'NONE',
        withinTolerance: false,
        needsRecount: false,
        suggestedResolution: null,
        requiresInvestigation: false,
        requiresSupervisorConfirmation,
      });
    }

    // Unknown items (spec section 83) — one line per entry awaiting review.
    for (const e of unknownEntries) {
      if (e.status !== 'PENDING_REVIEW') continue;
      const q = dec(e.baseQuantity);
      lines.push({
        lineKey: `unknown:${e.id}`,
        warehouseId: e.warehouseId,
        locationId: e.locationId,
        productId: null,
        characteristicId: null,
        batchId: null,
        serialId: null,
        serialNumberText: e.serialNumberText,
        ownershipType: e.ownershipType,
        ownerCounterpartyId: e.ownerCounterpartyId,
        stockStatus: e.stockStatus,
        unitId: e.unitId,
        accountingQuantity: new Decimal(0),
        postIn: new Decimal(0),
        postOut: new Decimal(0),
        adjusted: new Decimal(0),
        counted: q,
        physical: q,
        diff: q,
        countStatus: 'COUNTED',
        varianceType: 'UNKNOWN_PRODUCT',
        direction: 'SURPLUS',
        matchedQuantity: new Decimal(0),
        cutoffAt: globalCutoff,
        unitCost: null,
        costSource: null,
        costingStatus: 'UNRESOLVED',
        valueDifference: null,
        severity: 'MEDIUM',
        withinTolerance: false,
        needsRecount: false,
        suggestedResolution: null,
        requiresInvestigation: true,
        requiresSupervisorConfirmation: false,
      });
    }

    const matches = this.matchOffsets(lines);
    for (const m of matches) {
      for (const k of [m.shortageKey, m.surplusKey]) {
        const l = lines.find((x) => x.lineKey === k)!;
        l.matchedQuantity = l.matchedQuantity.plus(m.quantity);
        if (l.varianceType === 'SURPLUS' || l.varianceType === 'SHORTAGE') l.varianceType = m.matchType;
      }
    }

    // Costing, severity, tolerance, recount need, suggested resolution.
    const asOf = session.snapshotAt;
    const cache = new Map<string, Awaited<ReturnType<InventoryCountCostingService['resolveUnitCost']>>>();
    for (const l of lines) {
      if (!l.productId || l.diff.isZero()) continue;
      const direction = l.diff.lt(0) ? 'SHORTAGE' : 'SURPLUS';
      const policy = direction === 'SHORTAGE' ? plan.shortageCostPolicy : plan.surplusCostPolicy;
      const decision = existingByKey.get(l.lineKey)?.decisions[0];
      const approvedCost = decOrNull(decision?.approvedCost);
      const ck = `${l.productId}|${l.warehouseId}|${direction}|${policy}|${policy.startsWith('FIFO') ? l.diff.abs().toString() : ''}|${policy === 'MANUAL_APPROVED' ? approvedCost?.toString() ?? '' : ''}`;
      let res = cache.get(ck);
      if (!res) {
        res = await this.costing.resolveUnitCost(tenantId, organizationId, { productId: l.productId, warehouseId: l.warehouseId, asOf, quantity: l.diff.abs(), approvedCost }, direction, policy, tx);
        cache.set(ck, res);
      }
      l.unitCost = res.unitCost;
      l.costSource = res.source;
      l.costingStatus = res.status;
      l.valueDifference = res.unitCost ? l.diff.times(res.unitCost).toDecimalPlaces(2) : null;
    }

    for (const l of lines) {
      if (l.varianceType === 'MATCH') continue;
      l.severity = l.varianceType === 'UNKNOWN_PRODUCT' ? 'MEDIUM' : this.severity(l);
      l.withinTolerance = l.physical != null && this.withinTolerance(plan, l);
      l.needsRecount = this.needsRecount(plan, l, existingByKey.get(l.lineKey));
      const s = this.suggest(plan, l);
      l.suggestedResolution = s.resolution;
      l.requiresInvestigation = l.requiresInvestigation || s.investigate;
    }
    return { lines, matches };
  }

  /** Persists a fresh calculation (spec sections 31, 37, 43, 47). */
  async calculate(tenantId: string, membershipId: string, organizationId: string, planId: string, userId: string) {
    const { plan, session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    this.sessions.assertStatus(session, ['UNDER_REVIEW', 'RECOUNT_REQUIRED'], 'calculate variances');
    const scope = await this.sessions.resolveScope(tenantId, organizationId, plan.id);
    return this.prisma.runInTransaction(async (tx) => this.persist(tenantId, plan, session, scope, userId, tx));
  }

  async persist(tenantId: string, plan: PlanRow, session: SessionRow, scope: ResolvedScope, userId: string, tx: PrismaTransactionClient) {
    const { lines, matches } = await this.compute(tenantId, plan, session, scope, tx);
    const version = session.calculationVersion + 1;
    const existing = await tx.inventoryVariance.findMany({ where: { tenantId, sessionId: session.id }, include: { recounts: true } });
    const byKey = new Map(existing.map((v) => [v.lineKey, v]));
    const idByKey = new Map<string, string>();
    let recountsRequested = 0;
    let autoAccepted = 0;

    for (const l of lines) {
      const ex = byKey.get(l.lineKey);
      const pendingRecount = ex?.recounts.some((r) => r.resultStatus === 'PENDING') ?? false;
      const completedRecounts = ex?.recounts.filter((r) => r.resultStatus === 'COMPLETED').length ?? 0;
      let resolutionStatus: string;
      if (l.varianceType === 'MATCH') resolutionStatus = 'MATCHED';
      else if (pendingRecount) resolutionStatus = 'RECOUNT_REQUIRED';
      else if (ex && FINAL_STATUSES_KEEP.includes(ex.resolutionStatus)) resolutionStatus = ex.resolutionStatus;
      else if (l.requiresInvestigation) resolutionStatus = 'UNDER_INVESTIGATION';
      else resolutionStatus = 'OPEN';

      const data = {
        organizationId: session.organizationId,
        warehouseId: l.warehouseId,
        locationId: l.locationId,
        productId: l.productId,
        characteristicId: l.characteristicId,
        batchId: l.batchId,
        serialId: l.serialId,
        serialNumberText: l.serialNumberText,
        ownershipType: l.ownershipType,
        ownerCounterpartyId: l.ownerCounterpartyId,
        stockStatus: l.stockStatus,
        unitId: l.unitId,
        accountingQuantity: l.accountingQuantity.toString(),
        postSnapshotInQuantity: l.postIn.toString(),
        postSnapshotOutQuantity: l.postOut.toString(),
        adjustedAccountingQuantity: l.adjusted.toString(),
        countedQuantity: l.counted?.toString() ?? null,
        physicalQuantity: l.physical?.toString() ?? null,
        quantityDifference: l.diff.toString(),
        countStatus: l.countStatus,
        varianceType: l.varianceType,
        direction: l.direction,
        matchedQuantity: l.matchedQuantity.toString(),
        cutoffAt: l.cutoffAt,
        unitCost: l.unitCost?.toString() ?? null,
        costSource: l.costSource,
        costingStatus: l.costingStatus,
        valueDifference: l.valueDifference?.toString() ?? null,
        severity: l.severity,
        withinTolerance: l.withinTolerance,
        resolutionStatus,
        suggestedResolution: l.suggestedResolution,
        recountStatus: pendingRecount ? 'PENDING' : completedRecounts > 0 ? 'COMPLETED' : 'NONE',
        recountAttempts: completedRecounts,
        calculationVersion: version,
        approvedBy: null,
        approvedAt: null,
      };
      const row = ex
        ? await tx.inventoryVariance.update({ where: { id: ex.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.inventoryVariance.create({ data: { tenantId, sessionId: session.id, lineKey: l.lineKey, ...data } });
      idByKey.set(l.lineKey, row.id);

      if (l.needsRecount && !pendingRecount && resolutionStatus !== 'MATCHED') {
        await tx.inventoryRecount.create({ data: { tenantId, sessionId: session.id, varianceId: row.id, recountNumber: (ex?.recounts.length ?? 0) + 1, requestedBy: userId, isAutomatic: true, reason: `Automatic recount (${plan.recountPolicy})` } });
        await tx.inventoryVariance.update({ where: { id: row.id }, data: { resolutionStatus: 'RECOUNT_REQUIRED', recountStatus: 'PENDING' } });
        recountsRequested += 1;
      } else if (resolutionStatus === 'OPEN' && l.withinTolerance && plan.autoAcceptWithinTolerance) {
        await tx.inventoryVariance.update({ where: { id: row.id }, data: { resolutionStatus: 'AUTO_ACCEPTED' } });
        await tx.inventoryVarianceDecision.create({ data: { tenantId, varianceId: row.id, finalPhysicalQty: l.physical?.toString() ?? null, acceptedDifference: l.diff.toString(), resolutionType: l.suggestedResolution ?? 'ADJUST_STOCK', isAutomatic: true, decidedBy: userId, comment: 'Auto-accepted within tolerance' } });
        await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_VARIANCE_AUTO_ACCEPTED', entityType: 'INVENTORY_VARIANCE', entityId: row.id, action: 'AUTO_ACCEPT', userId, newValues: { lineKey: l.lineKey, difference: l.diff.toString(), value: l.valueDifference?.toString() ?? null } }, tx);
        autoAccepted += 1;
      }
    }

    // Lines that no longer exist (e.g. an unknown item was mapped) are superseded, never deleted.
    const liveKeys = new Set(lines.map((l) => l.lineKey));
    const superseded = existing.filter((v) => !liveKeys.has(v.lineKey) && v.resolutionStatus !== 'SUPERSEDED').map((v) => v.id);
    if (superseded.length > 0) await tx.inventoryVariance.updateMany({ where: { id: { in: superseded } }, data: { resolutionStatus: 'SUPERSEDED' } });

    await tx.inventoryVarianceMatch.deleteMany({ where: { tenantId, sessionId: session.id } });
    if (matches.length > 0) {
      await tx.inventoryVarianceMatch.createMany({
        data: matches.map((m) => ({ tenantId, sessionId: session.id, matchType: m.matchType, shortageVarianceId: idByKey.get(m.shortageKey)!, surplusVarianceId: idByKey.get(m.surplusKey)!, quantity: m.quantity.toString(), calculationVersion: version })),
      });
    }

    const pending = await tx.inventoryRecount.count({ where: { tenantId, sessionId: session.id, resultStatus: 'PENDING' } });
    const differences = lines.filter((l) => l.varianceType !== 'MATCH').length;
    const fresh = await tx.inventoryCountSession.findFirstOrThrow({ where: { id: session.id } });
    await this.sessions.updateSession(tx, fresh, {
      status: pending > 0 ? 'RECOUNT_REQUIRED' : 'UNDER_REVIEW',
      calculationVersion: version,
      varianceCalculatedAt: new Date(),
      reconciliationStatus: differences > 0 ? 'DIFFERENCES_FOUND' : 'IN_PROGRESS',
      ...(fresh.approvalStatus === 'REJECTED' ? {} : {}),
    });
    const summary = { calculationVersion: version, lineCount: lines.length, differences, matches: matches.length, recountsRequested, autoAccepted, pendingRecounts: pending };
    await this.events.audit(tenantId, { eventType: 'INVENTORY_COUNT_VARIANCES_CALCULATED', entityType: INVENTORY_COUNT_SESSION_TYPE, entityId: session.id, action: 'CALCULATE', userId, newValues: summary }, tx);
    await this.events.emit(tenantId, InventoryCountEvents.VARIANCE_CALCULATED, { sessionId: session.id, planId: plan.id }, summary, tx);
    if (recountsRequested > 0) await this.events.emit(tenantId, InventoryCountEvents.RECOUNT_REQUESTED, { sessionId: session.id, planId: plan.id }, { count: recountsRequested, automatic: true }, tx);
    return summary;
  }

  /** Variance review payload (spec sections 89, 111) with blind/cost redaction. */
  async list(tenantId: string, membershipId: string, organizationId: string, planId: string, filter: { varianceType?: string; onlyDifferences?: boolean } = {}) {
    const { session } = await this.sessions.loadContext(tenantId, membershipId, organizationId, planId);
    if (['READY', 'SNAPSHOT_CREATED', 'COUNTING'].includes(session.status)) {
      throw new CountInvalidStateError('Variances are calculated only after counting is completed (blind count).');
    }
    const rows = await this.prisma.inventoryVariance.findMany({
      where: {
        tenantId,
        sessionId: session.id,
        calculationVersion: session.calculationVersion,
        resolutionStatus: { not: 'SUPERSEDED' },
        ...(filter.varianceType ? { varianceType: filter.varianceType } : {}),
        ...(filter.onlyDifferences ? { varianceType: { not: 'MATCH' } } : {}),
      },
      include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 }, recounts: { orderBy: { recountNumber: 'asc' } } },
      orderBy: [{ warehouseId: 'asc' }, { productId: 'asc' }, { locationId: 'asc' }],
    });
    const matches = await this.prisma.inventoryVarianceMatch.findMany({ where: { tenantId, sessionId: session.id, calculationVersion: session.calculationVersion } });
    return this.enrich(tenantId, session, rows, matches);
  }

  async enrich(tenantId: string, session: SessionRow, rows: any[], matches: any[] = []) {
    const showQty = this.sessions.canSeeAccountingQty(session);
    const showCost = this.sessions.canSeeCost();
    const ids = (f: string) => Array.from(new Set(rows.map((r) => r[f]).filter((x: string | null) => !!x))) as string[];
    const [products, locations, batches, serials, warehouses] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: ids('productId') } }, select: { id: true, code: true, name: true, categoryId: true } }),
      this.prisma.warehouseLocation.findMany({ where: { id: { in: ids('locationId') } }, select: { id: true, code: true } }),
      this.prisma.batch.findMany({ where: { id: { in: ids('batchId') } }, select: { id: true, batchNumber: true, expiryDate: true } }),
      this.prisma.serialNumber.findMany({ where: { id: { in: ids('serialId') } }, select: { id: true, serialNumber: true } }),
      this.prisma.warehouse.findMany({ where: { id: { in: ids('warehouseId') } }, select: { id: true, code: true, name: true } }),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const lm = new Map(locations.map((l) => [l.id, l.code]));
    const bm = new Map(batches.map((b) => [b.id, b]));
    const sm = new Map(serials.map((s) => [s.id, s.serialNumber]));
    const wm = new Map(warehouses.map((w) => [w.id, w]));
    return rows.map((r) => {
      const decision = r.decisions?.[0] ?? null;
      const out: Record<string, unknown> = {
        ...r,
        productCode: r.productId ? pm.get(r.productId)?.code : null,
        productName: r.productId ? pm.get(r.productId)?.name : null,
        warehouseCode: wm.get(r.warehouseId)?.code,
        locationCode: r.locationId ? lm.get(r.locationId) ?? null : null,
        batchNumber: r.batchId ? bm.get(r.batchId)?.batchNumber ?? null : null,
        batchExpiry: r.batchId ? bm.get(r.batchId)?.expiryDate ?? null : null,
        serialNumber: r.serialId ? sm.get(r.serialId) ?? null : r.serialNumberText,
        effectiveResolution: decision?.resolutionType ?? r.suggestedResolution ?? null,
        decision,
        matches: matches.filter((m) => m.shortageVarianceId === r.id || m.surplusVarianceId === r.id),
      };
      if (!showQty) {
        delete out.accountingQuantity;
        delete out.adjustedAccountingQuantity;
        delete out.postSnapshotInQuantity;
        delete out.postSnapshotOutQuantity;
        delete out.quantityDifference;
      }
      if (!showCost) {
        delete out.unitCost;
        delete out.valueDifference;
        delete out.costSource;
        delete out.recoverableAmount;
        if (decision) out.decision = { ...decision, approvedCost: undefined };
      }
      return out;
    });
  }

  // -- rules ----------------------------------------------------------------

  /** Generic final-quantity resolution (spec sections 40-41). */
  finalPhysical(counted: Decimal | null, recounts: Decimal[], supervisorQty: Decimal | null, rule: string): { physical: Decimal | null; requiresSupervisorConfirmation: boolean } {
    if (supervisorQty != null) return { physical: supervisorQty, requiresSupervisorConfirmation: false };
    if (recounts.length === 0) return { physical: counted, requiresSupervisorConfirmation: false };
    const latest = recounts[recounts.length - 1];
    if (rule === 'CONSENSUS') {
      const values = [...(counted ? [counted] : []), ...recounts];
      let best = latest;
      let bestCount = 0;
      values.forEach((v, i) => {
        const c = values.filter((x) => x.eq(v)).length;
        if (c > bestCount || (c === bestCount && i >= values.lastIndexOf(best))) {
          best = v;
          bestCount = c;
        }
      });
      return { physical: best, requiresSupervisorConfirmation: false };
    }
    if (rule === 'SUPERVISOR_CONFIRMED' || rule === 'MANUAL_APPROVED') return { physical: latest, requiresSupervisorConfirmation: true };
    return { physical: latest, requiresSupervisorConfirmation: false };
  }

  private severity(l: ComputedLine): string {
    const value = l.valueDifference?.abs() ?? null;
    const pct = l.adjusted.isZero() ? new Decimal(100) : l.diff.abs().div(l.adjusted.abs()).times(100);
    if ((value && value.gte(5000)) || pct.gte(20)) return 'CRITICAL';
    if ((value && value.gte(1000)) || pct.gte(10)) return 'HIGH';
    if ((value && value.gte(100)) || pct.gte(2)) return 'MEDIUM';
    return 'LOW';
  }

  /** Tolerance (spec section 42): every configured tolerance must hold. */
  private withinTolerance(plan: PlanRow, l: ComputedLine): boolean {
    const tq = decOrNull(plan.toleranceQuantity);
    const tp = decOrNull(plan.tolerancePercent);
    const tv = decOrNull(plan.toleranceValue);
    if (!tq && !tp && !tv) return false;
    if (l.diff.isZero() || l.varianceType === 'UNCOUNTED_ITEM' || l.varianceType === 'UNKNOWN_PRODUCT') return false;
    if (tq && l.diff.abs().gt(tq)) return false;
    if (tp) {
      if (l.adjusted.isZero()) return false;
      if (l.diff.abs().div(l.adjusted.abs()).times(100).gt(tp)) return false;
    }
    if (tv) {
      if (!l.valueDifference) return false;
      if (l.valueDifference.abs().gt(tv)) return false;
    }
    return true;
  }

  /** Recount policy (spec sections 37, 40). A recount that confirms the
   * previous value, or reaching max attempts, stops further recounts. */
  private needsRecount(plan: PlanRow, l: ComputedLine, existing: any | undefined): boolean {
    if (plan.recountPolicy === 'NO_RECOUNT' || plan.recountPolicy === 'MANUAL_SELECTION') return false;
    if (l.diff.isZero() || l.varianceType === 'UNKNOWN_PRODUCT' || l.physical == null) return false;
    if (l.withinTolerance) return false;
    const completed = (existing?.recounts ?? []).filter((r: any) => r.resultStatus === 'COMPLETED');
    if (completed.length >= plan.maxRecountAttempts) return false;
    if (completed.length > 0) {
      const values = [l.counted, ...completed.map((r: any) => dec(r.physicalQuantity))].filter((x): x is Decimal => x != null);
      const last = values[values.length - 1];
      const prev = values[values.length - 2];
      if (prev && last.eq(prev)) return false; // confirmed
    }
    switch (plan.recountPolicy) {
      case 'RECOUNT_ALL_VARIANCES':
        return true;
      case 'RECOUNT_ABOVE_QUANTITY_THRESHOLD':
        return l.diff.abs().gt(dec(plan.recountQuantityThreshold));
      case 'RECOUNT_ABOVE_VALUE_THRESHOLD':
        return l.valueDifference == null || l.valueDifference.abs().gt(dec(plan.recountValueThreshold));
      case 'RECOUNT_PERCENTAGE':
        if (l.adjusted.isZero()) return true;
        return l.diff.abs().div(l.adjusted.abs()).times(100).gt(dec(plan.recountPercentThreshold));
      default:
        return false;
    }
  }

  private suggest(plan: PlanRow, l: ComputedLine): { resolution: string | null; investigate: boolean } {
    switch (l.varianceType) {
      case 'LOCATION_MISMATCH':
        if (plan.locationMismatchPolicy === 'INVESTIGATION_REQUIRED') return { resolution: 'LOCATION_TRANSFER', investigate: true };
        return { resolution: plan.locationMismatchPolicy === 'ADJUST_STOCK' ? 'ADJUST_STOCK' : 'LOCATION_TRANSFER', investigate: false };
      case 'QUALITY_STATUS_MISMATCH':
        return { resolution: 'STATUS_TRANSFER', investigate: false };
      case 'BATCH_MISMATCH':
        return { resolution: 'BATCH_CORRECTION', investigate: false };
      case 'OWNERSHIP_MISMATCH':
        return { resolution: 'ADJUST_STOCK', investigate: true };
      case 'SERIAL_MISSING':
      case 'SERIAL_UNEXPECTED':
        return { resolution: l.matchedQuantity.gt(0) ? 'SERIAL_CORRECTION' : 'ADJUST_STOCK', investigate: false };
      case 'SURPLUS':
      case 'SHORTAGE':
        // Unexpected stock (spec section 84): nothing on the books at all.
        return { resolution: 'ADJUST_STOCK', investigate: false };
      default:
        return { resolution: null, investigate: false };
    }
  }

  /** Cross-dimension offsets (spec sections 26-28, 33, 50, 94). */
  private matchOffsets(lines: ComputedLine[]): ComputedMatch[] {
    const out: ComputedMatch[] = [];
    const remaining = new Map<string, Decimal>();
    const candidates = lines.filter((l) => l.productId && l.physical != null && !l.diff.isZero() && !l.serialId && !l.serialNumberText && l.varianceType !== 'UNKNOWN_PRODUCT');
    candidates.forEach((l) => remaining.set(l.lineKey, l.diff.abs()));

    const passes: { type: string; blank: (l: ComputedLine) => Partial<ComputedLine> }[] = [
      { type: 'LOCATION_MISMATCH', blank: () => ({ locationId: '*' }) },
      { type: 'QUALITY_STATUS_MISMATCH', blank: () => ({ stockStatus: '*' }) },
      { type: 'BATCH_MISMATCH', blank: () => ({ batchId: '*' }) },
      { type: 'OWNERSHIP_MISMATCH', blank: () => ({ ownershipType: '*', ownerCounterpartyId: '*' }) },
    ];
    for (const pass of passes) {
      const groups = new Map<string, ComputedLine[]>();
      for (const l of candidates) {
        if ((remaining.get(l.lineKey) ?? new Decimal(0)).isZero()) continue;
        const gk = stockLineKey({ ...l, ...pass.blank(l) });
        const list = groups.get(gk) ?? [];
        list.push(l);
        groups.set(gk, list);
      }
      for (const group of groups.values()) {
        const shortages = group.filter((l) => l.diff.lt(0)).sort((a, b) => a.lineKey.localeCompare(b.lineKey));
        const surpluses = group.filter((l) => l.diff.gt(0)).sort((a, b) => a.lineKey.localeCompare(b.lineKey));
        for (const s of shortages) {
          for (const p of surpluses) {
            const rs = remaining.get(s.lineKey)!;
            const rp = remaining.get(p.lineKey)!;
            const q = Decimal.min(rs, rp);
            if (q.lte(0)) continue;
            out.push({ matchType: pass.type, shortageKey: s.lineKey, surplusKey: p.lineKey, quantity: q });
            remaining.set(s.lineKey, rs.minus(q));
            remaining.set(p.lineKey, rp.minus(q));
          }
        }
      }
    }

    // Serial swaps: a missing serial and an unexpected serial of the same product/warehouse.
    const serialLines = lines.filter((l) => l.productId && (l.serialId || l.serialNumberText) && !l.diff.isZero() && l.physical != null);
    const byProduct = new Map<string, ComputedLine[]>();
    for (const l of serialLines) {
      const k = `${l.warehouseId}|${l.productId}`;
      const list = byProduct.get(k) ?? [];
      list.push(l);
      byProduct.set(k, list);
    }
    for (const group of byProduct.values()) {
      const missing = group.filter((l) => l.diff.lt(0)).sort((a, b) => a.lineKey.localeCompare(b.lineKey));
      const found = group.filter((l) => l.diff.gt(0)).sort((a, b) => a.lineKey.localeCompare(b.lineKey));
      for (let i = 0; i < Math.min(missing.length, found.length); i++) {
        out.push({ matchType: 'SERIAL_MISMATCH', shortageKey: missing[i].lineKey, surplusKey: found[i].lineKey, quantity: Decimal.min(missing[i].diff.abs(), found[i].diff.abs()) });
      }
    }
    return out;
  }

  private async subtree(tenantId: string, rootId: string, db: PrismaTransactionClient | PrismaService): Promise<string[]> {
    const out = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length > 0) {
      const children = await db.warehouseLocation.findMany({ where: { tenantId, parentLocationId: { in: frontier } }, select: { id: true } });
      frontier = children.map((c) => c.id).filter((id) => !out.has(id));
      frontier.forEach((id) => out.add(id));
    }
    return Array.from(out);
  }
}
