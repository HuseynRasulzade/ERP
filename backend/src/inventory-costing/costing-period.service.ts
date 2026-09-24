import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictAppError, InventoryCostingFinalizationBlockedError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { InventoryCostingService } from './inventory-costing.service';
import { InventoryCostAdjustmentService } from './cost-adjustment.service';
import { CostingReportingService } from './costing-reporting.service';
import { d, isoDate, monthEnd, monthStart } from './costing.types';

interface Blocker {
  check: string;
  message: string;
  details?: unknown;
}

class PreviewRollback extends Error {
  constructor(readonly payload: unknown) {
    super('preview rollback');
  }
}

/**
 * CostingPeriodService — FinalizeInventoryCost(period) (spec sections
 * 57-60, 116-118, 133-134). Finalization is sequential per organization:
 * it verifies the period is closable (no pending backdated recalculation,
 * no uncosted movements, no blocking costing errors, no negative stock,
 * quantity register == cost register), replays every affected costing key
 * from the period start with the period marked final (periodic averages
 * applied, every cost FINAL), books only the delta adjustments, snapshots
 * the closing state (FIFO layers included, spec 106-107) and marks the
 * period FINALIZED. Afterwards nothing dated inside it may change without
 * an explicit, audited reopen. `preview` runs the whole computation in a
 * transaction that is always rolled back (spec 116: no posting until
 * confirmed).
 */
@Injectable()
export class CostingPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: InventoryCostingService,
    private readonly adjustments: InventoryCostAdjustmentService,
    private readonly reporting: CostingReportingService,
    private readonly audit: AuditService,
  ) {}

  parsePeriod(period: string): { start: Date; end: Date } {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) throw new ValidationAppError('period must be YYYY-MM');
    const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    return { start, end: monthEnd(start) };
  }

  async finalize(tenantId: string, organizationId: string, period: string, userId: string, opts: { preview?: boolean } = {}) {
    const { start, end } = this.parsePeriod(period);
    try {
      return await this.prisma.runInTransaction(
        async (tx) => {
          await this.costing.lockOrganization(tx, tenantId, organizationId);
          const existing = await tx.inventoryCostingPeriod.findUnique({ where: { organizationId_periodStart: { organizationId, periodStart: start } } });
          if (existing && existing.tenantId !== tenantId) throw new NotFoundAppError('InventoryCostingPeriod', period);
          if (existing?.status === 'FINALIZED') throw new ConflictAppError(`Inventory costing period ${period} is already finalized`);

          const { blockers, warnings } = await this.checks(tx, tenantId, organizationId, start, end);
          if (blockers.length > 0 && !opts.preview) throw new InventoryCostingFinalizationBlockedError(blockers);

          const periodRow = existing
            ? await tx.inventoryCostingPeriod.update({ where: { id: existing.id }, data: { status: 'CALCULATING' } })
            : await tx.inventoryCostingPeriod.create({ data: { tenantId, organizationId, periodStart: start, periodEnd: end, status: 'CALCULATING' } });

          const before = await this.flowSummary(tx, tenantId, organizationId, start, end);
          const ctx = await this.costing.openRun(tx, tenantId, organizationId, { calculationType: opts.preview ? 'DIAGNOSTIC' : 'PERIOD_CLOSE', sourceTrigger: 'FINALIZE', userId, periodStart: start, fromDate: start, finalizingMonth: isoDate(start) });
          const keys = await tx.inventoryCostMovement.groupBy({ by: ['costingKey'], where: { tenantId, organizationId, effectiveDate: { gte: start, lte: end } } });
          for (const k of keys) ctx.queue.set(k.costingKey, start);
          const differences = await this.costing.processQueue(tx, ctx);

          const pendingDeltas = await tx.inventoryCostMovement.findMany({ where: { id: { in: differences } } });
          const projectedAdjustment = pendingDeltas.reduce((s, r) => s.plus(d(r.totalCost).minus(d(r.glValue))), new Decimal(0));
          const cogsAdjustment = pendingDeltas.filter((r) => r.counterMappingKey === 'COGS').reduce((s, r) => s.minus(d(r.totalCost).minus(d(r.glValue))), new Decimal(0));

          await tx.inventoryCostMovement.updateMany({ where: { tenantId, organizationId, effectiveDate: { gte: start, lte: end }, costStatus: { in: ['PROVISIONAL'] } }, data: { costStatus: 'FINAL' } });
          const after = await this.flowSummary(tx, tenantId, organizationId, start, end);

          if (opts.preview) {
            throw new PreviewRollback({
              period,
              blockers,
              warnings,
              currentProvisionalCogs: before.cogs,
              projectedFinalCogs: after.cogs,
              cogsAdjustment: cogsAdjustment.toFixed(2),
              inventoryValueAdjustment: projectedAdjustment.toFixed(2),
              projectedSummary: after,
            });
          }

          const booked = await this.adjustments.bookDifferences(tx, ctx, differences, 'PERIOD_CLOSE');
          if (booked.journalEntryIds.length > 0) {
            await tx.costingAccountingBatch.create({ data: { tenantId, organizationId, calculationRunId: ctx.runId, periodStart: start, journalEntryIds: booked.journalEntryIds, totalDebit: booked.totalDebit.toString(), totalCredit: booked.totalCredit.toString(), entryCount: booked.journalEntryIds.length } });
          }
          await this.snapshot(tx, tenantId, organizationId, end, ctx.runId);

          const recon = await this.reporting.reconciliation(tenantId, organizationId, isoDate(end), tx);
          if (!recon.healthy) warnings.push({ check: 'GL_RECONCILIATION', message: `Inventory subledger ${recon.subledgerValue} vs GL ${recon.glValue} (difference ${recon.difference})`, details: recon });

          const summary = { ...after, adjustmentEntries: booked.adjustmentIds.length, journalEntryIds: booked.journalEntryIds, warnings, reconciliation: recon };
          const finalized = await tx.inventoryCostingPeriod.update({
            where: { id: periodRow.id },
            data: { status: 'FINALIZED', finalCalculatedAt: new Date(), finalizedBy: userId, calculationRunId: ctx.runId, summary: summary as any, version: { increment: 1 } },
          });
          await this.costing.closeRun(tx, ctx, booked.adjustmentIds.length, summary, false);
          await this.audit.record({ tenantId, eventType: 'INVENTORY_COSTING_PERIOD_FINALIZED', entityType: 'InventoryCostingPeriod', entityId: finalized.id, action: 'FINALIZE', userId, newValues: { period, calculationRunId: ctx.runId, closingInventoryValue: after.closingInventoryValue, cogs: after.cogs } }, tx);
          return finalized;
        },
        { timeout: 120000 },
      );
    } catch (error) {
      if (error instanceof PreviewRollback) return error.payload;
      throw error;
    }
  }

  async reopen(tenantId: string, organizationId: string, period: string, userId: string, reason: string) {
    if (!reason || reason.trim().length === 0) throw new ValidationAppError('A reason is required to reopen an inventory costing period');
    const { start, end } = this.parsePeriod(period);
    return this.prisma.runInTransaction(async (tx) => {
      await this.costing.lockOrganization(tx, tenantId, organizationId);
      const row = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, periodStart: start } });
      if (!row) throw new NotFoundAppError('InventoryCostingPeriod', period);
      if (row.status !== 'FINALIZED') throw new ConflictAppError(`Inventory costing period ${period} is not finalized`);
      const later = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, status: 'FINALIZED', periodStart: { gt: start } } });
      if (later) throw new ConflictAppError(`Reopen ${isoDate(later.periodStart).slice(0, 7)} first — costing periods reopen in reverse order`);
      await tx.inventoryCostBalanceSnapshot.deleteMany({ where: { tenantId, organizationId, periodEnd: end } });
      const updated = await tx.inventoryCostingPeriod.update({ where: { id: row.id }, data: { status: 'REOPENED', reopenedAt: new Date(), reopenedBy: userId, reopenReason: reason, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'INVENTORY_COSTING_PERIOD_REOPENED', entityType: 'InventoryCostingPeriod', entityId: row.id, action: 'REOPEN', userId, reason, oldValues: { status: 'FINALIZED' }, newValues: { status: 'REOPENED' } }, tx);
      return updated;
    });
  }

  private async checks(tx: PrismaTransactionClient, tenantId: string, organizationId: string, start: Date, end: Date) {
    const blockers: Blocker[] = [];
    const warnings: Blocker[] = [];

    const earlierOpen = await tx.inventoryCostMovement.findFirst({ where: { tenantId, organizationId, effectiveDate: { lt: start } }, orderBy: { effectiveDate: 'asc' } });
    if (earlierOpen) {
      const firstMonth = monthStart(earlierOpen.effectiveDate);
      for (let m = firstMonth; m.getTime() < start.getTime(); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
        const hasMovements = await tx.inventoryCostMovement.count({ where: { tenantId, organizationId, effectiveDate: { gte: m, lte: monthEnd(m) } } });
        if (!hasMovements) continue;
        const p = await tx.inventoryCostingPeriod.findFirst({ where: { tenantId, organizationId, periodStart: m, status: 'FINALIZED' } });
        if (!p) {
          blockers.push({ check: 'PREVIOUS_PERIOD_NOT_FINALIZED', message: `Finalize ${isoDate(m).slice(0, 7)} first` });
          break;
        }
      }
    }

    const pending = await tx.inventoryCostRecalculationRequest.findMany({ where: { tenantId, organizationId, status: 'PENDING', earliestAffectedDate: { lte: end } } });
    if (pending.length > 0) blockers.push({ check: 'PENDING_RECALCULATION', message: `${pending.length} backdated recalculation request(s) must be processed first`, details: pending.map((p) => ({ costingKey: p.costingKey, earliestAffectedDate: isoDate(p.earliestAffectedDate), reason: p.reason })) });

    const unfinished = await tx.inventoryCostMovement.count({ where: { tenantId, organizationId, effectiveDate: { lte: end }, costStatus: { in: ['UNCALCULATED', 'RECALCULATION_REQUIRED'] } } });
    if (unfinished > 0) blockers.push({ check: 'UNCOSTED_MOVEMENTS', message: `${unfinished} cost movement(s) are not calculated` });

    const uncosted = await this.reporting.uncostedMovements(tenantId, organizationId, end, undefined, tx);
    if (uncosted.length > 0) blockers.push({ check: 'UNCOSTED_MOVEMENTS', message: `${uncosted.length} financial inventory movement(s) have no cost register entry — run a full rebuild`, details: uncosted.slice(0, 20).map((m) => m.id) });

    const errors = await tx.inventoryCostingError.findMany({ where: { tenantId, organizationId, resolved: false, blocking: true } });
    if (errors.length > 0) blockers.push({ check: 'COSTING_ERRORS', message: `${errors.length} unresolved blocking costing error(s)`, details: errors.map((e) => ({ id: e.id, errorCode: e.errorCode, description: e.description })) });

    const qty = await this.reporting.quantityReconciliation(tenantId, organizationId, end, tx);
    for (const q of qty) {
      if (d(q.costQuantity).lt(0)) blockers.push({ check: 'NEGATIVE_STOCK', message: `Costing key ${q.costingKey} has negative financial quantity ${q.costQuantity} at period end` });
      if (!q.quantityMatches) blockers.push({ check: 'QUANTITY_VALUE_MISMATCH', message: `Costing key ${q.costingKey}: quantity register ${q.financialQuantity} vs cost register ${q.costQuantity}` });
    }

    const provisionalReceipts = await tx.inventoryCostMovement.count({ where: { tenantId, organizationId, effectiveDate: { gte: start, lte: end }, movementType: 'PURCHASE_RECEIPT', costStatus: 'PROVISIONAL' } });
    if (provisionalReceipts > 0) warnings.push({ check: 'PENDING_PURCHASE_INVOICES', message: `${provisionalReceipts} receipt(s) are not fully invoiced — their receipt price becomes final` });
    const draftCosts = await tx.additionalPurchaseCost.count({ where: { tenantId, organizationId, postingStatus: 'NOT_POSTED', status: { not: 'CANCELLED' }, documentDate: { lte: end } } });
    if (draftCosts > 0) warnings.push({ check: 'PENDING_ADDITIONAL_COSTS', message: `${draftCosts} additional purchase cost document(s) dated in or before the period are not posted` });

    return { blockers, warnings };
  }

  /** Cost flow equation (spec 117-118): opening + Σ period flows = closing. */
  private async flowSummary(tx: PrismaTransactionClient, tenantId: string, organizationId: string, start: Date, end: Date) {
    const opening = await tx.inventoryCostMovement.aggregate({ where: { tenantId, organizationId, effectiveDate: { lt: start } }, _sum: { totalCost: true } });
    const flows = await tx.inventoryCostMovement.groupBy({ by: ['movementType'], where: { tenantId, organizationId, effectiveDate: { gte: start, lte: end } }, _sum: { totalCost: true } });
    const byType = new Map(flows.map((f) => [f.movementType, d(f._sum.totalCost)]));
    const get = (t: string) => byType.get(t) ?? new Decimal(0);
    const components = await tx.inventoryCostComponent.aggregate({ where: { tenantId, componentType: { notIn: ['BASE_PRICE', 'OPENING_BALANCE', 'SURPLUS_VALUE', 'ORIGINAL_SHIPMENT_COST', 'TRANSFERRED_COST', 'CURRENT_COST', 'CURRENT_AVERAGE', 'LAST_KNOWN_COST', 'INVOICE_PRICE_DIFFERENCE', 'MANUAL_ADJUSTMENT'] }, costMovement: { organizationId, effectiveDate: { gte: start, lte: end }, movementType: 'PURCHASE_RECEIPT' } }, _sum: { allocatedAmount: true } });
    const additional = d(components._sum.allocatedAmount);
    const openingValue = d(opening._sum.totalCost);
    const periodTotal = flows.reduce((s, f) => s.plus(d(f._sum.totalCost)), new Decimal(0));
    const closingValue = openingValue.plus(periodTotal);
    const uncosted = await tx.inventoryCostMovement.count({ where: { tenantId, organizationId, effectiveDate: { gte: start, lte: end }, costStatus: { in: ['UNCALCULATED', 'RECALCULATION_REQUIRED', 'ERROR'] } } });
    const purchases = get('PURCHASE_RECEIPT').minus(additional);
    return {
      period: isoDate(start).slice(0, 7),
      openingInventoryValue: openingValue.toFixed(2),
      purchases: purchases.toFixed(2),
      additionalCosts: additional.toFixed(2),
      inventoryAdjustments: get('SURPLUS').plus(get('OPENING_BALANCE')).toFixed(2),
      goodsAvailableForSale: openingValue.plus(get('PURCHASE_RECEIPT')).plus(get('SURPLUS')).plus(get('OPENING_BALANCE')).toFixed(2),
      cogs: get('SALES_SHIPMENT').plus(get('SALES_RETURN')).neg().toFixed(2),
      writeOff: get('WRITE_OFF').neg().toFixed(2),
      internalConsumption: get('INTERNAL_CONSUMPTION').neg().toFixed(2),
      purchaseReturns: get('PURCHASE_RETURN').neg().toFixed(2),
      transfersNet: get('TRANSFER_IN').plus(get('TRANSFER_OUT')).toFixed(2),
      closingInventoryValue: closingValue.toFixed(2),
      uncostedMovements: uncosted,
      equationResidual: closingValue.minus(openingValue.plus(periodTotal)).toFixed(2),
    };
  }

  /** Period-end snapshot per costing key incl. open FIFO layers as of the
   * period end (spec 106-108) — rebuildable from the register at will. */
  private async snapshot(tx: PrismaTransactionClient, tenantId: string, organizationId: string, end: Date, runId: string) {
    await tx.inventoryCostBalanceSnapshot.deleteMany({ where: { tenantId, organizationId, periodEnd: end } });
    const keys = await tx.inventoryCostMovement.groupBy({ by: ['costingKey', 'productId', 'warehouseId', 'batchId'], where: { tenantId, organizationId, effectiveDate: { lte: end } }, _sum: { quantity: true, totalCost: true } });
    for (const k of keys) {
      const qty = d(k._sum.quantity);
      const value = d(k._sum.totalCost);
      const layers = await tx.inventoryCostLayer.findMany({ where: { tenantId, costingKey: k.costingKey, receiptDate: { lte: end } }, orderBy: [{ receiptDate: 'asc' }, { movementSequence: 'asc' }] });
      const openLayers = [] as any[];
      for (const l of layers) {
        const consumed = await tx.inventoryCostConsumption.aggregate({ where: { costLayerId: l.id, outgoingCostMovement: { effectiveDate: { lte: end } } }, _sum: { consumedQuantity: true, consumedCost: true } });
        const remaining = d(l.originalQuantity).minus(d(consumed._sum.consumedQuantity));
        if (remaining.gt(0)) openLayers.push({ layerId: l.id, receiptDate: isoDate(l.receiptDate), remainingQuantity: remaining.toString(), unitCost: l.currentUnitCost.toString(), remainingValue: d(l.currentTotalCost).minus(d(consumed._sum.consumedCost)).toFixed(2) });
      }
      await tx.inventoryCostBalanceSnapshot.create({
        data: { tenantId, organizationId, costingKey: k.costingKey, productId: k.productId, warehouseId: k.warehouseId, batchId: k.batchId, periodEnd: end, quantity: qty.toString(), value: value.toFixed(2), averageCost: qty.gt(0) ? value.div(qty).toDecimalPlaces(6).toString() : '0', openLayers, calculationRunId: runId },
      });
    }
  }
}
