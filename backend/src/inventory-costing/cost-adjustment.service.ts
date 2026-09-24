import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InventoryCostMovement } from '@prisma/client';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine, AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { PeriodService } from '../period/period.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { INVENTORY_COST_ADJUSTMENT_TYPE, d, toDateOnly } from './costing.types';
import { RunContext } from './inventory-cost-engine.service';

const SEQUENCE_PREFIX = 'ICA';

export interface GlBookResult {
  adjustmentIds: string[];
  journalEntryIds: string[];
  totalDebit: Decimal;
  totalCredit: Decimal;
}

function impactTypeFor(mappingKey: string | null): string {
  if (mappingKey === MappingKeys.COGS) return 'COGS';
  if (mappingKey === MappingKeys.OTHER_OPERATING_INCOME) return 'INCOME';
  if (mappingKey === MappingKeys.OTHER_OPERATING_EXPENSE) return 'VARIANCE';
  return 'EXPENSE';
}

/**
 * Accounting consequence of costing (spec sections 24, 44-45, 61-62, 112).
 * Every account is resolved through the Accounting Core mapping engine
 * (GOODS_INVENTORY vs COGS / expense / variance keys) — never a literal
 * code — and every batch goes through AccountingPostingEngine, so the
 * engine's own balance check (Debit = Credit), dimension-requirement check
 * (spec 113: e.g. 701 requires PRODUCT + WAREHOUSE) and closed-period
 * guard apply unchanged.
 */
@Injectable()
export class InventoryCostAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly posting: AccountingPostingEngine,
    private readonly periods: PeriodService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /** Inventory-side + counter-side GL lines for a signed inventory value
   * change of one cost movement: + = inventory increases. */
  async glLinesFor(tx: PrismaTransactionClient, cm: InventoryCostMovement, signedAmount: Decimal, businessDate: Date, description: string, includeCounter = true): Promise<AccountingPostingLineInput[]> {
    if (signedAmount.isZero()) return [];
    const inventory = await this.mappings.resolve(cm.tenantId, cm.organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    const dims = [
      { dimensionCode: 'PRODUCT', referenceId: cm.productId },
      { dimensionCode: 'WAREHOUSE', referenceId: cm.physicalWarehouseId },
    ];
    const amount = signedAmount.abs();
    const inventorySide = signedAmount.gt(0) ? 'DEBIT' : 'CREDIT';
    const lines: AccountingPostingLineInput[] = [{ accountId: inventory.id, side: inventorySide, amountBase: amount, description, dimensions: dims, sourceDocumentLineId: cm.sourceDocumentLineId ?? undefined }];
    if (includeCounter) {
      const counterId = cm.counterAccountId ?? (await this.mappings.resolve(cm.tenantId, cm.organizationId, cm.counterMappingKey ?? MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx)).id;
      lines.push({ accountId: counterId, side: inventorySide === 'DEBIT' ? 'CREDIT' : 'DEBIT', amountBase: amount, description, dimensions: dims, sourceDocumentLineId: cm.sourceDocumentLineId ?? undefined });
    }
    return lines;
  }

  /**
   * Books every "calculated value != value already in the GL" difference
   * as system InventoryCostAdjustment documents (spec 61): one document +
   * one journal entry per business date, only the DELTA (spec 141 —
   * "generates only delta accounting entries"), so re-running a
   * recalculation with no source change books nothing (spec 131).
   * The adjustment is dated on the adjusted movement's own date when that
   * accounting period is open, else on today (current-period adjustment
   * policy for closed periods, spec 111).
   */
  async bookDifferences(tx: PrismaTransactionClient, ctx: RunContext, costMovementIds: string[], reason: string, source?: { type: string; id: string }): Promise<GlBookResult> {
    const result: GlBookResult = { adjustmentIds: [], journalEntryIds: [], totalDebit: new Decimal(0), totalCredit: new Decimal(0) };
    if (costMovementIds.length === 0) return result;
    const rows = await tx.inventoryCostMovement.findMany({ where: { id: { in: [...new Set(costMovementIds)] } }, orderBy: [{ effectiveDate: 'asc' }, { movementSequence: 'asc' }] });
    const today = toDateOnly(new Date());

    const groups = new Map<string, { date: Date; items: { cm: InventoryCostMovement; delta: Decimal }[] }>();
    for (const cm of rows) {
      const delta = d(cm.totalCost).minus(d(cm.glValue));
      if (delta.isZero()) continue;
      let date = cm.effectiveDate;
      try {
        await this.periods.assertDateIsOpen(ctx.tenantId, date, cm.organizationId);
      } catch {
        date = today;
      }
      const key = date.toISOString();
      if (!groups.has(key)) groups.set(key, { date, items: [] });
      groups.get(key)!.items.push({ cm, delta });
    }

    for (const group of groups.values()) {
      const booked = await this.postAdjustmentDocument(tx, ctx, group.date, reason, group.items.map((i) => ({ cm: i.cm, delta: i.delta, oldValue: d(i.cm.glValue), newValue: d(i.cm.totalCost) })), source);
      result.adjustmentIds.push(booked.adjustmentId);
      if (booked.journalEntryId) result.journalEntryIds.push(booked.journalEntryId);
      result.totalDebit = result.totalDebit.plus(booked.total);
      result.totalCredit = result.totalCredit.plus(booked.total);
      for (const i of group.items) {
        await tx.inventoryCostMovement.update({ where: { id: i.cm.id }, data: { glValue: i.cm.totalCost } });
      }
    }
    return result;
  }

  /** Unposting an ENGINE-valued movement: its own document's journal entry
   * is removed by the posting framework, so every adjustment booked on
   * top of it since must be reversed too (spec 109 — accounting reversal). */
  async reverseAccumulatedAdjustments(tx: PrismaTransactionClient, ctx: RunContext, rows: InventoryCostMovement[], source: { type: string; id: string }): Promise<GlBookResult> {
    const result: GlBookResult = { adjustmentIds: [], journalEntryIds: [], totalDebit: new Decimal(0), totalCredit: new Decimal(0) };
    const items = rows
      .filter((r) => r.glTreatment === 'ENGINE')
      .map((cm) => ({ cm, delta: d(cm.documentGlValue).minus(d(cm.glValue)), oldValue: d(cm.glValue), newValue: d(cm.documentGlValue) }))
      .filter((i) => !i.delta.isZero());
    if (items.length === 0) return result;
    let date = toDateOnly(new Date());
    const first = items[0].cm.effectiveDate;
    try {
      await this.periods.assertDateIsOpen(ctx.tenantId, first, ctx.organizationId);
      date = first;
    } catch {
      /* current-period reversal */
    }
    const booked = await this.postAdjustmentDocument(tx, ctx, date, 'UNPOST_REVERSAL', items, source);
    result.adjustmentIds.push(booked.adjustmentId);
    if (booked.journalEntryId) result.journalEntryIds.push(booked.journalEntryId);
    result.totalDebit = booked.total;
    result.totalCredit = booked.total;
    return result;
  }

  private async postAdjustmentDocument(
    tx: PrismaTransactionClient,
    ctx: RunContext,
    date: Date,
    reason: string,
    items: { cm: InventoryCostMovement; delta: Decimal; oldValue: Decimal; newValue: Decimal }[],
    source?: { type: string; id: string },
  ): Promise<{ adjustmentId: string; journalEntryId: string | null; total: Decimal }> {
    await this.ensureSequence(ctx.tenantId);
    const number = await this.numbering.allocateNumber(ctx.tenantId, INVENTORY_COST_ADJUSTMENT_TYPE, date, tx);
    let inventoryImpact = new Decimal(0);
    let cogsImpact = new Decimal(0);
    let expenseImpact = new Decimal(0);
    for (const i of items) {
      inventoryImpact = inventoryImpact.plus(i.delta);
      if (i.cm.counterMappingKey === MappingKeys.COGS) cogsImpact = cogsImpact.minus(i.delta);
      else expenseImpact = expenseImpact.minus(i.delta);
    }

    const adjustment = await tx.inventoryCostAdjustment.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        number: number.formatted,
        documentDate: date,
        postingDate: date,
        reason,
        sourceDocumentType: source?.type,
        sourceDocumentId: source?.id,
        calculationRunId: ctx.runId,
        status: 'POSTED',
        isSystemGenerated: true,
        inventoryImpact: inventoryImpact.toString(),
        cogsImpact: cogsImpact.toString(),
        expenseImpact: expenseImpact.toString(),
        createdBy: ctx.userId,
        postedAt: new Date(),
        postedBy: ctx.userId,
        lines: {
          create: items.map((i, idx) => ({
            tenantId: ctx.tenantId,
            position: idx,
            productId: i.cm.productId,
            warehouseId: i.cm.physicalWarehouseId,
            costingKey: i.cm.costingKey,
            costMovementId: i.cm.id,
            quantityReference: d(i.cm.quantity).abs().toString(),
            oldCost: i.oldValue.abs().toString(),
            adjustmentAmount: i.delta.toString(),
            newCost: i.newValue.abs().toString(),
            impactType: impactTypeFor(i.cm.counterMappingKey),
            counterMappingKey: i.cm.counterMappingKey,
          })),
        },
      },
    });

    const lines: AccountingPostingLineInput[] = [];
    for (const i of items) {
      lines.push(...(await this.glLinesFor(tx, i.cm, i.delta, date, `Inventory cost adjustment ${adjustment.number} — ${i.cm.movementType} ${i.cm.sourceDocumentType}`)));
    }
    const total = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s.plus(d(l.amountBase as any)), new Decimal(0));
    let journalEntryId: string | null = null;
    if (lines.length > 0) {
      const entry = await this.posting.postBatch(
        ctx.tenantId,
        ctx.userId,
        { organizationId: ctx.organizationId, businessDate: date, postingDate: date, description: `Inventory cost adjustment ${adjustment.number} (${reason})`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: INVENTORY_COST_ADJUSTMENT_TYPE, sourceDocumentId: adjustment.id, lines },
        tx,
      );
      journalEntryId = (entry as any)?.id ?? null;
      await tx.inventoryCostAdjustment.update({ where: { id: adjustment.id }, data: { journalEntryId } });
    }

    await this.audit.record(
      {
        tenantId: ctx.tenantId,
        eventType: reason === 'UNPOST_REVERSAL' ? 'INVENTORY_COST_ADJUSTMENT_REVERSED' : 'INVENTORY_COGS_CHANGED',
        entityType: INVENTORY_COST_ADJUSTMENT_TYPE,
        entityId: adjustment.id,
        action: 'POST',
        userId: ctx.userId,
        newValues: { number: adjustment.number, reason, calculationRunId: ctx.runId, lines: items.map((i) => ({ costMovementId: i.cm.id, old: i.oldValue.toString(), new: i.newValue.toString(), delta: i.delta.toString() })) },
      },
      tx,
    );
    return { adjustmentId: adjustment.id, journalEntryId, total };
  }

  async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: INVENTORY_COST_ADJUSTMENT_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: INVENTORY_COST_ADJUSTMENT_TYPE, documentType: INVENTORY_COST_ADJUSTMENT_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // lost the race — the sequence exists now
    }
  }
}
