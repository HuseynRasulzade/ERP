import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

const EPSILON = new Decimal('0.005');

export interface ScheduleLineInput {
  sequence: number;
  dueDate: Date;
  amount: Decimal.Value; // transaction currency
}

export interface CreateExposureParams {
  organizationId: string;
  counterpartyId: string;
  contractId?: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber?: string | null;
  sourceDate: Date;
  currencyId: string;
  grossAmount: Decimal.Value; // transaction currency, always positive
  baseAmount: Decimal.Value; // base currency, always positive
  exchangeRate?: Decimal.Value | null;
  defaultDueDate: Date;
  scheduleLines?: ScheduleLineInput[];
  createdBy?: string;
}

export interface ReduceExposureParams {
  organizationId: string;
  counterpartyId: string;
  sourceDocumentType: string; // the ORIGINAL invoice's document type
  sourceDocumentId: string; // the ORIGINAL invoice's id
  reasonDocumentType: string; // e.g. SALES_RETURN
  reasonDocumentId: string;
  effectiveDate: Date;
  amount: Decimal.Value; // transaction currency, always positive
  baseAmount: Decimal.Value; // base currency, always positive
  currencyId: string;
  createdBy?: string;
}

/**
 * SettlementMovementService — the single write path into the immutable
 * `SettlementMovement` register and the `SettlementOpenItem` projection
 * it drives (spec sections 4-7). Every other settlement service
 * (allocation, offset, debt adjustment, ageing) reads open items this
 * service produced; none of them writes a movement directly.
 *
 * `SettlementOpenItem.remainingAmount` is a REBUILDABLE projection, never
 * treated as authoritative on its own — every mutation here also writes
 * the `SettlementMovement` row that justifies it, so the balance can
 * always be recomputed from the register alone (spec section 92's
 * `getSettlementBalance(asOfDate, ...)` uses exactly this movement table).
 */
@Injectable()
export class SettlementMovementService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sales Invoice / Purchase Invoice post (spec sections 12-15) — one
   * open item for the whole gross amount, or one per `scheduleLines`
   * entry when the source order carried a payment schedule. */
  async createReceivable(tenantId: string, params: CreateExposureParams, tx: PrismaTransactionClient) {
    return this.createExposure(tenantId, 'RECEIVABLE', 'CUSTOMER', 'RECEIVABLE_CREATE', params, tx);
  }

  async createPayable(tenantId: string, params: CreateExposureParams, tx: PrismaTransactionClient) {
    return this.createExposure(tenantId, 'PAYABLE', 'SUPPLIER', 'PAYABLE_CREATE', params, tx);
  }

  private async createExposure(
    tenantId: string,
    itemType: 'RECEIVABLE' | 'PAYABLE',
    role: 'CUSTOMER' | 'SUPPLIER',
    movementType: string,
    params: CreateExposureParams,
    tx: PrismaTransactionClient,
  ) {
    const gross = new Decimal(params.grossAmount);
    const baseGross = new Decimal(params.baseAmount);
    const lines = params.scheduleLines && params.scheduleLines.length > 0 ? params.scheduleLines : [{ sequence: 0, dueDate: params.defaultDueDate, amount: gross }];
    const scheduleTotal = lines.reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    // Proportional base-amount split per line (spec section 15) — scaled to
    // this invoice's own gross total, not the source order's, so a partial
    // invoice against a scheduled order still reconciles internally.
    const ratio = scheduleTotal.gt(0) ? gross.div(scheduleTotal) : new Decimal(1);

    const created = [];
    for (const line of lines.length > 1 ? lines : [{ sequence: 0, dueDate: params.defaultDueDate, amount: gross }]) {
      const lineAmount = new Decimal(line.amount.toString()).times(ratio).toDecimalPlaces(2);
      const lineBaseAmount = gross.gt(0) ? baseGross.times(lineAmount).div(gross).toDecimalPlaces(2) : new Decimal(0);

      const openItem = await tx.settlementOpenItem.create({
        data: {
          tenantId,
          organizationId: params.organizationId,
          counterpartyId: params.counterpartyId,
          counterpartyRole: role,
          itemType,
          contractId: params.contractId ?? undefined,
          sourceDocumentType: params.sourceDocumentType,
          sourceDocumentId: params.sourceDocumentId,
          sourceDocumentNumber: params.sourceDocumentNumber ?? undefined,
          scheduleLineSequence: lines.length > 1 ? line.sequence : null,
          sourceDate: params.sourceDate,
          dueDate: line.dueDate,
          currencyId: params.currencyId,
          originalAmount: lineAmount.toString(),
          originalBaseAmount: lineBaseAmount.toString(),
          remainingAmount: lineAmount.toString(),
          remainingBaseAmount: lineBaseAmount.toString(),
        },
      });

      await tx.settlementMovement.create({
        data: {
          tenantId,
          organizationId: params.organizationId,
          counterpartyId: params.counterpartyId,
          counterpartyRole: role,
          contractId: params.contractId ?? undefined,
          openItemId: openItem.id,
          currencyId: params.currencyId,
          dueDate: line.dueDate,
          movementType,
          amount: lineAmount.toString(),
          baseAmount: lineBaseAmount.toString(),
          exchangeRate: params.exchangeRate ? new Decimal(params.exchangeRate).toString() : undefined,
          sourceDocumentType: params.sourceDocumentType,
          sourceDocumentId: params.sourceDocumentId,
          effectiveDate: params.sourceDate,
          postingDate: params.sourceDate,
          createdBy: params.createdBy,
        },
      });
      created.push(openItem);
    }
    return created;
  }

  /** Sales Return / Purchase Return (spec sections 34-37) — reduces the
   * remaining balance of the source invoice's own open item(s), oldest
   * schedule line first. Allowed to go negative on the LAST item touched
   * when the return exceeds what remains (spec section 35: "Customer
   * balance: -200 / customer credit" — never blocked, never hidden). */
  async reduceReceivable(tenantId: string, params: ReduceExposureParams, tx: PrismaTransactionClient) {
    return this.reduceExposure(tenantId, 'RECEIVABLE', 'CUSTOMER', 'RECEIVABLE_REDUCE', params, tx);
  }

  async reducePayable(tenantId: string, params: ReduceExposureParams, tx: PrismaTransactionClient) {
    return this.reduceExposure(tenantId, 'PAYABLE', 'SUPPLIER', 'PAYABLE_REDUCE', params, tx);
  }

  private async reduceExposure(
    tenantId: string,
    itemType: 'RECEIVABLE' | 'PAYABLE',
    role: 'CUSTOMER' | 'SUPPLIER',
    movementType: string,
    params: ReduceExposureParams,
    tx: PrismaTransactionClient,
  ) {
    const items = await tx.settlementOpenItem.findMany({
      where: { tenantId, organizationId: params.organizationId, sourceDocumentType: params.sourceDocumentType, sourceDocumentId: params.sourceDocumentId, itemType },
      orderBy: [{ scheduleLineSequence: 'asc' }, { createdAt: 'asc' }],
    });

    let remainingToApply = new Decimal(params.amount);
    let remainingBaseToApply = new Decimal(params.baseAmount);
    const touched: { openItemId: string; amount: Decimal }[] = [];

    if (items.length === 0) {
      remainingToApply = new Decimal(0);
    }

    for (const [i, item] of items.entries()) {
      if (remainingToApply.lte(0)) break;
      const isLast = i === items.length - 1;
      const itemRemaining = new Decimal(item.remainingAmount.toString());
      // Every item but the last only absorbs up to its own remaining
      // balance; the LAST item absorbs whatever is left (may go negative —
      // the customer/supplier credit position spec section 35 describes).
      const applied = isLast ? remainingToApply : Decimal.min(remainingToApply, itemRemaining.gt(0) ? itemRemaining : new Decimal(0));
      const appliedBase = remainingToApply.gt(0) ? remainingBaseToApply.times(applied).div(remainingToApply).toDecimalPlaces(2) : new Decimal(0);

      await this.applyDelta(tenantId, item.id, applied.negated(), appliedBase.negated(), tx);
      await tx.settlementMovement.create({
        data: {
          tenantId,
          organizationId: params.organizationId,
          counterpartyId: params.counterpartyId,
          counterpartyRole: role,
          openItemId: item.id,
          currencyId: params.currencyId,
          movementType,
          amount: applied.negated().toString(),
          baseAmount: appliedBase.negated().toString(),
          sourceDocumentType: params.reasonDocumentType,
          sourceDocumentId: params.reasonDocumentId,
          effectiveDate: params.effectiveDate,
          postingDate: params.effectiveDate,
          createdBy: params.createdBy,
        },
      });

      touched.push({ openItemId: item.id, amount: applied });
      remainingToApply = remainingToApply.minus(applied);
      remainingBaseToApply = remainingBaseToApply.minus(appliedBase);
    }

    return touched;
  }

  /** Customer/Supplier advance creation (spec sections 23-24) — an
   * open item with no due date and `itemType` CUSTOMER_ADVANCE/
   * SUPPLIER_ADVANCE, kept structurally separate from RECEIVABLE/PAYABLE
   * (spec section 27, 50, 72 — never the same bucket). */
  async createAdvance(
    tenantId: string,
    params: {
      organizationId: string;
      counterpartyId: string;
      role: 'CUSTOMER' | 'SUPPLIER';
      sourceDocumentType: string;
      sourceDocumentId: string;
      effectiveDate: Date;
      currencyId: string;
      amount: Decimal.Value;
      baseAmount: Decimal.Value;
      createdBy?: string;
    },
    tx: PrismaTransactionClient,
  ) {
    const itemType = params.role === 'CUSTOMER' ? 'CUSTOMER_ADVANCE' : 'SUPPLIER_ADVANCE';
    const movementType = params.role === 'CUSTOMER' ? 'CUSTOMER_ADVANCE_CREATE' : 'SUPPLIER_ADVANCE_CREATE';
    const amount = new Decimal(params.amount);
    const baseAmount = new Decimal(params.baseAmount);

    const openItem = await tx.settlementOpenItem.create({
      data: {
        tenantId,
        organizationId: params.organizationId,
        counterpartyId: params.counterpartyId,
        counterpartyRole: params.role,
        itemType,
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        sourceDate: params.effectiveDate,
        currencyId: params.currencyId,
        originalAmount: amount.toString(),
        originalBaseAmount: baseAmount.toString(),
        remainingAmount: amount.toString(),
        remainingBaseAmount: baseAmount.toString(),
      },
    });

    await tx.settlementMovement.create({
      data: {
        tenantId,
        organizationId: params.organizationId,
        counterpartyId: params.counterpartyId,
        counterpartyRole: params.role,
        openItemId: openItem.id,
        currencyId: params.currencyId,
        movementType,
        amount: amount.toString(),
        baseAmount: baseAmount.toString(),
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        effectiveDate: params.effectiveDate,
        postingDate: params.effectiveDate,
        createdBy: params.createdBy,
      },
    });

    return openItem;
  }

  /** Applies a signed delta to an open item's running totals and
   * recomputes `status` — the one place every allocation/reduction/
   * offset/write-off/adjustment funnels through so the projection never
   * drifts from what the movements say. */
  async applyDelta(tenantId: string, openItemId: string, deltaAmount: Decimal, deltaBaseAmount: Decimal, tx: PrismaTransactionClient) {
    // Concurrency safety (spec sections 137-138): serializes every
    // mutation of this exact open item within the surrounding transaction
    // — two parallel allocations against the same invoice can never both
    // read the same "remaining" figure and over-settle it (mirrors
    // InventoryMovementService.lockStockKey's own advisory-lock pattern).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${openItemId}`}))`;
    const item = await tx.settlementOpenItem.findFirstOrThrow({ where: { id: openItemId, tenantId } });
    const newRemaining = new Decimal(item.remainingAmount.toString()).plus(deltaAmount);
    const newRemainingBase = new Decimal(item.remainingBaseAmount.toString()).plus(deltaBaseAmount);
    const newAllocated = new Decimal(item.allocatedAmount.toString()).minus(deltaAmount);
    const newAllocatedBase = new Decimal(item.allocatedBaseAmount.toString()).minus(deltaBaseAmount);

    let status = item.status;
    if (!['DISPUTED', 'ON_HOLD', 'WRITTEN_OFF', 'CANCELLED'].includes(item.status)) {
      status = newRemaining.abs().lte(EPSILON) ? 'SETTLED' : newRemaining.lt(new Decimal(item.originalAmount.toString())) || newRemaining.isNegative() ? 'PARTIALLY_SETTLED' : 'OPEN';
    }

    return tx.settlementOpenItem.update({
      where: { id: openItemId },
      data: { remainingAmount: newRemaining.toString(), remainingBaseAmount: newRemainingBase.toString(), allocatedAmount: newAllocated.toString(), allocatedBaseAmount: newAllocatedBase.toString(), status },
    });
  }

  /** Undo for a source document's own creation (unpost/reversal, spec
   * section 90) — deletes the movements/open items IT created. Callers
   * must have already verified no allocation exists against them (spec
   * section 89). */
  async removeExposureFor(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const items = await tx.settlementOpenItem.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
    for (const item of items) {
      await tx.settlementMovement.deleteMany({ where: { tenantId, openItemId: item.id } });
    }
    await tx.settlementOpenItem.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
  }

  /** Symmetric undo for a document that only ADJUSTED an open item it
   * doesn't own (Sales/Purchase Return reducing the original invoice's
   * item — spec sections 34-37) — unlike `removeExposureFor`, this never
   * deletes the open item itself, only reverses the exact delta this
   * source document applied to it. */
  async reverseMovementsFor(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<void> {
    const movements = await tx.settlementMovement.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId, openItemId: { not: null } } });
    const byOpenItem = new Map<string, { amount: Decimal; baseAmount: Decimal }>();
    for (const m of movements) {
      const entry = byOpenItem.get(m.openItemId!) ?? { amount: new Decimal(0), baseAmount: new Decimal(0) };
      entry.amount = entry.amount.plus(m.amount.toString());
      entry.baseAmount = entry.baseAmount.plus(m.baseAmount.toString());
      byOpenItem.set(m.openItemId!, entry);
    }
    for (const [openItemId, delta] of byOpenItem) {
      await this.applyDelta(tenantId, openItemId, delta.amount.negated(), delta.baseAmount.negated(), tx);
    }
    await tx.settlementMovement.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
  }

  async hasActiveAllocations(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient): Promise<boolean> {
    const items = await tx.settlementOpenItem.findMany({ where: { tenantId, sourceDocumentType, sourceDocumentId }, select: { id: true } });
    if (items.length === 0) return false;
    const count = await tx.settlementAllocation.count({ where: { tenantId, targetOpenItemId: { in: items.map((i) => i.id) }, status: 'ACTIVE' } });
    return count > 0;
  }
}
