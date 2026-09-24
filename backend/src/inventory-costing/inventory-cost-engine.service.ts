import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InventoryCostMovement, InventoryCostingPolicy, InventoryMovement } from '@prisma/client';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { InventoryCostingPeriodFinalizedError } from '../common/errors/app-error';
import { InventoryCostingPolicyService } from './costing-policy.service';
import { InventoryCostingDimensionService } from './costing-dimension.service';
import { ComponentInput, CostSourceService } from './cost-source.service';
import { CostingMethod, INTERNAL_CONSUMPTION_EXPENSE_MAPPING, NEUTRAL_MOVEMENT_TYPES, classifyMovementType, d, isoDate, money, monthStart, unitCostOf } from './costing.types';
import { CostingState, DeficitState, InventoryCostingStrategy, LayerState, provisionalUnitCostFor } from './strategies/costing-strategy';
import { FifoCostingStrategy } from './strategies/fifo.strategy';
import { WeightedAverageCostingStrategy } from './strategies/weighted-average.strategy';

export interface RunContext {
  tenantId: string;
  organizationId: string;
  runId: string;
  userId: string;
  policies: InventoryCostingPolicy[];
  /** Month starts (ISO) whose periodic average / FINAL status applies:
   * FINALIZED periods and the period currently being finalized. */
  finalMonths: Set<string>;
  /** Latest FINALIZED period end — nothing on or before it may change. */
  lockedUntil: Date | null;
  /** Keys to (re)process after the current one, earliest date each. */
  queue: Map<string, Date>;
  movementCount: number;
  errorCount: number;
  /** Source documents being posted / unposted in this transaction. */
  includeDocumentIds: Set<string>;
  excludeDocumentIds: Set<string>;
}

interface ReplayRecord {
  cm: InventoryCostMovement;
  value: Decimal; // signed
  unitCost: Decimal;
  status: string;
  deficitQuantity: Decimal;
  provisionalUnitCost: Decimal | null;
  components: ComponentInput[];
  layer: LayerState | null;
  errors: { errorCode: string; description: string; severity: string; blocking: boolean }[];
}

interface PendingConsumption {
  outgoingCostMovementId: string;
  layer: LayerState | null;
  sourceIncomingCostMovementId: string | null;
  quantity: Decimal;
  unitCost: Decimal;
  cost: Decimal;
  isDeficitSettlement: boolean;
}

export interface KeyRecalculationResult {
  costingKey: string;
  fromDate: Date;
  replayed: number;
  /** ENGINE-treated cost movements whose value now differs from GL. */
  glDifferences: string[];
}

/**
 * The costing replay engine (spec sections 46-48, 50): rebuilds one costing
 * key deterministically from the earliest affected date — opening state
 * from persisted layers/consumptions/values strictly before that date
 * (never a full-history scan), then every cost movement from that date in
 * (effective date, posting sequence) order through the policy's strategy.
 * Idempotent by construction: derived rows (layers, consumptions,
 * components, errors) of the replayed range are deleted and rebuilt, so
 * processing the same movement twice can never duplicate a layer or a
 * cost (spec 93, 130); only a genuine value change is reported upward as
 * a GL difference (spec 131).
 */
@Injectable()
export class InventoryCostEngine {
  private readonly strategies: Record<CostingMethod, InventoryCostingStrategy> = {
    FIFO: new FifoCostingStrategy(),
    WEIGHTED_AVERAGE: new WeightedAverageCostingStrategy(),
  };

  constructor(
    private readonly dims: InventoryCostingDimensionService,
    private readonly sources: CostSourceService,
  ) {}

  // -------------------------------------------------------------------
  // Cost register sync — one cost row per financial inventory movement.
  // -------------------------------------------------------------------

  async syncMovements(tx: PrismaTransactionClient, ctx: Pick<RunContext, 'tenantId' | 'organizationId' | 'policies'>, movements: InventoryMovement[]): Promise<InventoryCostMovement[]> {
    const created: InventoryCostMovement[] = [];
    for (const m of movements) {
      if (NEUTRAL_MOVEMENT_TYPES.has(m.movementType)) continue;
      const policy = InventoryCostingPolicyService.policyAt(ctx.policies, m.effectiveDate);
      if (!policy) continue;
      if (!this.dims.isFinancial(policy, m.ownershipType)) continue;
      const qty = d(m.baseQuantity);
      if (qty.isZero()) continue;

      const key = this.dims.resolve(policy, m);
      if (m.movementType === 'TRANSFER_OUT' || m.movementType === 'TRANSFER_IN') {
        const pairType = m.movementType === 'TRANSFER_OUT' ? 'TRANSFER_IN' : 'TRANSFER_OUT';
        const pair = movements.find((x) => x.registrarDocumentId === m.registrarDocumentId && x.registrarLineId === m.registrarLineId && x.movementType === pairType)
          ?? (await tx.inventoryMovement.findFirst({ where: { tenantId: m.tenantId, registrarDocumentType: m.registrarDocumentType, registrarDocumentId: m.registrarDocumentId, registrarLineId: m.registrarLineId, movementType: pairType } }));
        // Same costing key on both sides (e.g. organization-level costing,
        // or a location move): no economic cost event at all (spec 30-32).
        if (pair && this.dims.resolve(policy, pair).costingKey === key.costingKey) continue;
      }

      const existing = await tx.inventoryCostMovement.findUnique({ where: { sourceInventoryMovementId: m.id } });
      if (existing) {
        created.push(existing);
        continue;
      }

      const cls = classifyMovementType(m.movementType, qty);
      let counterAccountId: string | null = null;
      let counterMappingKey = cls.counterMappingKey;
      if (m.movementType === 'INTERNAL_CONSUMPTION' && m.registrarLineId) {
        const line = await tx.internalConsumptionLine.findFirst({ where: { id: m.registrarLineId, tenantId: m.tenantId }, include: { internalConsumption: { select: { operationType: true } } } });
        counterAccountId = line?.expenseAccountId ?? null;
        counterMappingKey = INTERNAL_CONSUMPTION_EXPENSE_MAPPING[line?.internalConsumption.operationType ?? ''] ?? counterMappingKey;
      }

      created.push(
        await tx.inventoryCostMovement.create({
          data: {
            tenantId: m.tenantId,
            organizationId: m.organizationId,
            costingKey: key.costingKey,
            warehouseId: key.warehouseId,
            physicalWarehouseId: m.warehouseId,
            productId: m.productId,
            batchId: m.batchId,
            ownershipType: m.ownershipType,
            sourceInventoryMovementId: m.id,
            movementSequence: m.sequenceNo,
            sourceDocumentType: m.registrarDocumentType,
            sourceDocumentId: m.registrarDocumentId,
            sourceDocumentLineId: m.registrarLineId,
            effectiveDate: m.effectiveDate,
            postingDate: m.effectiveDate,
            movementType: m.movementType,
            movementClass: cls.movementClass,
            glTreatment: cls.glTreatment,
            counterMappingKey,
            counterAccountId,
            quantity: qty.toString(),
            valuationCurrencyId: policy.valuationCurrencyId,
            method: policy.costingMethod,
            costStatus: 'UNCALCULATED',
          },
        }),
      );
    }
    return created;
  }

  // -------------------------------------------------------------------
  // Recalculation of one costing key from a date.
  // -------------------------------------------------------------------

  async recalculateKey(tx: PrismaTransactionClient, ctx: RunContext, costingKey: string, requestedFrom: Date): Promise<KeyRecalculationResult> {
    const { tenantId } = ctx;
    const fromDate = await this.effectiveStartDate(tx, tenantId, costingKey, requestedFrom);
    if (ctx.lockedUntil && fromDate.getTime() <= ctx.lockedUntil.getTime()) {
      throw new InventoryCostingPeriodFinalizedError(isoDate(monthStart(fromDate)));
    }

    const replay = await tx.inventoryCostMovement.findMany({
      where: { tenantId, costingKey, effectiveDate: { gte: fromDate } },
      orderBy: [{ effectiveDate: 'asc' }, { movementSequence: 'asc' }],
    });
    const replayIds = replay.map((r) => r.id);
    const previousValues = new Map(replay.map((r) => [r.id, d(r.totalCost)]));

    if (replayIds.length > 0) {
      await tx.inventoryCostConsumption.deleteMany({ where: { OR: [{ outgoingCostMovementId: { in: replayIds } }, { sourceIncomingCostMovementId: { in: replayIds } }] } });
      await tx.inventoryCostLayer.deleteMany({ where: { sourceCostMovementId: { in: replayIds } } });
      await tx.inventoryCostComponent.deleteMany({ where: { costMovementId: { in: replayIds } } });
      await tx.inventoryCostingError.deleteMany({ where: { costMovementId: { in: replayIds }, resolved: false } });
    }

    const firstPolicy = InventoryCostingPolicyService.policyAt(ctx.policies, replay[0]?.effectiveDate ?? fromDate) ?? ctx.policies[ctx.policies.length - 1];
    const state = await this.loadOpeningState(tx, tenantId, costingKey, fromDate, (firstPolicy?.costingMethod as CostingMethod) ?? 'FIFO');

    const records = new Map<string, ReplayRecord>();
    const consumptions: PendingConsumption[] = [];
    const externalDeltas = new Map<string, Decimal>(); // deficit issues before fromDate settled during this replay
    const periodicAverages = new Map<string, Decimal | null>();

    for (let i = 0; i < replay.length; i++) {
      const cm = replay[i];
      const policy = InventoryCostingPolicyService.policyAt(ctx.policies, cm.effectiveDate) ?? firstPolicy;
      const method = (policy.costingMethod as CostingMethod) ?? 'FIFO';
      if (state.method !== method) this.convertState(state, method);
      const strategy = this.strategies[state.method];
      const qty = d(cm.quantity).abs();
      const month = isoDate(monthStart(cm.effectiveDate));
      const isFinalMonth = ctx.finalMonths.has(month);
      const record: ReplayRecord = { cm, value: new Decimal(0), unitCost: new Decimal(0), status: 'PROVISIONAL', deficitQuantity: new Decimal(0), provisionalUnitCost: null, components: [], layer: null, errors: [] };

      if (cm.movementClass === 'INCOMING_SOURCED' || cm.movementClass === 'INCOMING_DERIVED') {
        const incoming = await this.incomingValue(tx, ctx, cm, state, policy, records);
        record.value = incoming.value;
        record.status = incoming.status;
        record.components = incoming.components;
        record.errors.push(...incoming.errors);
        const received = strategy.processIncomingMovement(state, cm.id, cm.sourceDocumentLineId, cm.effectiveDate, cm.movementSequence, qty, incoming.value, incoming.status !== 'FINAL');
        record.layer = received.layer;
        for (const s of received.settlements) {
          consumptions.push({ outgoingCostMovementId: s.deficit.costMovementId, layer: received.layer, sourceIncomingCostMovementId: cm.id, quantity: s.quantity, unitCost: s.unitCost, cost: s.cost, isDeficitSettlement: true });
          const target = records.get(s.deficit.costMovementId);
          if (target) {
            target.value = target.value.plus(s.delta);
            if (s.deficit.open.isZero() && target.status === 'PROVISIONAL' && !target.errors.some((e) => e.blocking)) target.status = incoming.status === 'FINAL' ? 'FINAL' : 'PROVISIONAL';
          } else {
            externalDeltas.set(s.deficit.costMovementId, (externalDeltas.get(s.deficit.costMovementId) ?? new Decimal(0)).plus(s.delta));
          }
        }
      } else {
        let specificReceiptLineIds: string[] | undefined;
        let specificUnitCost: Decimal | null = null;
        if (cm.movementClass === 'OUTGOING_SPECIFIC') {
          specificReceiptLineIds = await this.sources.purchaseReturnReceiptLines(tx, cm);
          const rows = await this.sources.receiptLineCostRows(tx, tenantId, specificReceiptLineIds);
          let q = new Decimal(0);
          let v = new Decimal(0);
          for (const r of rows) {
            const rec = records.get(r.id);
            q = q.plus(r.quantity.abs());
            v = v.plus(rec ? rec.value.abs() : r.totalCost.abs());
          }
          specificUnitCost = q.gt(0) ? unitCostOf(v, q) : null;
        }
        let periodicAverage: Decimal | null = null;
        if (state.method === 'WEIGHTED_AVERAGE' && policy.averageMethod === 'PERIODIC_WEIGHTED_AVERAGE' && isFinalMonth) {
          if (!periodicAverages.has(month)) periodicAverages.set(month, await this.periodicAverage(tx, ctx, state, replay, i, month, records, policy));
          periodicAverage = periodicAverages.get(month) ?? null;
        }
        const issue = strategy.calculateOutgoingCost(state, cm.id, cm.effectiveDate, cm.movementSequence, qty, {
          negativeStockCostPolicy: policy.negativeStockCostPolicy,
          allowNegativeQuantityCosting: policy.allowNegativeQuantityCosting,
          specificReceiptLineIds,
          specificUnitCost,
          periodicAverage,
        });
        record.value = issue.value.neg();
        record.deficitQuantity = issue.deficitQuantity;
        record.provisionalUnitCost = issue.provisionalUnitCost;
        for (const c of issue.consumptions) {
          consumptions.push({ outgoingCostMovementId: cm.id, layer: c.layer, sourceIncomingCostMovementId: c.sourceIncomingCostMovementId, quantity: c.quantity, unitCost: c.unitCost, cost: c.cost, isDeficitSettlement: false });
        }
        const periodicOpen = state.method === 'WEIGHTED_AVERAGE' && policy.averageMethod === 'PERIODIC_WEIGHTED_AVERAGE' && !isFinalMonth;
        record.status = issue.blocked ? 'ERROR' : issue.provisional || periodicOpen ? 'PROVISIONAL' : 'FINAL';
        if (issue.deficitQuantity.gt(0)) {
          record.errors.push(
            issue.blocked
              ? { errorCode: 'NEGATIVE_INVENTORY_INCONSISTENCY', description: `Issue of ${qty.toString()} exceeds costed stock by ${issue.deficitQuantity.toString()} and the policy blocks negative-stock costing`, severity: 'BLOCKING', blocking: true }
              : { errorCode: 'NO_ELIGIBLE_FIFO_LAYER', description: `Issue of ${qty.toString()} exceeds costed stock by ${issue.deficitQuantity.toString()}; valued provisionally at ${issue.provisionalUnitCost?.toString()} (${policy.negativeStockCostPolicy}) until a receipt settles it`, severity: 'WARNING', blocking: false },
          );
        }
      }

      if (isFinalMonth && record.status === 'PROVISIONAL' && record.deficitQuantity.isZero()) record.status = 'FINAL';
      records.set(cm.id, record);
    }

    // ---- persist ----
    for (const layer of state.layers) {
      if (layer.persistedId || !layer.sourceCostMovementId) continue;
      const rec = records.get(layer.sourceCostMovementId);
      if (!rec) continue;
      const created = await tx.inventoryCostLayer.create({
        data: {
          tenantId,
          organizationId: rec.cm.organizationId,
          costingKey,
          productId: rec.cm.productId,
          warehouseId: rec.cm.warehouseId,
          batchId: rec.cm.batchId,
          sourceCostMovementId: rec.cm.id,
          sourceInventoryMovementId: rec.cm.sourceInventoryMovementId,
          sourceDocumentType: rec.cm.sourceDocumentType,
          sourceDocumentId: rec.cm.sourceDocumentId,
          sourceDocumentLineId: rec.cm.sourceDocumentLineId,
          receiptDate: rec.cm.effectiveDate,
          movementSequence: rec.cm.movementSequence,
          originalQuantity: layer.originalQuantity.toString(),
          remainingQuantity: layer.remainingQuantity.toString(),
          originalUnitCost: this.baseUnitCost(rec, layer.originalQuantity).toString(),
          currentUnitCost: layer.unitCost.toString(),
          originalTotalCost: this.baseValue(rec).toString(),
          currentTotalCost: layer.totalValue.toString(),
          currentRemainingValue: layer.remainingValue.toString(),
          currencyId: rec.cm.valuationCurrencyId,
          status: this.layerStatus(layer, rec),
          calculationRunId: ctx.runId,
        },
      });
      layer.persistedId = created.id;
    }
    for (const layer of state.layers) {
      if (!layer.persistedId || !layer.sourceCostMovementId || records.has(layer.sourceCostMovementId)) continue;
      // opening layer possibly consumed during this replay
      await tx.inventoryCostLayer.update({
        where: { id: layer.persistedId },
        data: { remainingQuantity: layer.remainingQuantity.toString(), currentRemainingValue: layer.remainingValue.toString(), status: layer.remainingQuantity.lte(0) ? 'CLOSED' : layer.remainingQuantity.lt(layer.originalQuantity) ? 'PARTIALLY_CONSUMED' : 'OPEN', calculationRunId: ctx.runId },
      });
    }

    if (consumptions.length > 0) {
      const outgoingIds = [...new Set(consumptions.map((c) => c.outgoingCostMovementId))];
      const outgoingRows = await tx.inventoryCostMovement.findMany({ where: { id: { in: outgoingIds } } });
      const byId = new Map(outgoingRows.map((r) => [r.id, r]));
      await tx.inventoryCostConsumption.createMany({
        data: consumptions.map((c) => {
          const out = records.get(c.outgoingCostMovementId)?.cm ?? byId.get(c.outgoingCostMovementId)!;
          return {
            tenantId,
            organizationId: out.organizationId,
            costingKey,
            outgoingCostMovementId: out.id,
            outgoingInventoryMovementId: out.sourceInventoryMovementId,
            outgoingDocumentType: out.sourceDocumentType,
            outgoingDocumentId: out.sourceDocumentId,
            outgoingDocumentLineId: out.sourceDocumentLineId,
            costLayerId: c.layer?.persistedId ?? null,
            sourceIncomingCostMovementId: c.sourceIncomingCostMovementId,
            consumedQuantity: c.quantity.toString(),
            unitCost: c.unitCost.toString(),
            consumedCost: c.cost.toString(),
            isDeficitSettlement: c.isDeficitSettlement,
            calculationRunId: ctx.runId,
          };
        }),
      });
    }

    const componentRows = [...records.values()].flatMap((r) =>
      r.components.map((c) => ({ tenantId, costMovementId: r.cm.id, componentType: c.componentType, sourceDocumentType: c.sourceDocumentType, sourceDocumentId: c.sourceDocumentId, sourceDocumentLineId: c.sourceDocumentLineId ?? null, amount: c.amount.toString(), allocatedAmount: c.allocatedAmount.toString(), currencyId: r.cm.valuationCurrencyId, baseCurrencyAmount: c.allocatedAmount.toString() })),
    );
    if (componentRows.length > 0) await tx.inventoryCostComponent.createMany({ data: componentRows });

    const errorRows = [...records.values()].flatMap((r) =>
      r.errors.map((e) => ({ tenantId, organizationId: r.cm.organizationId, calculationRunId: ctx.runId, productId: r.cm.productId, warehouseId: r.cm.physicalWarehouseId, costingKey, inventoryMovementId: r.cm.sourceInventoryMovementId, costMovementId: r.cm.id, sourceDocumentType: r.cm.sourceDocumentType, sourceDocumentId: r.cm.sourceDocumentId, errorCode: e.errorCode, description: e.description, severity: e.severity, blocking: e.blocking })),
    );
    if (errorRows.length > 0) await tx.inventoryCostingError.createMany({ data: errorRows });
    ctx.errorCount += errorRows.filter((e) => e.severity === 'ERROR' || e.severity === 'BLOCKING').length;

    const glDifferences: string[] = [];
    for (const rec of records.values()) {
      const value = money(rec.value);
      const previous = previousValues.get(rec.cm.id)!;
      const changed = rec.cm.costStatus === 'UNCALCULATED' || !previous.eq(value);
      const qty = d(rec.cm.quantity).abs();
      await tx.inventoryCostMovement.update({
        where: { id: rec.cm.id },
        data: {
          totalCost: value.toString(),
          unitCost: unitCostOf(value, qty).toString(),
          deficitQuantity: rec.deficitQuantity.toString(),
          provisionalUnitCost: rec.provisionalUnitCost?.toString() ?? null,
          costStatus: rec.status,
          calculationRunId: ctx.runId,
          provisionalCost: rec.cm.provisionalCost ?? value.toString(),
          finalCost: rec.status === 'FINAL' ? value.toString() : null,
          postingVersion: changed && rec.cm.costStatus !== 'UNCALCULATED' ? { increment: 1 } : undefined,
          glValue: rec.cm.glTreatment === 'ENGINE' ? undefined : value.toString(),
          documentGlValue: rec.cm.glTreatment === 'ENGINE' ? undefined : value.toString(),
        },
      });
      if (rec.cm.glTreatment === 'ENGINE' && rec.cm.costStatus !== 'UNCALCULATED' && !d(rec.cm.glValue).eq(value)) glDifferences.push(rec.cm.id);
      if (changed && rec.cm.costStatus !== 'UNCALCULATED') await this.enqueueDependents(tx, ctx, rec.cm, costingKey, fromDate);
    }
    for (const [id, delta] of externalDeltas) {
      const row = await tx.inventoryCostMovement.findUniqueOrThrow({ where: { id } });
      const value = d(row.totalCost).plus(delta);
      const open = d(row.deficitQuantity);
      await tx.inventoryCostMovement.update({
        where: { id },
        data: { totalCost: value.toString(), unitCost: unitCostOf(value, d(row.quantity)).toString(), postingVersion: { increment: 1 }, calculationRunId: ctx.runId, glValue: row.glTreatment === 'ENGINE' ? undefined : value.toString(), documentGlValue: row.glTreatment === 'ENGINE' ? undefined : value.toString() },
      });
      if (row.glTreatment === 'ENGINE' && !d(row.glValue).eq(value)) glDifferences.push(id);
      await this.enqueueDependents(tx, ctx, row, costingKey, fromDate);
    }

    ctx.movementCount += replay.length;
    return { costingKey, fromDate, replayed: replay.length, glDifferences };
  }

  /** Earliest date the replay must start from: a receipt dated on/after
   * `from` may have settled a negative-stock issue dated before it — that
   * issue's value depends on the replayed range, so it is pulled in. */
  async effectiveStartDate(tx: PrismaTransactionClient, tenantId: string, costingKey: string, requestedFrom: Date): Promise<Date> {
    let from = requestedFrom;
    for (let guard = 0; guard < 20; guard++) {
      const linked = await tx.inventoryCostConsumption.findFirst({
        where: { tenantId, costingKey, isDeficitSettlement: true, sourceIncoming: { effectiveDate: { gte: from } }, outgoingCostMovement: { effectiveDate: { lt: from } } },
        include: { outgoingCostMovement: { select: { effectiveDate: true } } },
        orderBy: { outgoingCostMovement: { effectiveDate: 'asc' } },
      });
      if (!linked) return from;
      from = linked.outgoingCostMovement.effectiveDate;
    }
    return from;
  }

  private async loadOpeningState(tx: PrismaTransactionClient, tenantId: string, costingKey: string, fromDate: Date, method: CostingMethod): Promise<CostingState> {
    const pool = await tx.inventoryCostMovement.aggregate({ where: { tenantId, costingKey, effectiveDate: { lt: fromDate } }, _sum: { quantity: true, totalCost: true } });
    const poolQty = d(pool._sum.quantity);
    const poolValue = d(pool._sum.totalCost);
    const provisionalIncoming = await tx.inventoryCostMovement.count({ where: { tenantId, costingKey, effectiveDate: { lt: fromDate }, movementClass: { startsWith: 'INCOMING' }, costStatus: { not: 'FINAL' } } });

    const last = await tx.inventoryCostMovement.findFirst({ where: { tenantId, costingKey, effectiveDate: { lt: fromDate }, unitCost: { gt: 0 } }, orderBy: [{ effectiveDate: 'desc' }, { movementSequence: 'desc' }] });

    const layerRows = await tx.inventoryCostLayer.findMany({
      where: { tenantId, costingKey, receiptDate: { lt: fromDate } },
      include: { sourceCostMovement: { select: { costStatus: true } } },
      orderBy: [{ receiptDate: 'asc' }, { movementSequence: 'asc' }],
    });
    const consumed = layerRows.length
      ? await tx.inventoryCostConsumption.groupBy({ by: ['costLayerId'], where: { costLayerId: { in: layerRows.map((l) => l.id) } }, _sum: { consumedQuantity: true, consumedCost: true } })
      : [];
    const consumedById = new Map(consumed.map((c) => [c.costLayerId!, c]));
    const layers: LayerState[] = layerRows.map((l) => {
      const c = consumedById.get(l.id);
      return {
        persistedId: l.id,
        sourceCostMovementId: l.sourceCostMovementId,
        sourceDocumentLineId: l.sourceDocumentLineId,
        receiptDate: l.receiptDate,
        sequence: l.movementSequence,
        originalQuantity: d(l.originalQuantity),
        remainingQuantity: d(l.originalQuantity).minus(d(c?._sum.consumedQuantity)),
        unitCost: d(l.currentUnitCost),
        totalValue: d(l.currentTotalCost),
        remainingValue: d(l.currentTotalCost).minus(d(c?._sum.consumedCost)),
        provisional: l.sourceCostMovement.costStatus !== 'FINAL',
      };
    });

    const deficitRows = await tx.inventoryCostMovement.findMany({
      where: { tenantId, costingKey, effectiveDate: { lt: fromDate }, deficitQuantity: { gt: 0 } },
      orderBy: [{ effectiveDate: 'asc' }, { movementSequence: 'asc' }],
    });
    const deficits: DeficitState[] = [];
    for (const row of deficitRows) {
      const settled = await tx.inventoryCostConsumption.aggregate({ where: { outgoingCostMovementId: row.id, isDeficitSettlement: true }, _sum: { consumedQuantity: true } });
      const open = d(row.deficitQuantity).minus(d(settled._sum.consumedQuantity));
      if (open.lte(0)) continue;
      const prov = d(row.provisionalUnitCost);
      deficits.push({ costMovementId: row.id, effectiveDate: row.effectiveDate, sequence: row.movementSequence, open, provisionalUnitCost: prov, openProvisionalValue: money(open.mul(prov)) });
    }

    const state: CostingState = { method, layers, poolQty, poolValue, poolProvisional: provisionalIncoming > 0, deficits, lastUnitCost: d(last?.unitCost) };

    // Balancing layer: if persisted layers do not explain the pool (method
    // switched from WEIGHTED_AVERAGE, or migrated history), FIFO continues
    // from one synthetic opening layer carrying the difference.
    const layerQty = layers.reduce((s, l) => s.plus(l.remainingQuantity), new Decimal(0)).minus(deficits.reduce((s, x) => s.plus(x.open), new Decimal(0)));
    const layerValue = layers.reduce((s, l) => s.plus(l.remainingValue), new Decimal(0)).minus(deficits.reduce((s, x) => s.plus(x.openProvisionalValue), new Decimal(0)));
    const diffQty = poolQty.minus(layerQty);
    if (diffQty.gt(0)) {
      const diffValue = poolValue.minus(layerValue);
      layers.unshift({ persistedId: null, sourceCostMovementId: null, sourceDocumentLineId: null, receiptDate: fromDate, sequence: 0n, originalQuantity: diffQty, remainingQuantity: diffQty, unitCost: unitCostOf(diffValue, diffQty), totalValue: diffValue, remainingValue: diffValue, provisional: false });
    }
    return state;
  }

  /** FIFO <-> WEIGHTED_AVERAGE at an effective-dated policy boundary. */
  private convertState(state: CostingState, method: CostingMethod) {
    const openQty = state.deficits.reduce((s, x) => s.plus(x.open), new Decimal(0));
    const openVal = state.deficits.reduce((s, x) => s.plus(x.openProvisionalValue), new Decimal(0));
    if (method === 'WEIGHTED_AVERAGE') {
      state.poolQty = state.layers.reduce((s, l) => s.plus(l.remainingQuantity), new Decimal(0)).minus(openQty);
      state.poolValue = state.layers.reduce((s, l) => s.plus(l.remainingValue), new Decimal(0)).minus(openVal);
    } else {
      const qty = state.poolQty.plus(openQty);
      const value = state.poolValue.plus(openVal);
      state.layers = state.layers.filter((l) => l.persistedId !== null);
      for (const l of state.layers) {
        l.remainingQuantity = new Decimal(0);
        l.remainingValue = new Decimal(0);
      }
      if (qty.gt(0)) state.layers.push({ persistedId: null, sourceCostMovementId: null, sourceDocumentLineId: null, receiptDate: new Date(0), sequence: 0n, originalQuantity: qty, remainingQuantity: qty, unitCost: unitCostOf(value, qty), totalValue: value, remainingValue: value, provisional: state.poolProvisional });
    }
    state.method = method;
  }

  private async incomingValue(tx: PrismaTransactionClient, ctx: RunContext, cm: InventoryCostMovement, state: CostingState, policy: InventoryCostingPolicy, records: Map<string, ReplayRecord>): Promise<{ value: Decimal; status: string; components: ComponentInput[]; errors: ReplayRecord['errors'] }> {
    const qty = d(cm.quantity).abs();
    if (cm.movementClass === 'INCOMING_SOURCED') {
      const sourced = await this.sources.sourcedValue(tx, cm, ctx);
      if (sourced) return { value: money(sourced.value), status: sourced.status, components: sourced.components, errors: sourced.errors };
    }

    if (cm.movementType === 'SALES_RETURN') {
      const rows = await this.sources.salesReturnSource(tx, cm);
      if (rows && rows.length > 0) {
        let q = new Decimal(0);
        let v = new Decimal(0);
        let final = true;
        for (const r of rows) {
          const rec = records.get(r.id);
          q = q.plus(r.quantity.abs());
          v = v.plus(rec ? rec.value.abs() : r.totalCost.abs());
          if ((rec?.status ?? r.costStatus) !== 'FINAL') final = false;
        }
        const unit = unitCostOf(v, q);
        const value = qty.eq(q) ? v : money(qty.mul(v).div(q));
        return { value, status: final ? 'FINAL' : 'PROVISIONAL', components: [{ componentType: 'ORIGINAL_SHIPMENT_COST', sourceDocumentType: 'SHIPMENT', sourceDocumentId: rows[0].id, amount: value, allocatedAmount: value }], errors: unit.isZero() ? [{ errorCode: 'ZERO_COST_STOCK', description: 'Original shipment cost is zero', severity: 'INFO', blocking: false }] : [] };
      }
      const fallback = policy.salesReturnWithoutSourceCost;
      if (fallback === 'REQUIRE_MANUAL_REVIEW') {
        return { value: new Decimal(0), status: 'ERROR', components: [], errors: [{ errorCode: 'SALES_RETURN_REQUIRES_REVIEW', description: 'Sales return without a costed source shipment — manual cost review required by policy', severity: 'BLOCKING', blocking: true }] };
      }
      const unit = fallback === 'LAST_KNOWN_COST' ? state.lastUnitCost : provisionalUnitCostFor(state, 'CURRENT_AVERAGE');
      const value = money(qty.mul(unit));
      return { value, status: 'PROVISIONAL', components: [{ componentType: fallback, sourceDocumentType: cm.sourceDocumentType, sourceDocumentId: cm.sourceDocumentId, amount: value, allocatedAmount: value }], errors: [{ errorCode: 'SALES_RETURN_WITHOUT_SOURCE', description: `Sales return valued by fallback ${fallback} at ${unit.toString()} per unit (no source shipment cost)`, severity: 'WARNING', blocking: false }] };
    }

    if (cm.movementType === 'TRANSFER_IN') {
      const outs = await this.sources.transferOutSource(tx, cm);
      if (outs.length > 0) {
        let q = new Decimal(0);
        let v = new Decimal(0);
        let final = true;
        for (const r of outs) {
          const rec = records.get(r.id);
          q = q.plus(r.quantity.abs());
          v = v.plus(rec ? rec.value.abs() : r.totalCost.abs());
          if ((rec?.status ?? r.costStatus) !== 'FINAL') final = false;
          if ((rec?.status ?? r.costStatus) === 'UNCALCULATED') {
            // Source side not costed yet — make sure it is, then this key is re-run.
            this.enqueue(ctx, r.costingKey, r.effectiveDate);
            this.enqueue(ctx, cm.costingKey, cm.effectiveDate);
          }
        }
        const value = qty.eq(q) ? v : money(qty.mul(v).div(q));
        return { value, status: final ? 'FINAL' : 'PROVISIONAL', components: [{ componentType: 'TRANSFERRED_COST', sourceDocumentType: cm.sourceDocumentType, sourceDocumentId: cm.sourceDocumentId, sourceDocumentLineId: cm.sourceDocumentLineId, amount: value, allocatedAmount: value }], errors: [] };
      }
      return { value: new Decimal(0), status: 'ERROR', components: [], errors: [{ errorCode: 'BROKEN_SOURCE_DOCUMENT_LINK', description: 'Transfer receipt without a costed transfer issue', severity: 'BLOCKING', blocking: true }] };
    }

    // Surplus without costReference / any other unsourced incoming: current cost.
    const unit = provisionalUnitCostFor(state, 'CURRENT_AVERAGE');
    const value = money(qty.mul(unit));
    return {
      value,
      status: 'PROVISIONAL',
      components: [{ componentType: 'CURRENT_COST', sourceDocumentType: cm.sourceDocumentType, sourceDocumentId: cm.sourceDocumentId, sourceDocumentLineId: cm.sourceDocumentLineId, amount: value, allocatedAmount: value }],
      errors: unit.isZero() ? [{ errorCode: 'MISSING_SOURCE_PRICE', description: `${cm.movementType} has no cost reference and no current cost exists — valued at zero`, severity: 'WARNING', blocking: false }] : [],
    };
  }

  /** Periodic weighted average for one month (spec 13-14): (value at the
   * start of the month + this month's incoming values, excluding sales
   * returns which come back at their original cost) / same quantities. */
  private async periodicAverage(tx: PrismaTransactionClient, ctx: RunContext, state: CostingState, replay: InventoryCostMovement[], index: number, month: string, records: Map<string, ReplayRecord>, policy: InventoryCostingPolicy): Promise<Decimal | null> {
    // Opening at month start: state now is after movements before index.
    // Back out incoming already processed this month so the formula uses the
    // month-start pool plus ALL of the month's incoming.
    let qty = state.poolQty;
    let value = state.poolValue;
    for (let j = 0; j < index; j++) {
      const m = replay[j];
      if (isoDate(monthStart(m.effectiveDate)) !== month) continue;
      const rec = records.get(m.id);
      if (!rec) continue;
      qty = qty.minus(d(m.quantity));
      value = value.minus(rec.value);
    }
    for (const m of replay) {
      if (isoDate(monthStart(m.effectiveDate)) !== month) continue;
      if (!m.movementClass.startsWith('INCOMING') || m.movementType === 'SALES_RETURN') continue;
      const rec = records.get(m.id);
      const incoming = rec ? { value: rec.value } : await this.incomingValue(tx, ctx, m, state, policy, records);
      qty = qty.plus(d(m.quantity));
      value = value.plus(incoming.value);
    }
    return qty.gt(0) ? unitCostOf(value, qty) : null;
  }

  private enqueue(ctx: RunContext, costingKey: string, date: Date) {
    const existing = ctx.queue.get(costingKey);
    if (!existing || date.getTime() < existing.getTime()) ctx.queue.set(costingKey, date);
  }

  /** Cross-key dependents of a changed issue (spec 30, 26): the transfer's
   * receiving key and any sales return restoring this shipment's cost. */
  private async enqueueDependents(tx: PrismaTransactionClient, ctx: RunContext, cm: InventoryCostMovement, costingKey: string, fromDate: Date) {
    if (cm.movementType === 'TRANSFER_OUT') {
      // Same-key pairs never become cost movements, so every TRANSFER_IN
      // found here lives in another costing key.
      const ins = await tx.inventoryCostMovement.findMany({ where: { tenantId: cm.tenantId, sourceDocumentType: cm.sourceDocumentType, sourceDocumentId: cm.sourceDocumentId, sourceDocumentLineId: cm.sourceDocumentLineId, movementType: 'TRANSFER_IN' } });
      for (const i of ins) this.enqueue(ctx, i.costingKey, i.effectiveDate);
    } else if (cm.movementType === 'SALES_SHIPMENT' && cm.sourceDocumentLineId) {
      const invoiceLines = await tx.salesInvoiceLine.findMany({ where: { tenantId: cm.tenantId, sourceShipmentLineId: cm.sourceDocumentLineId }, select: { id: true } });
      if (invoiceLines.length === 0) return;
      const returnLines = await tx.salesReturnLine.findMany({ where: { tenantId: cm.tenantId, sourceInvoiceLineId: { in: invoiceLines.map((l) => l.id) } }, select: { id: true } });
      if (returnLines.length === 0) return;
      const rows = await tx.inventoryCostMovement.findMany({ where: { tenantId: cm.tenantId, sourceDocumentType: 'SALES_RETURN', sourceDocumentLineId: { in: returnLines.map((l) => l.id) } } });
      for (const r of rows) if (r.costingKey !== costingKey || r.effectiveDate.getTime() < fromDate.getTime()) this.enqueue(ctx, r.costingKey, r.effectiveDate);
    }
  }

  private baseValue(rec: ReplayRecord): Decimal {
    const base = rec.components.filter((c) => c.componentType === 'BASE_PRICE' || c.componentType === 'OPENING_BALANCE' || c.componentType === 'SURPLUS_VALUE');
    return base.length > 0 ? base.reduce((s, c) => s.plus(c.allocatedAmount), new Decimal(0)) : rec.value;
  }

  private baseUnitCost(rec: ReplayRecord, qty: Decimal): Decimal {
    return unitCostOf(this.baseValue(rec), qty);
  }

  private layerStatus(layer: LayerState, rec: ReplayRecord): string {
    if (layer.remainingQuantity.lte(0)) return 'CLOSED';
    const adjusted = rec.components.some((c) => c.componentType !== 'BASE_PRICE' && c.componentType !== 'OPENING_BALANCE' && c.componentType !== 'SURPLUS_VALUE');
    if (layer.remainingQuantity.lt(layer.originalQuantity)) return 'PARTIALLY_CONSUMED';
    return adjusted ? 'ADJUSTED' : 'OPEN';
  }
}
