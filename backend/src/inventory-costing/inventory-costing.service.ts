import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InventoryCostMovement } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { InventoryCostDependencyError, InventoryCostingPeriodFinalizedError } from '../common/errors/app-error';
import { InventoryCostingPolicyService } from './costing-policy.service';
import { InventoryCostEngine, RunContext } from './inventory-cost-engine.service';
import { InventoryCostAdjustmentService } from './cost-adjustment.service';
import { d, isoDate, money, monthStart, toDateOnly, unitCostOf } from './costing.types';

export interface DocumentCostResult {
  rows: InventoryCostMovement[];
  /** Inventory-side AND counter-side lines (COGS / expense / income). */
  glLines: AccountingPostingLineInput[];
  /** Inventory-side lines only — for handlers that book the counter side
   * themselves (Purchase Return's AP/GRNI + variance). */
  inventoryLines: AccountingPostingLineInput[];
  /** Σ signed value of the document's ENGINE-valued movements. */
  totalValue: Decimal;
}

export interface RunOptions {
  calculationType: string;
  sourceTrigger: string;
  userId: string;
  sourceDocumentType?: string;
  sourceDocumentId?: string;
  periodStart?: Date;
  fromDate?: Date;
  /** Month (ISO start) currently being finalized — periodic average + FINAL. */
  finalizingMonth?: string;
}

/**
 * Public internal costing API (spec section 115) — what posting handlers
 * and the costing controllers call. Every entry point is a no-op for an
 * organization without an ACTIVE InventoryCostingPolicy covering the
 * date, so the pre-Phase-11 behaviour of every existing flow is preserved
 * byte-for-byte until costing is switched on.
 *
 * Transaction model (spec 91, 96): costing runs INSIDE the posting
 * transaction of the document that caused it (strict synchronous model) —
 * a costing failure rolls the whole posting back, so a movement can never
 * be POSTED with a silently missing cost. Heavy work (backdated
 * recalculation when the policy defers it, period close) runs as its own
 * explicit calculation run.
 */
@Injectable()
export class InventoryCostingService {
  private readonly logger = new Logger('InventoryCostingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly engine: InventoryCostEngine,
    private readonly adjustments: InventoryCostAdjustmentService,
    private readonly audit: AuditService,
  ) {}

  async isActive(tenantId: string, organizationId: string, date: Date, tx?: PrismaTransactionClient): Promise<boolean> {
    return (await this.policies.getPolicyAt(tenantId, organizationId, date, tx)) !== null;
  }

  // ------------------------------------------------------------------
  // Run scaffolding
  // ------------------------------------------------------------------

  async lockOrganization(tx: PrismaTransactionClient, tenantId: string, organizationId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`costing:${tenantId}:${organizationId}`}))`;
  }

  async openRun(tx: PrismaTransactionClient, tenantId: string, organizationId: string, opts: RunOptions): Promise<RunContext> {
    const policies = await this.policies.loadPolicies(tenantId, organizationId, tx);
    const periods = await tx.inventoryCostingPeriod.findMany({ where: { tenantId, organizationId, status: { in: ['FINALIZED', 'CALCULATING'] } } });
    const finalMonths = new Set(periods.map((p) => isoDate(p.periodStart)));
    if (opts.finalizingMonth) finalMonths.add(opts.finalizingMonth);
    const finalized = periods.filter((p) => p.status === 'FINALIZED').sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
    const version = (await tx.inventoryCostCalculationRun.count({ where: { tenantId, organizationId } })) + 1;
    const run = await tx.inventoryCostCalculationRun.create({
      data: {
        tenantId,
        organizationId,
        calculationType: opts.calculationType,
        sourceTrigger: opts.sourceTrigger,
        sourceDocumentType: opts.sourceDocumentType,
        sourceDocumentId: opts.sourceDocumentId,
        initiatedBy: opts.userId,
        periodStart: opts.periodStart,
        fromDate: opts.fromDate,
        method: policies[policies.length - 1]?.costingMethod,
        calculationVersion: version,
      },
    });
    return { tenantId, organizationId, runId: run.id, userId: opts.userId, policies, finalMonths, lockedUntil: finalized[0]?.periodEnd ?? null, queue: new Map(), movementCount: 0, errorCount: 0, includeDocumentIds: new Set(), excludeDocumentIds: new Set() };
  }

  async closeRun(tx: PrismaTransactionClient, ctx: RunContext, adjustmentCount: number, summary?: unknown, audited = false) {
    await tx.inventoryCostCalculationRun.update({
      where: { id: ctx.runId },
      data: { status: 'COMPLETED', completedAt: new Date(), movementCount: ctx.movementCount, adjustmentCount, errorCount: ctx.errorCount, summary: summary as any },
    });
    if (audited) {
      await this.audit.record({ tenantId: ctx.tenantId, eventType: 'INVENTORY_COST_CALCULATION_COMPLETED', entityType: 'InventoryCostCalculationRun', entityId: ctx.runId, action: 'COMPLETE', userId: ctx.userId, newValues: { movementCount: ctx.movementCount, adjustmentCount, errorCount: ctx.errorCount } }, tx);
    }
  }

  /** Drains the key queue (earliest date first, deterministic tie-break by
   * key). Cross-key dependents discovered while replaying are appended. */
  async processQueue(tx: PrismaTransactionClient, ctx: RunContext, priorityKeys: string[] = []): Promise<string[]> {
    const differences = new Set<string>();
    for (let guard = 0; ctx.queue.size > 0; guard++) {
      if (guard > 500) throw new Error('Costing recalculation did not converge (cyclic cost dependency)');
      const entries = [...ctx.queue.entries()].sort((a, b) => {
        const pa = priorityKeys.indexOf(a[0]);
        const pb = priorityKeys.indexOf(b[0]);
        if (pa !== pb) return (pa < 0 ? Infinity : pa) - (pb < 0 ? Infinity : pb);
        return a[1].getTime() - b[1].getTime() || a[0].localeCompare(b[0]);
      });
      const [key, from] = entries[0];
      ctx.queue.delete(key);
      const result = await this.engine.recalculateKey(tx, ctx, key, from);
      result.glDifferences.forEach((id) => differences.add(id));
    }
    return [...differences];
  }

  private async assertNotFinalized(tx: PrismaTransactionClient, tenantId: string, organizationId: string, dates: Date[]) {
    if (dates.length === 0) return;
    const min = new Date(Math.min(...dates.map((x) => x.getTime())));
    const finalized = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, status: 'FINALIZED', periodEnd: { gte: min } }, orderBy: { periodStart: 'asc' } });
    if (finalized) throw new InventoryCostingPeriodFinalizedError(isoDate(finalized.periodStart));
  }

  // ------------------------------------------------------------------
  // Posting integration (spec sections 94, 17, 24, 26-35)
  // ------------------------------------------------------------------

  /**
   * Called by a posting handler right after it recorded its inventory
   * movements, inside the same transaction. Costs them (incrementally, or
   * with a backdated recalculation of the affected keys), books GL deltas
   * for OTHER movements whose cost changed, and returns the GL lines the
   * calling document must book for its own engine-valued movements.
   */
  async onDocumentPosted(tenantId: string, documentType: string, documentId: string, tx: PrismaTransactionClient, userId = 'system'): Promise<DocumentCostResult | null> {
    const movements = await tx.inventoryMovement.findMany({ where: { tenantId, registrarDocumentType: documentType, registrarDocumentId: documentId }, orderBy: { sequenceNo: 'asc' } });
    if (movements.length === 0) return null;
    const organizationId = movements[0].organizationId;
    const policies = await this.policies.loadPolicies(tenantId, organizationId, tx);
    if (!movements.some((m) => InventoryCostingPolicyService.policyAt(policies, m.effectiveDate))) return null;

    await this.lockOrganization(tx, tenantId, organizationId);
    await this.assertNotFinalized(tx, tenantId, organizationId, movements.map((m) => m.effectiveDate));

    const rows = await this.engine.syncMovements(tx, { tenantId, organizationId, policies }, movements);
    if (rows.length === 0) return { rows: [], glLines: [], inventoryLines: [], totalValue: new Decimal(0) };

    const docIds = new Set(rows.map((r) => r.id));
    const byKey = new Map<string, InventoryCostMovement[]>();
    for (const r of rows) byKey.set(r.costingKey, [...(byKey.get(r.costingKey) ?? []), r]);

    let backdated = false;
    const deferredKeys: { key: string; from: Date }[] = [];
    const immediate: { key: string; from: Date }[] = [];
    for (const [key, keyRows] of byKey) {
      const from = new Date(Math.min(...keyRows.map((r) => r.effectiveDate.getTime())));
      const later = await tx.inventoryCostMovement.findFirst({ where: { tenantId, costingKey: key, effectiveDate: { gt: from }, id: { notIn: [...docIds] } } });
      const policy = InventoryCostingPolicyService.policyAt(policies, from) ?? policies[policies.length - 1];
      if (later) backdated = true;
      if (later && !policy.recalculateBackdatedDocuments) deferredKeys.push({ key, from });
      else immediate.push({ key, from });
    }

    const ctx = await this.openRun(tx, tenantId, organizationId, { calculationType: backdated ? 'BACKDATED_RECALCULATION' : 'INCREMENTAL', sourceTrigger: 'DOCUMENT_POSTED', userId, sourceDocumentType: documentType, sourceDocumentId: documentId });

    for (const { key, from } of immediate) {
      let start = from;
      const pending = await tx.inventoryCostRecalculationRequest.findMany({ where: { tenantId, organizationId, costingKey: key, status: 'PENDING' } });
      for (const p of pending) if (p.earliestAffectedDate.getTime() < start.getTime()) start = p.earliestAffectedDate;
      if (pending.length > 0) await tx.inventoryCostRecalculationRequest.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'COMPLETED', processedAt: new Date(), calculationRunId: ctx.runId } });
      if (backdated) {
        await tx.inventoryCostRecalculationRequest.create({ data: { tenantId, organizationId, costingKey: key, earliestAffectedDate: start, reason: 'BACKDATED_DOCUMENT', sourceDocumentType: documentType, sourceDocumentId: documentId, status: 'COMPLETED', processedAt: new Date(), calculationRunId: ctx.runId } });
      }
      ctx.queue.set(key, start);
    }

    for (const { key, from } of deferredKeys) {
      // Deferred policy: value the new movements provisionally at the last
      // known cost, never touch later movements now, and queue the key.
      await tx.inventoryCostRecalculationRequest.create({ data: { tenantId, organizationId, costingKey: key, earliestAffectedDate: from, reason: 'BACKDATED_DOCUMENT', sourceDocumentType: documentType, sourceDocumentId: documentId, status: 'PENDING' } });
      const last = await tx.inventoryCostMovement.findFirst({ where: { tenantId, costingKey: key, unitCost: { gt: 0 }, id: { notIn: [...docIds] } }, orderBy: [{ effectiveDate: 'desc' }, { movementSequence: 'desc' }] });
      for (const r of byKey.get(key)!) {
        const qty = d(r.quantity);
        const estimate = money(qty.mul(d(last?.unitCost)));
        await tx.inventoryCostMovement.update({ where: { id: r.id }, data: { totalCost: estimate.toString(), unitCost: d(last?.unitCost).toString(), provisionalCost: estimate.toString(), costStatus: 'RECALCULATION_REQUIRED', calculationRunId: ctx.runId, glValue: r.glTreatment === 'ENGINE' ? undefined : estimate.toString(), documentGlValue: r.glTreatment === 'ENGINE' ? undefined : estimate.toString() } });
      }
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COST_RECALCULATION_TRIGGERED', entityType: 'InventoryCostRecalculationRequest', entityId: key, action: 'CREATE', userId, newValues: { costingKey: key, earliestAffectedDate: isoDate(from), sourceDocumentType: documentType, sourceDocumentId: documentId } }, tx);
    }

    // Keys holding the document's issues first, so a same-document transfer
    // receipt in another key sees an already-costed issue.
    const outgoingKeys = rows.filter((r) => d(r.quantity).lt(0)).map((r) => r.costingKey);
    const differences = await this.processQueue(tx, ctx, outgoingKeys);
    const others = differences.filter((id) => !docIds.has(id));
    const booked = await this.adjustments.bookDifferences(tx, ctx, others, 'SYSTEM_RECALCULATION', { type: documentType, id: documentId });

    const result = await this.buildDocumentLines(tx, [...docIds]);
    await this.closeRun(tx, ctx, booked.adjustmentIds.length, { journalEntryIds: booked.journalEntryIds }, backdated);
    return result;
  }

  private async buildDocumentLines(tx: PrismaTransactionClient, ids: string[]): Promise<DocumentCostResult> {
    const rows = await tx.inventoryCostMovement.findMany({ where: { id: { in: ids } }, orderBy: { movementSequence: 'asc' } });
    const glLines: AccountingPostingLineInput[] = [];
    const inventoryLines: AccountingPostingLineInput[] = [];
    let totalValue = new Decimal(0);
    for (const r of rows) {
      if (r.glTreatment !== 'ENGINE') continue;
      const value = d(r.totalCost);
      totalValue = totalValue.plus(value);
      const description = `${r.movementType} cost — ${r.sourceDocumentType}`;
      glLines.push(...(await this.adjustments.glLinesFor(tx, r, value, r.effectiveDate, description, true)));
      inventoryLines.push(...(await this.adjustments.glLinesFor(tx, r, value, r.effectiveDate, description, false)));
      await tx.inventoryCostMovement.update({ where: { id: r.id }, data: { glValue: value.toString(), documentGlValue: value.toString() } });
    }
    return { rows, glLines, inventoryLines, totalValue };
  }

  /**
   * Called by a posting handler's `undoSideEffects` BEFORE it deletes its
   * inventory movements. Default policy is the spec's safer "dependency
   * block" (spec 110); `RECALCULATE` removes the cost rows and replays the
   * affected keys instead. Adjustments booked on top of the document's own
   * GL are reversed (spec 109).
   */
  async onDocumentUnposted(tenantId: string, documentType: string, documentId: string, tx: PrismaTransactionClient, userId = 'system'): Promise<void> {
    const rows = await tx.inventoryCostMovement.findMany({ where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId } });
    if (rows.length === 0) return;
    const organizationId = rows[0].organizationId;
    await this.lockOrganization(tx, tenantId, organizationId);
    await this.assertNotFinalized(tx, tenantId, organizationId, rows.map((r) => r.effectiveDate));
    const ids = rows.map((r) => r.id);
    const policies = await this.policies.loadPolicies(tenantId, organizationId, tx);

    for (const r of rows) {
      const policy = InventoryCostingPolicyService.policyAt(policies, r.effectiveDate) ?? policies[policies.length - 1];
      if (!policy || policy.unpostDependencyPolicy !== 'BLOCK' || !r.movementClass.startsWith('INCOMING')) continue;
      const consumer = await tx.inventoryCostConsumption.findFirst({ where: { sourceIncomingCostMovementId: r.id, outgoingCostMovementId: { notIn: ids } } });
      const laterIssue = r.method === 'WEIGHTED_AVERAGE'
        ? await tx.inventoryCostMovement.findFirst({ where: { tenantId, costingKey: r.costingKey, id: { notIn: ids }, quantity: { lt: 0 }, OR: [{ effectiveDate: { gt: r.effectiveDate } }, { effectiveDate: r.effectiveDate, movementSequence: { gt: r.movementSequence } }] } })
        : null;
      if (consumer || laterIssue) {
        const by = consumer ? `${consumer.outgoingDocumentType} ${consumer.outgoingDocumentId}` : `${laterIssue!.sourceDocumentType} ${laterIssue!.sourceDocumentId}`;
        throw new InventoryCostDependencyError(`Cannot unpost: the cost of this ${documentType}'s stock has already been consumed by ${by}. Unpost the dependent document first (costing policy: dependency block).`);
      }
    }

    const ctx = await this.openRun(tx, tenantId, organizationId, { calculationType: 'INCREMENTAL', sourceTrigger: 'DOCUMENT_UNPOSTED', userId, sourceDocumentType: documentType, sourceDocumentId: documentId });
    const reversal = await this.adjustments.reverseAccumulatedAdjustments(tx, ctx, rows, { type: documentType, id: documentId });

    const starts = new Map<string, Date>();
    for (const r of rows) {
      const settled = await tx.inventoryCostConsumption.findMany({ where: { sourceIncomingCostMovementId: r.id, isDeficitSettlement: true }, include: { outgoingCostMovement: { select: { effectiveDate: true } } } });
      let from = r.effectiveDate;
      for (const s of settled) if (s.outgoingCostMovement.effectiveDate.getTime() < from.getTime()) from = s.outgoingCostMovement.effectiveDate;
      const prev = starts.get(r.costingKey);
      if (!prev || from.getTime() < prev.getTime()) starts.set(r.costingKey, from);
    }
    await tx.inventoryCostMovement.deleteMany({ where: { id: { in: ids } } });
    await tx.inventoryCostingError.deleteMany({ where: { costMovementId: { in: ids } } });

    for (const [key, from] of starts) {
      const policy = InventoryCostingPolicyService.policyAt(policies, from) ?? policies[policies.length - 1];
      const later = await tx.inventoryCostMovement.findFirst({ where: { tenantId, costingKey: key, effectiveDate: { gte: from } } });
      if (!later) continue;
      if (policy && !policy.recalculateBackdatedDocuments) {
        await tx.inventoryCostRecalculationRequest.create({ data: { tenantId, organizationId, costingKey: key, earliestAffectedDate: from, reason: 'DOCUMENT_UNPOSTED', sourceDocumentType: documentType, sourceDocumentId: documentId, status: 'PENDING' } });
      } else {
        ctx.queue.set(key, from);
      }
    }
    const differences = await this.processQueue(tx, ctx);
    const booked = await this.adjustments.bookDifferences(tx, ctx, differences, 'SYSTEM_RECALCULATION', { type: documentType, id: documentId });
    await this.closeRun(tx, ctx, booked.adjustmentIds.length + reversal.adjustmentIds.length);
  }

  /**
   * A source document changed the value of already-received goods
   * (Purchase Invoice price difference, Additional Purchase Cost, manual
   * cost adjustment — spec 18-20, 44-45, 72): replay every affected key
   * from the receipt's date so the delta is split between what is still
   * on hand (stays in inventory) and what already left (COGS / expense
   * adjustments), never dumped entirely on current stock (spec 138).
   */
  async onIncomingValueChanged(tenantId: string, receiptLineIds: string[], source: { type: string; id: string; reason: string; direction?: 'POSTING' | 'UNPOSTING' }, tx: PrismaTransactionClient, userId = 'system', extraCostMovementIds: string[] = []): Promise<void> {
    if (receiptLineIds.length === 0 && extraCostMovementIds.length === 0) return;
    const rows = await tx.inventoryCostMovement.findMany({
      where: { tenantId, OR: [...(receiptLineIds.length ? [{ sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentLineId: { in: receiptLineIds } }] : []), ...(extraCostMovementIds.length ? [{ id: { in: extraCostMovementIds } }] : [])] },
    });
    if (rows.length === 0) return;
    const organizationId = rows[0].organizationId;
    await this.lockOrganization(tx, tenantId, organizationId);
    await this.assertNotFinalized(tx, tenantId, organizationId, rows.map((r) => r.effectiveDate));
    const ctx = await this.openRun(tx, tenantId, organizationId, { calculationType: 'BACKDATED_RECALCULATION', sourceTrigger: source.reason, userId, sourceDocumentType: source.type, sourceDocumentId: source.id });
    if (source.direction === 'UNPOSTING') ctx.excludeDocumentIds.add(source.id);
    else ctx.includeDocumentIds.add(source.id);
    for (const r of rows) {
      const prev = ctx.queue.get(r.costingKey);
      if (!prev || r.effectiveDate.getTime() < prev.getTime()) ctx.queue.set(r.costingKey, r.effectiveDate);
    }
    for (const [key, from] of ctx.queue) {
      await tx.inventoryCostRecalculationRequest.create({ data: { tenantId, organizationId, costingKey: key, earliestAffectedDate: from, reason: source.reason, sourceDocumentType: source.type, sourceDocumentId: source.id, status: 'COMPLETED', processedAt: new Date(), calculationRunId: ctx.runId } });
    }
    const differences = await this.processQueue(tx, ctx);
    const booked = await this.adjustments.bookDifferences(tx, ctx, differences, source.reason, { type: source.type, id: source.id });
    await this.audit.record({ tenantId, eventType: 'INVENTORY_COST_LAYER_ADJUSTED', entityType: source.type, entityId: source.id, action: 'RECALCULATE', userId, newValues: { reason: source.reason, affectedKeys: rows.map((r) => r.costingKey), adjustments: booked.adjustmentIds } }, tx);
    await this.closeRun(tx, ctx, booked.adjustmentIds.length, { journalEntryIds: booked.journalEntryIds }, true);
  }

  // ------------------------------------------------------------------
  // Explicit calculation runs (spec 48-49, 85, 114)
  // ------------------------------------------------------------------

  /**
   * Explicit recalculation: drains the PENDING backdated queue (spec 47)
   * and, for FULL_REBUILD, first registers any financial inventory movement
   * still missing from the cost register (e.g. posted before a backdated
   * policy took effect) and replays every key from the earliest date.
   */
  async recalculate(tenantId: string, organizationId: string, userId: string, opts: { fullRebuild?: boolean; fromDate?: Date } = {}) {
    return this.prisma.runInTransaction(
      async (tx) => {
        await this.lockOrganization(tx, tenantId, organizationId);
        const ctx = await this.openRun(tx, tenantId, organizationId, { calculationType: opts.fullRebuild ? 'FULL_REBUILD' : 'BACKDATED_RECALCULATION', sourceTrigger: 'MANUAL', userId, fromDate: opts.fromDate });
        await this.audit.record({ tenantId, eventType: 'INVENTORY_COST_CALCULATION_STARTED', entityType: 'InventoryCostCalculationRun', entityId: ctx.runId, action: 'START', userId, newValues: { fullRebuild: !!opts.fullRebuild, fromDate: opts.fromDate ? isoDate(opts.fromDate) : null } }, tx);

        if (opts.fullRebuild) {
          const firstPolicy = ctx.policies[0];
          if (firstPolicy) {
            const movements = await tx.inventoryMovement.findMany({ where: { tenantId, organizationId, effectiveDate: { gte: opts.fromDate ?? firstPolicy.effectiveFrom } }, orderBy: [{ effectiveDate: 'asc' }, { sequenceNo: 'asc' }] });
            await this.engine.syncMovements(tx, ctx, movements);
          }
          const keys = await tx.inventoryCostMovement.groupBy({ by: ['costingKey'], where: { tenantId, organizationId, ...(opts.fromDate ? { effectiveDate: { gte: opts.fromDate } } : {}) }, _min: { effectiveDate: true } });
          for (const k of keys) {
            let from = k._min.effectiveDate!;
            if (ctx.lockedUntil && from.getTime() <= ctx.lockedUntil.getTime()) from = new Date(ctx.lockedUntil.getTime() + 24 * 3600 * 1000);
            ctx.queue.set(k.costingKey, from);
          }
        }

        const pending = await tx.inventoryCostRecalculationRequest.findMany({ where: { tenantId, organizationId, status: 'PENDING' } });
        for (const p of pending) {
          const prev = ctx.queue.get(p.costingKey);
          if (!prev || p.earliestAffectedDate.getTime() < prev.getTime()) ctx.queue.set(p.costingKey, p.earliestAffectedDate);
        }
        const differences = await this.processQueue(tx, ctx);
        if (pending.length > 0) await tx.inventoryCostRecalculationRequest.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'COMPLETED', processedAt: new Date(), calculationRunId: ctx.runId } });
        const booked = await this.adjustments.bookDifferences(tx, ctx, differences, 'SYSTEM_RECALCULATION');
        if (booked.journalEntryIds.length > 0) {
          await tx.costingAccountingBatch.create({ data: { tenantId, organizationId, calculationRunId: ctx.runId, journalEntryIds: booked.journalEntryIds, totalDebit: booked.totalDebit.toString(), totalCredit: booked.totalCredit.toString(), entryCount: booked.journalEntryIds.length } });
        }
        await this.closeRun(tx, ctx, booked.adjustmentIds.length, { processedRequests: pending.length, journalEntryIds: booked.journalEntryIds }, true);
        return tx.inventoryCostCalculationRun.findUniqueOrThrow({ where: { id: ctx.runId } });
      },
      { timeout: 120000 },
    );
  }

  // ------------------------------------------------------------------
  // Internal cost API for other modules (spec 36, 115)
  // ------------------------------------------------------------------

  /** Current unit cost of a product (as of a date) for estimates/preview. */
  async getUnitCost(tenantId: string, organizationId: string, productId: string, warehouseId: string | null, asOfDate: Date): Promise<Decimal | null> {
    const policy = await this.policies.getPolicyAt(tenantId, organizationId, asOfDate);
    if (!policy) return null;
    const agg = await this.prisma.inventoryCostMovement.aggregate({
      where: { tenantId, organizationId, productId, effectiveDate: { lte: asOfDate }, ...(policy.costByWarehouse && warehouseId ? { warehouseId } : {}) },
      _sum: { quantity: true, totalCost: true },
    });
    const qty = d(agg._sum.quantity);
    if (qty.gt(0)) return unitCostOf(d(agg._sum.totalCost), qty);
    const last = await this.prisma.inventoryCostMovement.findFirst({ where: { tenantId, organizationId, productId, effectiveDate: { lte: asOfDate }, unitCost: { gt: 0 } }, orderBy: [{ effectiveDate: 'desc' }, { movementSequence: 'desc' }] });
    return last ? d(last.unitCost) : null;
  }

  /** COGS of a posted document (e.g. a Shipment) — Phase 24 margin input. */
  async getDocumentCost(tenantId: string, documentType: string, documentId: string) {
    const rows = await this.prisma.inventoryCostMovement.findMany({ where: { tenantId, sourceDocumentType: documentType, sourceDocumentId: documentId } });
    return {
      totalCost: rows.reduce((s, r) => s.plus(d(r.totalCost)), new Decimal(0)).abs().toString(),
      movements: rows.map((r) => ({ id: r.id, productId: r.productId, quantity: r.quantity.toString(), unitCost: r.unitCost.toString(), totalCost: r.totalCost.toString(), costStatus: r.costStatus })),
    };
  }

  /** Preview (spec 86): an estimate at current cost, never authoritative. */
  async previewIssueCost(tenantId: string, organizationId: string, productId: string, warehouseId: string | null, quantity: Decimal.Value, asOfDate = toDateOnly(new Date())) {
    const unit = await this.getUnitCost(tenantId, organizationId, productId, warehouseId, asOfDate);
    return { authoritative: false, unitCost: unit?.toString() ?? null, estimatedCost: unit ? money(unit.mul(quantity)).toString() : null, asOfDate: isoDate(asOfDate), month: isoDate(monthStart(asOfDate)) };
  }
}
