import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError, NotFoundAppError } from '../common/errors/app-error';
import { OpenItemService, OpenItemType } from './open-item.service';
import { SettlementMovementService } from './settlement-movement.service';
import { SettlementPolicyService } from './settlement-policy.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

export interface AllocationLineInput {
  openItemType: OpenItemType;
  openItemId: string;
  amount: number;
}

/**
 * PaymentAllocationService (spec sections 16-21, 28-33, 52-56, 137-139).
 * The one place a `SettlementAllocation` row is ever created — manual or
 * automatic, both funnel through `allocateLines` so validation
 * (spec section 32), realized FX (spec sections 54-56), and the
 * open-item/advance projection update (via `OpenItemService`) are never
 * duplicated between the two entry points.
 *
 * Concurrency (spec sections 137-138): `applyToOpenItem`'s
 * `remainingAmount` update is a single `UPDATE ... SET remaining = remaining
 * - amount WHERE id = ...` guarded by the `< 0` check happening on the
 * value read inside the SAME transaction — two concurrent allocations
 * against the same open item serialize on Postgres's own row lock for
 * that `UPDATE`, so the second one to commit sees the first's already-
 * applied decrement and fails the insufficient-balance check rather than
 * over-allocating.
 */
@Injectable()
export class PaymentAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly openItems: OpenItemService,
    private readonly movements: SettlementMovementService,
    private readonly policies: SettlementPolicyService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
  ) {}

  /** Manual allocation (spec section 31) — caller-specified lines. */
  async allocateManual(tenantId: string, organizationId: string, userId: string, input: { paymentDocumentType: string; paymentDocumentId: string; counterpartyId: string; counterpartyRole: 'CUSTOMER' | 'SUPPLIER'; contractId?: string; currencyId: string; exchangeRate?: number; allocationDate: string; lines: AllocationLineInput[] }) {
    return this.allocateLines(tenantId, organizationId, userId, { ...input, allocationType: 'MANUAL' });
  }

  /** Automatic allocation (spec sections 28-29) — FIFO by due date over
   * open receivables/payables for this counterparty, up to the payment's
   * unallocated balance. Other strategies named in the policy fall back
   * to this same FIFO behavior (disclosed simplification). */
  async allocateAutomatic(tenantId: string, organizationId: string, userId: string, input: { paymentDocumentType: string; paymentDocumentId: string; counterpartyId: string; counterpartyRole: 'CUSTOMER' | 'SUPPLIER'; contractId?: string; currencyId: string; exchangeRate?: number; allocationDate: string; amount: number }) {
    const type: OpenItemType = input.counterpartyRole === 'CUSTOMER' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
    const openItems = type === 'SETTLEMENT_OBLIGATION'
      ? await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, counterpartyId: input.counterpartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] })
      : await this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, counterpartyId: input.counterpartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });

    let remaining = new Decimal(input.amount);
    const lines: AllocationLineInput[] = [];
    for (const item of openItems) {
      if (remaining.lte(0)) break;
      const itemRemaining = new Decimal(((item as any).remainingAmount ?? (item as any).amountDue ?? (item as any).invoiceAmount).toString());
      if (itemRemaining.lte(0)) continue;
      const take = Decimal.min(itemRemaining, remaining);
      lines.push({ openItemType: type, openItemId: item.id, amount: take.toNumber() });
      remaining = remaining.minus(take);
    }

    return this.allocateLines(tenantId, organizationId, userId, { ...input, allocationType: 'AUTOMATIC', lines });
  }

  /** Preview only (spec section 101) — computes the same FIFO suggestion
   * as `allocateAutomatic` without writing anything. */
  async previewAutomatic(tenantId: string, organizationId: string, counterpartyId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', amount: number) {
    const type: OpenItemType = counterpartyRole === 'CUSTOMER' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
    const openItems = type === 'SETTLEMENT_OBLIGATION'
      ? await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, counterpartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] })
      : await this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, counterpartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });

    let remaining = new Decimal(amount);
    const suggestions: { openItemId: string; sourceDocumentId: string; amount: string }[] = [];
    for (const item of openItems) {
      if (remaining.lte(0)) break;
      const itemRemaining = new Decimal(((item as any).remainingAmount ?? (item as any).amountDue ?? (item as any).invoiceAmount).toString());
      if (itemRemaining.lte(0)) continue;
      const take = Decimal.min(itemRemaining, remaining);
      suggestions.push({ openItemId: item.id, sourceDocumentId: item.sourceDocumentId, amount: take.toString() });
      remaining = remaining.minus(take);
    }
    return { suggestions, unallocated: remaining.toString() };
  }

  private async allocateLines(
    tenantId: string,
    organizationId: string,
    userId: string,
    input: { paymentDocumentType: string; paymentDocumentId: string; counterpartyId: string; counterpartyRole: 'CUSTOMER' | 'SUPPLIER'; contractId?: string; currencyId: string; exchangeRate?: number; allocationDate: string; allocationType: string; lines: AllocationLineInput[] },
  ) {
    if (input.lines.length === 0) throw new ValidationAppError('At least one allocation line is required');
    for (const l of input.lines) if (l.amount <= 0) throw new ValidationAppError('Allocation amount must be positive');

    const allocationDate = new Date(input.allocationDate);
    const paymentRate = input.exchangeRate ?? 1;

    return this.prisma.runInTransaction(async (tx) => {
      // Validation (spec section 32): payment's own unallocated balance
      // must cover the total requested.
      const alreadyAllocated = await tx.settlementAllocation.aggregate({ where: { tenantId, paymentDocumentType: input.paymentDocumentType, paymentDocumentId: input.paymentDocumentId, status: 'ACTIVE' }, _sum: { paymentAmount: true } });
      const paymentTotal = await this.getPaymentAmount(tx, input.paymentDocumentType, input.paymentDocumentId);
      const unallocated = paymentTotal.minus((alreadyAllocated._sum.paymentAmount ?? 0).toString());
      const totalRequested = input.lines.reduce((s, l) => s.plus(l.amount), new Decimal(0));
      if (totalRequested.gt(unallocated.plus('0.01'))) {
        throw new ValidationAppError(`Payment ${input.paymentDocumentId} has only ${unallocated.toString()} unallocated.`);
      }

      const created = [];
      for (const line of input.lines) {
        const amount = new Decimal(line.amount);
        const { openItemRate, openItemCurrencyId, sourceDocumentType, sourceDocumentId, contractId } = await this.loadOpenItemContext(tx, line.openItemType, line.openItemId);

        if (openItemCurrencyId !== input.currencyId) {
          const policy = await this.policies.resolve(tenantId, organizationId, input.counterpartyId, allocationDate, tx);
          if (!policy.allowCrossCurrencySettlement) {
            throw new ValidationAppError(`Cross-currency settlement is disabled for this counterparty (payment currency differs from the open item's currency).`);
          }
        }

        // Realized FX (spec sections 54-56) — only meaningful when
        // payment and open item share the same transaction currency;
        // cross-currency settlement (policy-gated above) is booked at
        // face value with no computed FX line (disclosed simplification).
        const realizedFx = openItemCurrencyId === input.currencyId ? amount.mul(paymentRate - openItemRate).toDecimalPlaces(2) : new Decimal(0);

        await this.openItems.applyToOpenItem(tenantId, line.openItemType, line.openItemId, amount, tx);

        const allocation = await tx.settlementAllocation.create({
          data: {
            tenantId,
            organizationId,
            paymentDocumentType: input.paymentDocumentType,
            paymentDocumentId: input.paymentDocumentId,
            counterpartyId: input.counterpartyId,
            contractId: input.contractId ?? contractId ?? undefined,
            sourceOpenItemType: line.openItemType,
            sourceOpenItemId: line.openItemId,
            allocationDate,
            paymentCurrencyId: input.currencyId,
            settlementCurrencyId: openItemCurrencyId,
            paymentAmount: amount.toString(),
            settlementAmount: amount.toString(),
            baseCurrencyAmount: amount.mul(paymentRate).toDecimalPlaces(2).toString(),
            exchangeRate: paymentRate.toString(),
            realizedFxAmount: realizedFx.toString(),
            allocationType: input.allocationType,
            status: 'ACTIVE',
            createdBy: userId,
          },
        });

        await this.movements.record(
          tenantId,
          {
            organizationId,
            counterpartyId: input.counterpartyId,
            counterpartyRole: input.counterpartyRole,
            contractId: input.contractId ?? contractId,
            settlementDocumentType: sourceDocumentType,
            settlementDocumentId: line.openItemId,
            currencyId: input.currencyId,
            transactionCurrencyAmount: input.counterpartyRole === 'CUSTOMER' ? amount.negated() : amount,
            baseCurrencyAmount: input.counterpartyRole === 'CUSTOMER' ? amount.mul(paymentRate).negated() : amount.mul(paymentRate),
            movementType: input.counterpartyRole === 'CUSTOMER' ? 'RECEIVABLE_REDUCE' : 'PAYABLE_REDUCE',
            sourceDocumentType: input.paymentDocumentType,
            sourceDocumentId: input.paymentDocumentId,
            effectiveDate: allocationDate,
          },
          tx,
        );

        if (!realizedFx.isZero()) {
          await this.movements.record(
            tenantId,
            {
              organizationId,
              counterpartyId: input.counterpartyId,
              counterpartyRole: input.counterpartyRole,
              settlementDocumentType: sourceDocumentType,
              settlementDocumentId: line.openItemId,
              currencyId: input.currencyId,
              transactionCurrencyAmount: new Decimal(0),
              baseCurrencyAmount: input.counterpartyRole === 'CUSTOMER' ? realizedFx : realizedFx.negated(),
              movementType: 'FX_ADJUSTMENT',
              sourceDocumentType: input.paymentDocumentType,
              sourceDocumentId: input.paymentDocumentId,
              effectiveDate: allocationDate,
            },
            tx,
          );
        }

        // GL reclassification (spec sections 105-106): `SettlementPayment`
        // always posts its OWN entry against the advance/clearing account
        // at document-post time (see its posting handler); a direct
        // allocation to an open item reclassifies that clearing balance
        // into the real AR/AP account here. Applying an EXISTING advance
        // (`paymentDocumentType === 'SETTLEMENT_ADVANCE'`) posts the same
        // shape from `AdvanceService.apply` instead — never both.
        if (input.paymentDocumentType === 'SETTLEMENT_PAYMENT') {
          await this.postReclassification(tenantId, organizationId, userId, input.counterpartyRole, amount.mul(paymentRate).toDecimalPlaces(2), realizedFx, sourceDocumentType, allocation.id, allocationDate, tx);
        }

        await this.audit.record({ tenantId, eventType: 'PAYMENT_ALLOCATED', entityType: 'SETTLEMENT_ALLOCATION', entityId: allocation.id, action: 'CREATE', userId, newValues: { openItemId: line.openItemId, amount: amount.toString(), realizedFx: realizedFx.toString() } }, tx);
        created.push(allocation);
      }

      return created;
    });
  }

  /** Dr Customer/Supplier Advance / Cr Receivable (or the mirror for a
   * supplier) for `amount`, plus an FX gain/loss leg when `realizedFx` is
   * nonzero (booked to OTHER_OPERATING_INCOME/EXPENSE — this build has no
   * dedicated FX gain/loss mapping key, a disclosed simplification, see
   * docs/SETTLEMENT.md). Never blocks the allocation itself if a mapping
   * is missing — the settlement subledger (spec section 103's own "iki
   * ayrı anlayış") stays authoritative even when GL can't resolve yet. */
  /** Public: also called by `AdvanceService.apply` for the same GL shape
   * when applying an already-existing advance (rather than duplicating
   * this method). */
  async postReclassification(tenantId: string, organizationId: string, userId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', amount: Decimal, realizedFx: Decimal, sourceDocumentType: string, allocationId: string, businessDate: Date, tx: PrismaTransactionClient) {
    if (amount.lte(0)) return;
    try {
      const clearing = await this.mappings.resolve(tenantId, organizationId, counterpartyRole === 'CUSTOMER' ? MappingKeys.CUSTOMER_ADVANCE : MappingKeys.SUPPLIER_ADVANCE, businessDate, tx);
      const openItemAccount = await this.mappings.resolve(tenantId, organizationId, counterpartyRole === 'CUSTOMER' ? MappingKeys.CUSTOMER_RECEIVABLE : MappingKeys.SUPPLIER_PAYABLE, businessDate, tx);

      const lines = counterpartyRole === 'CUSTOMER'
        ? [
            { accountId: clearing.id, side: 'DEBIT' as const, amountBase: amount, description: 'Payment applied to receivable' },
            { accountId: openItemAccount.id, side: 'CREDIT' as const, amountBase: amount, description: 'Receivable settled' },
          ]
        : [
            { accountId: openItemAccount.id, side: 'DEBIT' as const, amountBase: amount, description: 'Payable settled' },
            { accountId: clearing.id, side: 'CREDIT' as const, amountBase: amount, description: 'Payment applied to payable' },
          ];

      if (!realizedFx.isZero()) {
        const fxAccount = await this.mappings.resolve(tenantId, organizationId, realizedFx.gt(0) ? MappingKeys.OTHER_OPERATING_INCOME : MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx);
        const fxAbs = realizedFx.abs();
        // Gain reduces the amount cleared from the open-item account (we
        // collected less base currency than the receivable was carried
        // at); loss increases it — kept balanced against the fx account.
        if (realizedFx.gt(0)) lines.push({ accountId: fxAccount.id, side: counterpartyRole === 'CUSTOMER' ? 'CREDIT' : 'DEBIT', amountBase: fxAbs, description: 'Realized FX gain' });
        else lines.push({ accountId: fxAccount.id, side: counterpartyRole === 'CUSTOMER' ? 'DEBIT' : 'CREDIT', amountBase: fxAbs, description: 'Realized FX loss' });
      }

      await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate, description: 'Settlement allocation reclassification', operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: 'SETTLEMENT_ALLOCATION', sourceDocumentId: allocationId, lines }, tx);
    } catch {
      // Mapping not configured yet — subledger stays authoritative;
      // CostingReconciliation-style health checks (spec section 110) will
      // surface the resulting subledger/GL gap rather than this call
      // silently blocking the allocation.
    }
  }

  async reverse(tenantId: string, allocationId: string, userId: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const allocation = await tx.settlementAllocation.findFirst({ where: { id: allocationId, tenantId } });
      if (!allocation) throw new NotFoundAppError('SettlementAllocation', allocationId);
      if (allocation.status === 'REVERSED') throw new ValidationAppError('Allocation is already reversed');

      await this.openItems.unapplyFromOpenItem(tenantId, allocation.sourceOpenItemType as OpenItemType, allocation.sourceOpenItemId, new Decimal(allocation.settlementAmount.toString()), tx);
      const updated = await tx.settlementAllocation.update({ where: { id: allocationId }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId } });
      await this.audit.record({ tenantId, eventType: 'PAYMENT_ALLOCATION_REVERSED', entityType: 'SETTLEMENT_ALLOCATION', entityId: allocationId, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  private async loadOpenItemContext(tx: PrismaTransactionClient, type: OpenItemType, id: string): Promise<{ openItemRate: number; openItemCurrencyId: string; sourceDocumentType: string; sourceDocumentId: string; contractId: string | null }> {
    if (type === 'SETTLEMENT_OBLIGATION') {
      const item = await tx.settlementObligation.findUniqueOrThrow({ where: { id } });
      return { openItemRate: item.exchangeRate ? Number(item.exchangeRate.toString()) : 1, openItemCurrencyId: item.currencyId ?? '', sourceDocumentType: item.sourceDocumentType, sourceDocumentId: item.sourceDocumentId, contractId: item.contractId };
    }
    const item = await tx.supplierPayable.findUniqueOrThrow({ where: { id } });
    return { openItemRate: item.exchangeRate ? Number(item.exchangeRate.toString()) : 1, openItemCurrencyId: item.currencyId ?? '', sourceDocumentType: item.sourceDocumentType, sourceDocumentId: item.sourceDocumentId, contractId: item.contractId };
  }

  private async getPaymentAmount(tx: PrismaTransactionClient, paymentDocumentType: string, paymentDocumentId: string): Promise<Decimal> {
    if (paymentDocumentType === 'SETTLEMENT_PAYMENT') {
      const payment = await tx.settlementPayment.findUniqueOrThrow({ where: { id: paymentDocumentId } });
      return new Decimal(payment.amount.toString());
    }
    if (paymentDocumentType === 'SETTLEMENT_ADVANCE') {
      const advance = await tx.settlementAdvance.findUniqueOrThrow({ where: { id: paymentDocumentId } });
      return new Decimal(advance.originalAmount.toString());
    }
    throw new ValidationAppError(`Unknown payment document type: ${paymentDocumentType}`);
  }
}
