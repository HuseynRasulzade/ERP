import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InventoryMovement } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NotFoundAppError } from '../common/errors/app-error';
import { InventoryCostingPolicyService } from './costing-policy.service';
import { InventoryCostingDimensionService } from './costing-dimension.service';
import { NEUTRAL_MOVEMENT_TYPES, d, isoDate, toDateOnly, unitCostOf } from './costing.types';

export interface HealthIssue {
  check: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  message: string;
  details?: unknown;
}

/**
 * Valuation, COGS, layer, trace, reconciliation and health queries
 * (spec sections 63-66, 75-82, 115). Read-only; every number is derived
 * from the cost register — never from a cached "product cost" field.
 */
@Injectable()
export class CostingReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: InventoryCostingPolicyService,
    private readonly dims: InventoryCostingDimensionService,
    private readonly mappings: AccountingMappingService,
  ) {}

  /** Inventory valuation as of a date (spec 76-77, 83): quantity and value
   * are both summed from the historical cost register up to the date —
   * never current cost × historical quantity. */
  async valuation(tenantId: string, organizationId: string, filters: { asOfDate?: string; warehouseId?: string; productId?: string; costStatus?: string } = {}) {
    const asOf = filters.asOfDate ? toDateOnly(new Date(filters.asOfDate)) : toDateOnly(new Date());
    const where: any = { tenantId, organizationId, effectiveDate: { lte: asOf } };
    if (filters.productId) where.productId = filters.productId;
    if (filters.warehouseId) where.physicalWarehouseId = filters.warehouseId;
    if (filters.costStatus) where.costStatus = filters.costStatus;

    const byKey = await this.prisma.inventoryCostMovement.groupBy({ by: ['costingKey', 'productId', 'warehouseId', 'batchId'], where, _sum: { quantity: true, totalCost: true } });
    const provisional = await this.prisma.inventoryCostMovement.groupBy({ by: ['costingKey'], where: { ...where, costStatus: { not: 'FINAL' } }, _sum: { totalCost: true } });
    const provByKey = new Map(provisional.map((p) => [p.costingKey, d(p._sum.totalCost)]));
    const policy = await this.policies.getPolicyAt(tenantId, organizationId, asOf);

    const rows = [] as any[];
    for (const k of byKey) {
      const qty = d(k._sum.quantity);
      const value = d(k._sum.totalCost);
      const physical = await this.prisma.inventoryMovement.aggregate({
        where: { tenantId, organizationId, productId: k.productId, effectiveDate: { lte: asOf }, ...(k.warehouseId ? { warehouseId: k.warehouseId } : filters.warehouseId ? { warehouseId: filters.warehouseId } : {}), ...(k.batchId ? { batchId: k.batchId } : {}), stockStatus: { not: 'IN_TRANSIT' } },
        _sum: { quantity: true },
      });
      const provisionalValue = provByKey.get(k.costingKey) ?? new Decimal(0);
      rows.push({
        costingKey: k.costingKey,
        productId: k.productId,
        warehouseId: k.warehouseId,
        batchId: k.batchId,
        physicalQuantity: d(physical._sum.quantity).toString(),
        financialQuantity: qty.toString(),
        unitCost: unitCostOf(value, qty).toString(),
        inventoryValue: value.toString(),
        provisionalValue: provisionalValue.toString(),
        finalValue: value.minus(provisionalValue).toString(),
        costingMethod: policy?.costingMethod ?? null,
        status: provisionalValue.isZero() ? 'FINAL' : 'PROVISIONAL',
      });
    }
    rows.sort((a, b) => a.costingKey.localeCompare(b.costingKey));
    const total = rows.reduce((s, r) => s.plus(d(r.inventoryValue)), new Decimal(0));
    return { asOfDate: isoDate(asOf), costingMethod: policy?.costingMethod ?? null, totalValue: total.toString(), rows };
  }

  /** FIFO layer report (spec 80, 84). */
  async layers(tenantId: string, organizationId: string, filters: { productId?: string; costingKey?: string; openOnly?: boolean } = {}) {
    const layers = await this.prisma.inventoryCostLayer.findMany({
      where: { tenantId, organizationId, ...(filters.productId ? { productId: filters.productId } : {}), ...(filters.costingKey ? { costingKey: filters.costingKey } : {}), ...(filters.openOnly ? { remainingQuantity: { gt: 0 } } : {}) },
      orderBy: [{ costingKey: 'asc' }, { receiptDate: 'asc' }, { movementSequence: 'asc' }],
    });
    const today = toDateOnly(new Date()).getTime();
    return layers.map((l) => ({
      id: l.id,
      productId: l.productId,
      costingKey: l.costingKey,
      warehouseId: l.warehouseId,
      receiptDocumentType: l.sourceDocumentType,
      receiptDocumentId: l.sourceDocumentId,
      receiptDate: isoDate(l.receiptDate),
      originalQuantity: l.originalQuantity.toString(),
      consumedQuantity: d(l.originalQuantity).minus(d(l.remainingQuantity)).toString(),
      remainingQuantity: l.remainingQuantity.toString(),
      originalUnitCost: l.originalUnitCost.toString(),
      currentUnitCost: l.currentUnitCost.toString(),
      originalCost: l.originalTotalCost.toString(),
      adjustedCost: l.currentTotalCost.toString(),
      remainingValue: l.currentRemainingValue.toString(),
      status: l.status,
      ageDays: Math.floor((today - l.receiptDate.getTime()) / (24 * 3600 * 1000)),
    }));
  }

  /** Cost layer card (spec 84): components, consumers, adjustments. */
  async layerCard(tenantId: string, organizationId: string, layerId: string) {
    const layer = await this.prisma.inventoryCostLayer.findFirst({
      where: { id: layerId, tenantId, organizationId },
      include: { sourceCostMovement: { include: { components: true } }, consumptions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!layer) throw new NotFoundAppError('InventoryCostLayer', layerId);
    const adjustments = await this.prisma.inventoryCostAdjustmentLine.findMany({ where: { tenantId, costMovementId: layer.sourceCostMovementId }, include: { adjustment: true } });
    return {
      layer,
      costComponents: layer.sourceCostMovement.components,
      consumedBy: layer.consumptions.map((c) => ({ documentType: c.outgoingDocumentType, documentId: c.outgoingDocumentId, lineId: c.outgoingDocumentLineId, quantity: c.consumedQuantity.toString(), unitCost: c.unitCost.toString(), cost: c.consumedCost.toString(), deficitSettlement: c.isDeficitSettlement })),
      adjustments,
    };
  }

  /** Drill-down from an issue to its cost sources (spec 11, 75). */
  async trace(tenantId: string, organizationId: string, filters: { documentType: string; documentId: string }) {
    const rows = await this.prisma.inventoryCostMovement.findMany({
      where: { tenantId, organizationId, sourceDocumentType: filters.documentType, sourceDocumentId: filters.documentId },
      include: { outgoingConsumptions: { include: { costLayer: true, sourceIncoming: { include: { components: true } } } }, components: true, layer: true },
      orderBy: { movementSequence: 'asc' },
    });
    const adjustments = await this.prisma.inventoryCostAdjustmentLine.findMany({ where: { tenantId, costMovementId: { in: rows.map((r) => r.id) } }, include: { adjustment: true } });
    return rows.map((r) => ({
      costMovementId: r.id,
      inventoryMovementId: r.sourceInventoryMovementId,
      movementType: r.movementType,
      productId: r.productId,
      quantity: r.quantity.toString(),
      unitCost: r.unitCost.toString(),
      totalCost: r.totalCost.toString(),
      costStatus: r.costStatus,
      calculationRunId: r.calculationRunId,
      postingVersion: r.postingVersion,
      components: r.components,
      layer: r.layer,
      costSources: r.outgoingConsumptions.map((c) => ({
        receiptDocumentType: c.sourceIncoming?.sourceDocumentType ?? null,
        receiptDocumentId: c.sourceIncoming?.sourceDocumentId ?? null,
        receiptDate: c.sourceIncoming ? isoDate(c.sourceIncoming.effectiveDate) : null,
        layerId: c.costLayerId,
        quantity: c.consumedQuantity.toString(),
        unitCost: c.unitCost.toString(),
        cost: c.consumedCost.toString(),
        deficitSettlement: c.isDeficitSettlement,
        receiptComponents: c.sourceIncoming?.components ?? [],
      })),
      adjustments: adjustments.filter((a) => a.costMovementId === r.id).map((a) => ({ adjustmentId: a.adjustmentId, number: a.adjustment.number, reason: a.adjustment.reason, oldCost: a.oldCost.toString(), newCost: a.newCost.toString(), delta: a.adjustmentAmount.toString(), calculationRunId: a.adjustment.calculationRunId, journalEntryId: a.adjustment.journalEntryId })),
    }));
  }

  /** COGS / gross margin report (spec 78): revenue from posted Sales
   * Invoices (Phase 7) linked to the shipment line, COGS from the cost
   * register net of every later adjustment. */
  async cogs(tenantId: string, organizationId: string, filters: { from?: string; to?: string; productId?: string } = {}) {
    const rows = await this.prisma.inventoryCostMovement.findMany({
      where: {
        tenantId,
        organizationId,
        movementType: { in: ['SALES_SHIPMENT', 'SALES_RETURN'] },
        ...(filters.productId ? { productId: filters.productId } : {}),
        effectiveDate: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) },
      },
      orderBy: [{ effectiveDate: 'asc' }, { movementSequence: 'asc' }],
    });
    const byLine = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.sourceDocumentType}:${r.sourceDocumentLineId ?? r.id}`;
      const agg = byLine.get(key) ?? { date: isoDate(r.effectiveDate), documentType: r.sourceDocumentType, documentId: r.sourceDocumentId, lineId: r.sourceDocumentLineId, productId: r.productId, quantity: new Decimal(0), cogs: new Decimal(0), revenue: new Decimal(0), costStatus: r.costStatus };
      agg.quantity = agg.quantity.plus(d(r.quantity).neg());
      agg.cogs = agg.cogs.plus(d(r.totalCost).neg());
      if (r.costStatus !== 'FINAL') agg.costStatus = r.costStatus;
      byLine.set(key, agg);
    }
    const result = [] as any[];
    for (const agg of byLine.values()) {
      let customerId: string | null = null;
      if (agg.documentType === 'SHIPMENT' && agg.lineId) {
        const invoiceLines = await this.prisma.salesInvoiceLine.findMany({ where: { tenantId, sourceShipmentLineId: agg.lineId, salesInvoice: { postingStatus: 'POSTED' } }, include: { salesInvoice: { select: { counterpartyId: true } } } });
        for (const l of invoiceLines) {
          agg.revenue = agg.revenue.plus(d(l.lineTotal));
          customerId = l.salesInvoice.counterpartyId;
        }
        if (!customerId) customerId = (await this.prisma.shipment.findFirst({ where: { id: agg.documentId }, select: { counterpartyId: true } }))?.counterpartyId ?? null;
      } else if (agg.documentType === 'SALES_RETURN' && agg.lineId) {
        const line = await this.prisma.salesReturnLine.findFirst({ where: { id: agg.lineId }, include: { salesReturn: { select: { counterpartyId: true } } } });
        if (line) {
          agg.revenue = d(line.returnNet).isZero() ? d(line.originalUnitPrice).mul(d(line.quantity)).neg() : d(line.returnNet).neg();
          customerId = line.salesReturn.counterpartyId;
        }
      }
      const gross = agg.revenue.minus(agg.cogs);
      result.push({
        date: agg.date,
        salesDocumentType: agg.documentType,
        salesDocumentId: agg.documentId,
        customerId,
        productId: agg.productId,
        quantitySold: agg.quantity.toString(),
        revenue: agg.revenue.toFixed(2),
        cogs: agg.cogs.toFixed(2),
        grossProfit: gross.toFixed(2),
        grossMarginPercent: agg.revenue.isZero() ? null : gross.div(agg.revenue).mul(100).toFixed(2),
        costStatus: agg.costStatus,
      });
    }
    const totals = result.reduce((t, r) => ({ revenue: t.revenue.plus(r.revenue), cogs: t.cogs.plus(r.cogs) }), { revenue: new Decimal(0), cogs: new Decimal(0) });
    return { rows: result, totals: { revenue: totals.revenue.toFixed(2), cogs: totals.cogs.toFixed(2), grossProfit: totals.revenue.minus(totals.cogs).toFixed(2) } };
  }

  /** Subledger vs GL (spec 63, 132). */
  async reconciliation(tenantId: string, organizationId: string, asOfDate?: string, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const asOf = asOfDate ? toDateOnly(new Date(asOfDate)) : toDateOnly(new Date());
    const sub = await db.inventoryCostMovement.aggregate({ where: { tenantId, organizationId, effectiveDate: { lte: asOf } }, _sum: { totalCost: true } });
    let glValue = new Decimal(0);
    let accountCode: string | null = null;
    try {
      const account = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, asOf, tx);
      accountCode = account.code;
      const debit = await db.accountingMovement.aggregate({ where: { tenantId, organizationId, accountId: account.id, side: 'DEBIT', businessDate: { lte: asOf } }, _sum: { amountBase: true } });
      const credit = await db.accountingMovement.aggregate({ where: { tenantId, organizationId, accountId: account.id, side: 'CREDIT', businessDate: { lte: asOf } }, _sum: { amountBase: true } });
      glValue = d(debit._sum.amountBase).minus(d(credit._sum.amountBase));
    } catch {
      /* no chart adopted — GL side unknown */
    }
    const policy = await this.policies.getPolicyAt(tenantId, organizationId, asOf, tx);
    const tolerance = d(policy?.reconciliationTolerance ?? '0.01');
    const subledger = d(sub._sum.totalCost);
    const difference = glValue.minus(subledger);
    return { asOfDate: isoDate(asOf), accountCode, subledgerValue: subledger.toFixed(2), glValue: glValue.toFixed(2), difference: difference.toFixed(2), tolerance: tolerance.toFixed(2), healthy: difference.abs().lte(tolerance) };
  }

  /** Financial inventory movements (policy active, financial ownership,
   * non-neutral) with no cost register row — "uncosted" (spec 82, 96). */
  async uncostedMovements(tenantId: string, organizationId: string, to: Date, from?: Date, tx?: PrismaTransactionClient): Promise<InventoryMovement[]> {
    const db = tx ?? this.prisma;
    const policies = await this.policies.loadPolicies(tenantId, organizationId, tx);
    if (policies.length === 0) return [];
    const movements = await db.inventoryMovement.findMany({ where: { tenantId, organizationId, effectiveDate: { gte: from ?? policies[0].effectiveFrom, lte: to }, movementType: { notIn: [...NEUTRAL_MOVEMENT_TYPES] } } });
    if (movements.length === 0) return [];
    const costed = new Set((await db.inventoryCostMovement.findMany({ where: { sourceInventoryMovementId: { in: movements.map((m) => m.id) } }, select: { sourceInventoryMovementId: true } })).map((c) => c.sourceInventoryMovementId));
    const result: InventoryMovement[] = [];
    for (const m of movements) {
      if (costed.has(m.id)) continue;
      const policy = InventoryCostingPolicyService.policyAt(policies, m.effectiveDate);
      if (!policy || !this.dims.isFinancial(policy, m.ownershipType) || d(m.baseQuantity).isZero()) continue;
      if (m.movementType === 'TRANSFER_OUT' || m.movementType === 'TRANSFER_IN') {
        const pair = movements.find((x) => x.registrarDocumentId === m.registrarDocumentId && x.registrarLineId === m.registrarLineId && x.movementType === (m.movementType === 'TRANSFER_OUT' ? 'TRANSFER_IN' : 'TRANSFER_OUT'));
        if (pair && this.dims.resolve(policy, pair).costingKey === this.dims.resolve(policy, m).costingKey) continue;
      }
      result.push(m);
    }
    return result;
  }

  /** Quantity register vs cost register per costing key (spec 64, 135). */
  async quantityReconciliation(tenantId: string, organizationId: string, asOf: Date, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const policy = await this.policies.getPolicyAt(tenantId, organizationId, asOf, tx);
    if (!policy) return [];
    const inv = await db.inventoryMovement.groupBy({
      by: ['productId', 'warehouseId', 'batchId'],
      where: { tenantId, organizationId, effectiveDate: { gte: (await this.policies.loadPolicies(tenantId, organizationId, tx))[0].effectiveFrom, lte: asOf }, ownershipType: { in: policy.financialOwnershipTypes } },
      _sum: { baseQuantity: true },
    });
    const physicalByKey = new Map<string, Decimal>();
    for (const g of inv) {
      const key = this.dims.resolve(policy, { organizationId, productId: g.productId, warehouseId: g.warehouseId, batchId: g.batchId }).costingKey;
      physicalByKey.set(key, (physicalByKey.get(key) ?? new Decimal(0)).plus(d(g._sum.baseQuantity)));
    }
    const cost = await db.inventoryCostMovement.groupBy({ by: ['costingKey'], where: { tenantId, organizationId, effectiveDate: { lte: asOf } }, _sum: { quantity: true, totalCost: true } });
    const costByKey = new Map(cost.map((c) => [c.costingKey, c]));
    const keys = new Set([...physicalByKey.keys(), ...costByKey.keys()]);
    return [...keys].sort().map((key) => {
      const financialQuantity = physicalByKey.get(key) ?? new Decimal(0);
      const c = costByKey.get(key);
      const costQuantity = d(c?._sum.quantity);
      const value = d(c?._sum.totalCost);
      return { costingKey: key, financialQuantity: financialQuantity.toString(), costQuantity: costQuantity.toString(), value: value.toFixed(2), quantityMatches: financialQuantity.eq(costQuantity) };
    });
  }

  /** Costing health report (spec 82, 65-66, 96). */
  async health(tenantId: string, organizationId: string, asOfDate?: string, tx?: PrismaTransactionClient) {
    const db = tx ?? this.prisma;
    const asOf = asOfDate ? toDateOnly(new Date(asOfDate)) : toDateOnly(new Date());
    const issues: HealthIssue[] = [];
    const policies = await this.policies.loadPolicies(tenantId, organizationId, tx);
    if (policies.length === 0) {
      return { asOfDate: isoDate(asOf), healthy: true, costingEnabled: false, issues: [{ check: 'COSTING_NOT_CONFIGURED', severity: 'INFO', message: 'No inventory costing policy — costing is not enabled for this organization' }] };
    }

    const uncosted = await this.uncostedMovements(tenantId, organizationId, asOf, undefined, tx);
    if (uncosted.length > 0) issues.push({ check: 'UNCOSTED_MOVEMENTS', severity: 'BLOCKING', message: `${uncosted.length} financial inventory movement(s) have no cost`, details: uncosted.slice(0, 50).map((m) => ({ id: m.id, documentType: m.registrarDocumentType, documentId: m.registrarDocumentId, date: isoDate(m.effectiveDate) })) });

    const statusCounts = await db.inventoryCostMovement.groupBy({ by: ['costStatus'], where: { tenantId, organizationId, effectiveDate: { lte: asOf } }, _count: { _all: true } });
    for (const s of statusCounts) {
      if (s.costStatus === 'PROVISIONAL') issues.push({ check: 'PROVISIONAL_MOVEMENTS', severity: 'INFO', message: `${s._count._all} movement(s) carry a provisional cost` });
      if (s.costStatus === 'RECALCULATION_REQUIRED' || s.costStatus === 'UNCALCULATED') issues.push({ check: 'PENDING_RECALCULATION', severity: 'BLOCKING', message: `${s._count._all} movement(s) await recalculation` });
      if (s.costStatus === 'ERROR') issues.push({ check: 'COSTING_ERRORS', severity: 'ERROR', message: `${s._count._all} movement(s) could not be costed` });
    }
    const pending = await db.inventoryCostRecalculationRequest.count({ where: { tenantId, organizationId, status: 'PENDING' } });
    if (pending > 0) issues.push({ check: 'PENDING_RECALCULATION', severity: 'BLOCKING', message: `${pending} recalculation request(s) are pending` });

    const openErrors = await db.inventoryCostingError.findMany({ where: { tenantId, organizationId, resolved: false }, take: 100, orderBy: { createdAt: 'desc' } });
    const blockingErrors = openErrors.filter((e) => e.blocking);
    if (blockingErrors.length > 0) issues.push({ check: 'COSTING_ERRORS', severity: 'BLOCKING', message: `${blockingErrors.length} unresolved blocking costing error(s)`, details: blockingErrors.map((e) => ({ id: e.id, errorCode: e.errorCode, description: e.description })) });

    const qty = await this.quantityReconciliation(tenantId, organizationId, asOf, tx);
    for (const q of qty) {
      if (!q.quantityMatches) issues.push({ check: 'QUANTITY_VALUE_MISMATCH', severity: 'BLOCKING', message: `Costing key ${q.costingKey}: quantity register ${q.financialQuantity} vs cost register ${q.costQuantity}`, details: q });
      const qd = d(q.costQuantity);
      const vd = d(q.value);
      if (qd.lt(0)) issues.push({ check: 'NEGATIVE_QUANTITY', severity: 'BLOCKING', message: `Costing key ${q.costingKey} has negative financial quantity ${q.costQuantity}`, details: q });
      if (qd.isZero() && !vd.isZero()) issues.push({ check: 'ZERO_QUANTITY_WITH_VALUE', severity: 'ERROR', message: `Costing key ${q.costingKey} has zero quantity but value ${q.value}`, details: q });
      if (qd.gt(0) && vd.isZero()) issues.push({ check: 'ZERO_VALUE_STOCK', severity: 'WARNING', message: `Costing key ${q.costingKey} has ${q.costQuantity} units at zero value (free goods or missing cost?)`, details: q });
    }

    const layersMismatch = await db.$queryRaw<{ costing_key: string; layer_qty: string; cost_qty: string }[]>`
      SELECT l.costing_key, SUM(l.remaining_quantity)::text AS layer_qty, (SELECT COALESCE(SUM(m.quantity),0) FROM inventory_cost_movements m WHERE m.costing_key = l.costing_key AND m.tenant_id = ${tenantId})::text AS cost_qty
      FROM inventory_cost_layers l JOIN inventory_cost_movements s ON s.id = l.source_cost_movement_id
      WHERE l.tenant_id = ${tenantId} AND l.organization_id = ${organizationId} AND s.method = 'FIFO'
      GROUP BY l.costing_key`;
    for (const r of layersMismatch) {
      if (!d(r.layer_qty).eq(d(r.cost_qty)) && d(r.cost_qty).gte(0)) issues.push({ check: 'MISSING_FIFO_LAYERS', severity: 'WARNING', message: `Costing key ${r.costing_key}: open FIFO layers ${r.layer_qty} vs cost quantity ${r.cost_qty}` });
    }

    const draftCosts = await db.additionalPurchaseCost.count({ where: { tenantId, organizationId, postingStatus: 'NOT_POSTED', status: { not: 'CANCELLED' } } });
    if (draftCosts > 0) issues.push({ check: 'UNALLOCATED_ADDITIONAL_COSTS', severity: 'WARNING', message: `${draftCosts} additional purchase cost document(s) are not posted yet` });

    const draftAdjustments = await db.inventoryCostAdjustment.count({ where: { tenantId, organizationId, status: 'DRAFT' } });
    if (draftAdjustments > 0) issues.push({ check: 'UNRESOLVED_COST_ADJUSTMENTS', severity: 'WARNING', message: `${draftAdjustments} cost adjustment(s) are still in draft` });

    const recon = await this.reconciliation(tenantId, organizationId, isoDate(asOf), tx);
    if (!recon.healthy) issues.push({ check: 'ACCOUNTING_IMBALANCE', severity: 'ERROR', message: `Inventory subledger ${recon.subledgerValue} vs GL ${recon.glValue}: difference ${recon.difference}`, details: recon });

    const finalized = await db.inventoryCostingPeriod.findMany({ where: { tenantId, organizationId, status: 'FINALIZED' } });
    for (const p of finalized) {
      const modified = await db.inventoryCostMovement.count({ where: { tenantId, organizationId, effectiveDate: { gte: p.periodStart, lte: p.periodEnd }, updatedAt: { gt: p.finalCalculatedAt ?? p.updatedAt } } });
      if (modified > 0) issues.push({ check: 'FINALIZED_PERIOD_MODIFIED', severity: 'BLOCKING', message: `${modified} cost movement(s) in finalized period ${isoDate(p.periodStart)} changed after finalization` });
    }

    const healthy = !issues.some((i) => i.severity === 'ERROR' || i.severity === 'BLOCKING');
    return { asOfDate: isoDate(asOf), healthy, costingEnabled: true, issues };
  }

  calculations(tenantId: string, organizationId: string) {
    return this.prisma.inventoryCostCalculationRun.findMany({ where: { tenantId, organizationId }, orderBy: { startedAt: 'desc' }, take: 200 });
  }

  errors(tenantId: string, organizationId: string, includeResolved = false) {
    return this.prisma.inventoryCostingError.findMany({ where: { tenantId, organizationId, ...(includeResolved ? {} : { resolved: false }) }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  adjustments(tenantId: string, organizationId: string) {
    return this.prisma.inventoryCostAdjustment.findMany({ where: { tenantId, organizationId }, include: { lines: { orderBy: { position: 'asc' } } }, orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }], take: 500 });
  }

  periods(tenantId: string, organizationId: string) {
    return this.prisma.inventoryCostingPeriod.findMany({ where: { tenantId, organizationId }, orderBy: { periodStart: 'desc' } });
  }
}
