import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CurrencyService } from '../currency/currency.service';
import { SettlementMovementService } from './settlement-movement.service';
import { AllocationAmountExceedsError, AllocationCrossCurrencyBlockedError, NotFoundAppError, SettlementCounterpartyMismatchError, ValidationAppError } from '../common/errors/app-error';

const EPSILON = new Decimal('0.005');

export interface AllocationLine {
  targetOpenItemId: string;
  amount: Decimal.Value; // payment currency
}

export interface AllocateParams {
  organizationId: string;
  counterpartyId: string;
  role: 'CUSTOMER' | 'SUPPLIER';
  paymentDocumentType: string;
  paymentDocumentId: string;
  paymentLineId?: string | null;
  contractId?: string | null;
  paymentCurrencyId: string;
  paymentDate: Date;
  allocationType: string;
  lines: AllocationLine[];
  sourceOpenItemId?: string | null;
  createdBy?: string;
}

/**
 * PaymentAllocationService — manual + automatic allocation (spec sections
 * 16-33), and the realized-FX calculation the spec assigns to a separate
 * `SettlementFXService` (folded in here rather than a near-empty extra
 * file — every FX-bearing code path IS an allocation).
 *
 * Realized FX (spec sections 54-56): the open item's own historical unit
 * base rate (`originalBaseAmount / originalAmount`, frozen at creation)
 * decides how much of its `remainingBaseAmount` this allocation clears —
 * never the payment's current rate. The difference between what the
 * payment is actually worth in base currency and what was cleared at the
 * historical rate IS the realized FX gain/loss, recorded on the
 * allocation row for reporting/traceability. Posting an actual GL entry
 * for it is a disclosed gap (see docs/SETTLEMENT.md) — the existing
 * payment posting handlers this hooks into have no FX-aware accounting
 * path today (spec section 61's own rate resolution and section 103's GL
 * integration are future work, not silently fabricated here).
 *
 * Cross-currency settlement (invoice USD, payment EUR) is blocked by
 * default (spec section 60's own policy option, and literally spec
 * section 148's own suggested error message) — no conversion path is
 * built.
 */
@Injectable()
export class PaymentAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly currency: CurrencyService,
    private readonly movements: SettlementMovementService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, filter: { paymentDocumentId?: string; targetOpenItemId?: string } = {}) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.settlementAllocation.findMany({
      where: { tenantId, organizationId, ...(filter.paymentDocumentId ? { paymentDocumentId: filter.paymentDocumentId } : {}), ...(filter.targetOpenItemId ? { targetOpenItemId: filter.targetOpenItemId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUnallocatedForPayment(tenantId: string, paymentDocumentType: string, paymentDocumentId: string, paymentTotalAmount: Decimal.Value): Promise<Decimal> {
    const rows = await this.prisma.settlementAllocation.findMany({ where: { tenantId, paymentDocumentType, paymentDocumentId, status: 'ACTIVE' } });
    const allocated = rows.reduce((s, r) => s.plus(r.paymentAmount.toString()), new Decimal(0));
    return new Decimal(paymentTotalAmount).minus(allocated);
  }

  /** Manual or system-driven allocation (spec sections 16, 31) — runs
   * inside the caller's own transaction so a payment's own posting
   * (CashTransaction/PaymentOrder) and its allocations commit atomically. */
  async allocate(tenantId: string, params: AllocateParams, tx: PrismaTransactionClient) {
    const created = [];
    for (const line of params.lines) {
      const amount = new Decimal(line.amount);
      if (amount.lte(0)) throw new ValidationAppError('Allocation amount must be positive');

      // Concurrency safety (spec sections 137-138): lock THIS open item
      // before reading its remaining balance, not after — otherwise two
      // concurrent allocations could both read the same pre-lock
      // "remaining" figure, both pass the exceeds-remaining check below,
      // and over-settle the item once each applies its own delta.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${line.targetOpenItemId}`}))`;

      const openItem = await tx.settlementOpenItem.findFirst({ where: { id: line.targetOpenItemId, tenantId, organizationId: params.organizationId } });
      if (!openItem) throw new NotFoundAppError('SettlementOpenItem', line.targetOpenItemId);
      if (openItem.counterpartyId !== params.counterpartyId) throw new SettlementCounterpartyMismatchError();
      if (openItem.currencyId && openItem.currencyId !== params.paymentCurrencyId) {
        throw new AllocationCrossCurrencyBlockedError();
      }

      const remaining = new Decimal(openItem.remainingAmount.toString());
      if (amount.gt(remaining.plus(EPSILON))) {
        throw new AllocationAmountExceedsError(openItem.sourceDocumentNumber ?? openItem.sourceDocumentId, remaining.toFixed(2), amount.toFixed(2));
      }

      const historicalUnitBase = new Decimal(openItem.originalAmount.toString()).gt(0) ? new Decimal(openItem.originalBaseAmount.toString()).div(openItem.originalAmount.toString()) : new Decimal(1);
      const openItemBaseReduction = historicalUnitBase.times(amount).toDecimalPlaces(2);

      let currentRate = historicalUnitBase;
      let realizedFx = new Decimal(0);
      const org = await tx.organization.findUnique({ where: { id: params.organizationId } });
      const baseCurrencyId = org?.baseCurrencyId ?? (await tx.tenant.findUnique({ where: { id: tenantId } }))?.baseCurrencyId ?? null;
      if (baseCurrencyId && openItem.currencyId && openItem.currencyId !== baseCurrencyId) {
        const currencyRow = await tx.currency.findUnique({ where: { id: openItem.currencyId } });
        const baseCurrencyRow = await tx.currency.findUnique({ where: { id: baseCurrencyId } });
        if (currencyRow && baseCurrencyRow) {
          try {
            const resolved = await this.currency.resolveRate({ tenantId, currencyCode: currencyRow.code, baseCurrencyCode: baseCurrencyRow.code, businessDate: params.paymentDate });
            currentRate = new Decimal(resolved.rate.toString());
          } catch {
            currentRate = historicalUnitBase; // no rate on file — no fabricated FX, treat as unchanged
          }
        }
        const paymentBaseValue = currentRate.times(amount).toDecimalPlaces(2);
        realizedFx = paymentBaseValue.minus(openItemBaseReduction);
      }

      await this.movements.applyDelta(tenantId, openItem.id, amount.negated(), openItemBaseReduction.negated(), tx);
      const movementType = openItem.itemType === 'PAYABLE' ? 'PAYABLE_REDUCE' : openItem.itemType === 'RECEIVABLE' ? 'RECEIVABLE_REDUCE' : openItem.itemType === 'CUSTOMER_ADVANCE' ? 'CUSTOMER_ADVANCE_APPLY' : 'SUPPLIER_ADVANCE_APPLY';
      await tx.settlementMovement.create({
        data: {
          tenantId,
          organizationId: params.organizationId,
          counterpartyId: params.counterpartyId,
          counterpartyRole: params.role,
          contractId: params.contractId ?? undefined,
          openItemId: openItem.id,
          currencyId: params.paymentCurrencyId,
          movementType,
          amount: amount.negated().toString(),
          baseAmount: openItemBaseReduction.negated().toString(),
          exchangeRate: currentRate.toString(),
          sourceDocumentType: params.paymentDocumentType,
          sourceDocumentId: params.paymentDocumentId,
          effectiveDate: params.paymentDate,
          postingDate: params.paymentDate,
          createdBy: params.createdBy,
        },
      });

      if (realizedFx.abs().gt(EPSILON)) {
        await tx.settlementMovement.create({
          data: {
            tenantId,
            organizationId: params.organizationId,
            counterpartyId: params.counterpartyId,
            counterpartyRole: params.role,
            openItemId: openItem.id,
            currencyId: params.paymentCurrencyId,
            movementType: 'FX_ADJUSTMENT',
            amount: '0',
            baseAmount: realizedFx.toString(),
            exchangeRate: currentRate.toString(),
            sourceDocumentType: params.paymentDocumentType,
            sourceDocumentId: params.paymentDocumentId,
            effectiveDate: params.paymentDate,
            postingDate: params.paymentDate,
            createdBy: params.createdBy,
          },
        });
      }

      if (params.sourceOpenItemId) {
        const sourceItem = await tx.settlementOpenItem.findFirst({ where: { id: params.sourceOpenItemId, tenantId } });
        if (sourceItem) {
          await this.movements.applyDelta(tenantId, sourceItem.id, amount.negated(), openItemBaseReduction.negated(), tx);
          await tx.settlementMovement.create({
            data: {
              tenantId,
              organizationId: params.organizationId,
              counterpartyId: params.counterpartyId,
              counterpartyRole: params.role,
              openItemId: sourceItem.id,
              currencyId: params.paymentCurrencyId,
              movementType: sourceItem.itemType === 'CUSTOMER_ADVANCE' ? 'CUSTOMER_ADVANCE_APPLY' : 'SUPPLIER_ADVANCE_APPLY',
              amount: amount.negated().toString(),
              baseAmount: openItemBaseReduction.negated().toString(),
              sourceDocumentType: params.paymentDocumentType,
              sourceDocumentId: params.paymentDocumentId,
              effectiveDate: params.paymentDate,
              postingDate: params.paymentDate,
              createdBy: params.createdBy,
            },
          });
        }
      }

      const allocation = await tx.settlementAllocation.create({
        data: {
          tenantId,
          organizationId: params.organizationId,
          paymentDocumentType: params.paymentDocumentType,
          paymentDocumentId: params.paymentDocumentId,
          paymentLineId: params.paymentLineId ?? undefined,
          counterpartyId: params.counterpartyId,
          contractId: params.contractId ?? undefined,
          targetOpenItemId: openItem.id,
          sourceOpenItemId: params.sourceOpenItemId ?? undefined,
          allocationDate: params.paymentDate,
          paymentCurrencyId: params.paymentCurrencyId,
          settlementCurrencyId: openItem.currencyId,
          paymentAmount: amount.toString(),
          settlementAmount: amount.toString(),
          baseCurrencyAmount: openItemBaseReduction.toString(),
          exchangeRate: currentRate.toString(),
          realizedFxAmount: realizedFx.toString(),
          allocationType: params.allocationType,
          createdBy: params.createdBy,
        },
      });

      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_PAYMENT_ALLOCATED', entityType: 'SETTLEMENT_ALLOCATION', entityId: allocation.id, action: 'CREATE', userId: params.createdBy ?? 'system', newValues: { targetOpenItemId: openItem.id, amount: amount.toString() } }, tx);
      created.push(allocation);
    }
    return created;
  }

  /** Automatic allocation (spec sections 28-29) — greedy fill by
   * `strategy` order, leftover becomes an advance (spec section 22:
   * "Payment itməməlidir"). */
  async autoAllocate(
    tenantId: string,
    params: {
      organizationId: string;
      counterpartyId: string;
      role: 'CUSTOMER' | 'SUPPLIER';
      paymentDocumentType: string;
      paymentDocumentId: string;
      paymentCurrencyId: string;
      paymentDate: Date;
      paymentAmount: Decimal.Value;
      strategy?: string;
      contractId?: string | null;
      createdBy?: string;
    },
    tx: PrismaTransactionClient,
  ) {
    const itemType = params.role === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE';
    const openItems = await tx.settlementOpenItem.findMany({
      where: { tenantId, organizationId: params.organizationId, counterpartyId: params.counterpartyId, itemType, currencyId: params.paymentCurrencyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] }, blockedForPayment: false },
      // A row order Postgres never promises without an explicit ORDER BY —
      // sortByStrategy's own comparator returns 0 for two items with the
      // same due/source date, and only this deterministic baseline (not
      // incidental physical row layout, which drifts as the table grows)
      // decides which one that stable sort keeps first.
      orderBy: [{ sourceDate: 'asc' }, { createdAt: 'asc' }],
    });

    const sorted = this.sortByStrategy(openItems, params.strategy ?? 'FIFO_BY_DUE_DATE');
    let remaining = new Decimal(params.paymentAmount);
    const lines: AllocationLine[] = [];
    for (const item of sorted) {
      if (remaining.lte(0)) break;
      const itemRemaining = new Decimal(item.remainingAmount.toString());
      if (itemRemaining.lte(0)) continue;
      const applied = Decimal.min(remaining, itemRemaining);
      lines.push({ targetOpenItemId: item.id, amount: applied.toString() });
      remaining = remaining.minus(applied);
    }

    const allocations = lines.length > 0
      ? await this.allocate(tenantId, { ...params, allocationType: 'AUTOMATIC', lines }, tx)
      : [];

    let advance = null;
    if (remaining.gt(EPSILON)) {
      advance = await this.movements.createAdvance(
        tenantId,
        { organizationId: params.organizationId, counterpartyId: params.counterpartyId, role: params.role, sourceDocumentType: params.paymentDocumentType, sourceDocumentId: params.paymentDocumentId, effectiveDate: params.paymentDate, currencyId: params.paymentCurrencyId, amount: remaining, baseAmount: remaining, createdBy: params.createdBy },
        tx,
      );
    }

    return { allocations, unallocatedAmount: remaining.toFixed(2), advanceOpenItemId: advance?.id ?? null };
  }

  /**
   * Allocation scoped to ONE source document's own open item(s) rather
   * than the whole counterparty (spec section 39's "SettlementPaymentSource"
   * shape, and the common "this payment names exactly one invoice" case) —
   * the hook `CashTransactionPostingHandler`/`PaymentOrderPostingHandler`
   * use, since they already know which invoice a payment targets. Fills
   * that invoice's own schedule lines oldest-first; anything left over
   * becomes an advance rather than being lost (spec section 22) or
   * silently applied to an unrelated invoice.
   */
  async allocateToDocument(
    tenantId: string,
    params: {
      organizationId: string;
      counterpartyId: string;
      role: 'CUSTOMER' | 'SUPPLIER';
      paymentDocumentType: string;
      paymentDocumentId: string;
      paymentLineId?: string | null;
      paymentCurrencyId: string;
      paymentDate: Date;
      paymentAmount: Decimal.Value;
      targetSourceDocumentType: string;
      targetSourceDocumentId: string;
      createdBy?: string;
    },
    tx: PrismaTransactionClient,
  ) {
    const itemType = params.role === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE';
    const openItems = await tx.settlementOpenItem.findMany({
      where: { tenantId, organizationId: params.organizationId, counterpartyId: params.counterpartyId, itemType, sourceDocumentType: params.targetSourceDocumentType, sourceDocumentId: params.targetSourceDocumentId },
      orderBy: [{ scheduleLineSequence: 'asc' }, { createdAt: 'asc' }],
    });

    let remaining = new Decimal(params.paymentAmount);
    const lines: AllocationLine[] = [];
    for (const item of openItems) {
      if (remaining.lte(0)) break;
      const itemRemaining = new Decimal(item.remainingAmount.toString());
      if (itemRemaining.lte(0)) continue;
      const applied = Decimal.min(remaining, itemRemaining);
      lines.push({ targetOpenItemId: item.id, amount: applied.toString() });
      remaining = remaining.minus(applied);
    }

    const allocations = lines.length > 0
      ? await this.allocate(tenantId, { organizationId: params.organizationId, counterpartyId: params.counterpartyId, role: params.role, paymentDocumentType: params.paymentDocumentType, paymentDocumentId: params.paymentDocumentId, paymentLineId: params.paymentLineId, paymentCurrencyId: params.paymentCurrencyId, paymentDate: params.paymentDate, allocationType: 'MANUAL', lines, createdBy: params.createdBy }, tx)
      : [];

    let advance = null;
    if (remaining.gt(EPSILON)) {
      advance = await this.movements.createAdvance(
        tenantId,
        { organizationId: params.organizationId, counterpartyId: params.counterpartyId, role: params.role, sourceDocumentType: params.paymentDocumentType, sourceDocumentId: params.paymentDocumentId, effectiveDate: params.paymentDate, currencyId: params.paymentCurrencyId, amount: remaining, baseAmount: remaining, createdBy: params.createdBy },
        tx,
      );
    }

    return { allocations, unallocatedAmount: remaining.toFixed(2), advanceOpenItemId: advance?.id ?? null };
  }

  /** Advance application (spec sections 25-26) — draws down an existing
   * CUSTOMER_ADVANCE/SUPPLIER_ADVANCE open item against a receivable/
   * payable. Modeled as an allocation whose `sourceOpenItemId` is the
   * advance — both sides reduce in the same call. */
  async applyAdvance(tenantId: string, membershipId: string, organizationId: string, userId: string, params: { advanceOpenItemId: string; targetOpenItemId: string; amount: Decimal.Value }, tx?: PrismaTransactionClient) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const run = async (t: PrismaTransactionClient) => {
      const advance = await t.settlementOpenItem.findFirst({ where: { id: params.advanceOpenItemId, tenantId, organizationId } });
      if (!advance) throw new NotFoundAppError('SettlementOpenItem', params.advanceOpenItemId);
      const target = await t.settlementOpenItem.findFirst({ where: { id: params.targetOpenItemId, tenantId, organizationId } });
      if (!target) throw new NotFoundAppError('SettlementOpenItem', params.targetOpenItemId);
      if (advance.counterpartyId !== target.counterpartyId) throw new SettlementCounterpartyMismatchError();

      const amount = new Decimal(params.amount);
      const advanceRemaining = new Decimal(advance.remainingAmount.toString()).abs();
      if (amount.gt(advanceRemaining.plus(EPSILON))) throw new AllocationAmountExceedsError('advance', advanceRemaining.toFixed(2), amount.toFixed(2));

      return this.allocate(
        tenantId,
        {
          organizationId,
          counterpartyId: target.counterpartyId,
          role: target.counterpartyRole as 'CUSTOMER' | 'SUPPLIER',
          paymentDocumentType: 'SETTLEMENT_ADVANCE',
          paymentDocumentId: advance.id,
          contractId: target.contractId,
          paymentCurrencyId: target.currencyId ?? advance.currencyId!,
          paymentDate: new Date(),
          allocationType: 'ADVANCE_APPLICATION',
          lines: [{ targetOpenItemId: target.id, amount }],
          sourceOpenItemId: advance.id,
          createdBy: userId,
        },
        t,
      );
    };
    return tx ? run(tx) : this.prisma.runInTransaction(run);
  }

  /** Allocation reversal (spec section 33, 86, 88) — never a physical
   * delete; restores both sides' remaining balance and flags the
   * allocation REVERSED, keeping the original row (and its FX movement)
   * in history untouched. */
  async reverse(tenantId: string, membershipId: string, organizationId: string, userId: string, allocationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocation = await tx.settlementAllocation.findFirst({ where: { id: allocationId, tenantId, organizationId } });
      if (!allocation) throw new NotFoundAppError('SettlementAllocation', allocationId);
      if (allocation.status === 'REVERSED') return allocation;

      const amount = new Decimal(allocation.settlementAmount.toString());
      const baseAmount = new Decimal(allocation.baseCurrencyAmount.toString());

      await this.movements.applyDelta(tenantId, allocation.targetOpenItemId, amount, baseAmount, tx);
      await tx.settlementMovement.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: allocation.counterpartyId,
          counterpartyRole: (await tx.settlementOpenItem.findFirst({ where: { id: allocation.targetOpenItemId } }))!.counterpartyRole,
          openItemId: allocation.targetOpenItemId,
          currencyId: allocation.settlementCurrencyId,
          movementType: 'RECLASSIFICATION',
          amount: amount.toString(),
          baseAmount: baseAmount.toString(),
          sourceDocumentType: 'SETTLEMENT_ALLOCATION_REVERSAL',
          sourceDocumentId: allocation.id,
          effectiveDate: new Date(),
          postingDate: new Date(),
          createdBy: userId,
        },
      });

      if (allocation.sourceOpenItemId) {
        await this.movements.applyDelta(tenantId, allocation.sourceOpenItemId, amount, baseAmount, tx);
      }

      const updated = await tx.settlementAllocation.update({ where: { id: allocationId }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId } });
      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_ALLOCATION_REVERSED', entityType: 'SETTLEMENT_ALLOCATION', entityId: allocationId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  /** Symmetric undo for a payment document's own posting (unpost, spec
   * section 86) — reverses every ACTIVE allocation (and any advance) this
   * exact payment created, inside the caller's own transaction. */
  async reverseForPaymentDocument(tenantId: string, organizationId: string, paymentDocumentType: string, paymentDocumentId: string, userId: string | undefined, tx: PrismaTransactionClient): Promise<void> {
    const allocations = await tx.settlementAllocation.findMany({ where: { tenantId, paymentDocumentType, paymentDocumentId, status: 'ACTIVE' } });
    for (const allocation of allocations) {
      const amount = new Decimal(allocation.settlementAmount.toString());
      const baseAmount = new Decimal(allocation.baseCurrencyAmount.toString());
      await this.movements.applyDelta(tenantId, allocation.targetOpenItemId, amount, baseAmount, tx);
      if (allocation.sourceOpenItemId) {
        await this.movements.applyDelta(tenantId, allocation.sourceOpenItemId, amount, baseAmount, tx);
      }
      await tx.settlementAllocation.update({ where: { id: allocation.id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId } });
    }
    // An advance THIS payment created is its own open item, not an
    // allocation — remove it directly, but only while untouched. One
    // already drawn down against an invoice (spec section 88's own
    // "allocation dependency" check) must be reversed there first.
    const advances = await tx.settlementOpenItem.findMany({ where: { tenantId, organizationId, sourceDocumentType: paymentDocumentType, sourceDocumentId: paymentDocumentId, itemType: { in: ['CUSTOMER_ADVANCE', 'SUPPLIER_ADVANCE'] } } });
    for (const advance of advances) {
      if (!new Decimal(advance.remainingAmount.toString()).minus(advance.originalAmount.toString()).abs().lte(0.005)) {
        throw new ValidationAppError(`Cannot unpost this payment — its advance has already been applied elsewhere; reverse that allocation first`);
      }
    }
    for (const advance of advances) {
      await tx.settlementMovement.deleteMany({ where: { tenantId, openItemId: advance.id } });
      await tx.settlementOpenItem.delete({ where: { id: advance.id } });
    }
  }

  private sortByStrategy<T extends { dueDate: Date | null; sourceDate: Date; remainingAmount: any }>(items: T[], strategy: string): T[] {
    const copy = [...items];
    switch (strategy) {
      case 'FIFO_BY_DOCUMENT_DATE':
        return copy.sort((a, b) => a.sourceDate.getTime() - b.sourceDate.getTime());
      case 'OLDEST_OVERDUE_FIRST':
      case 'FIFO_BY_DUE_DATE':
      default:
        return copy.sort((a, b) => (a.dueDate?.getTime() ?? a.sourceDate.getTime()) - (b.dueDate?.getTime() ?? b.sourceDate.getTime()));
    }
  }
}
