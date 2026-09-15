import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ValidationAppError, NotFoundAppError } from '../common/errors/app-error';
import { OpenItemService, OpenItemType } from './open-item.service';
import { SettlementMovementService } from './settlement-movement.service';
import { PaymentAllocationService } from './payment-allocation.service';

/**
 * AdvanceService (spec sections 22-27, 153-154). A `SettlementAdvance` is
 * created explicitly from whatever a `SettlementPayment` still has
 * unallocated (spec section 22: "Payment itməməlidir") — never implicitly
 * at posting time, so a payment allocated directly to an invoice never
 * double-counts as both a direct settlement AND an advance.
 */
@Injectable()
export class AdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly openItems: OpenItemService,
    private readonly movements: SettlementMovementService,
    private readonly allocations: PaymentAllocationService,
  ) {}

  async createFromUnallocatedPayment(tenantId: string, organizationId: string, userId: string, paymentId: string) {
    const payment = await this.prisma.settlementPayment.findFirst({ where: { id: paymentId, tenantId } });
    if (!payment) throw new NotFoundAppError('SettlementPayment', paymentId);

    const allocated = await this.prisma.settlementAllocation.aggregate({ where: { tenantId, paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: paymentId, status: 'ACTIVE' }, _sum: { paymentAmount: true } });
    const alreadyAdvanced = await this.prisma.settlementAdvance.aggregate({ where: { tenantId, sourceDocumentType: 'SETTLEMENT_PAYMENT', sourceDocumentId: paymentId }, _sum: { originalAmount: true } });
    const unallocated = new Decimal(payment.amount.toString()).minus((allocated._sum.paymentAmount ?? 0).toString()).minus((alreadyAdvanced._sum.originalAmount ?? 0).toString());
    if (unallocated.lte(0)) throw new ValidationAppError('This payment has no unallocated balance to convert into an advance');

    return this.prisma.runInTransaction(async (tx) => {
      const advance = await tx.settlementAdvance.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: payment.counterpartyId,
          counterpartyRole: payment.counterpartyRole,
          contractId: payment.contractId,
          sourceDocumentType: 'SETTLEMENT_PAYMENT',
          sourceDocumentId: paymentId,
          currencyId: payment.currencyId,
          originalAmount: unallocated.toString(),
          baseCurrencyAmount: unallocated.mul(payment.exchangeRate ? Number(payment.exchangeRate.toString()) : 1).toDecimalPlaces(2).toString(),
          remainingAmount: unallocated.toString(),
          status: 'OPEN',
        },
      });

      await this.movements.record(
        tenantId,
        {
          organizationId,
          counterpartyId: payment.counterpartyId,
          counterpartyRole: payment.counterpartyRole as 'CUSTOMER' | 'SUPPLIER',
          currencyId: payment.currencyId,
          transactionCurrencyAmount: payment.counterpartyRole === 'CUSTOMER' ? unallocated.negated() : unallocated,
          baseCurrencyAmount: payment.counterpartyRole === 'CUSTOMER' ? unallocated.negated() : unallocated,
          movementType: payment.counterpartyRole === 'CUSTOMER' ? 'CUSTOMER_ADVANCE_CREATE' : 'SUPPLIER_ADVANCE_CREATE',
          sourceDocumentType: 'SETTLEMENT_PAYMENT',
          sourceDocumentId: paymentId,
          effectiveDate: payment.postingDate ?? payment.documentDate,
        },
        tx,
      );

      await this.audit.record({ tenantId, eventType: payment.counterpartyRole === 'CUSTOMER' ? 'CUSTOMER_ADVANCE_CREATED' : 'SUPPLIER_ADVANCE_CREATED', entityType: 'SETTLEMENT_ADVANCE', entityId: advance.id, action: 'CREATE', userId, newValues: { amount: unallocated.toString() } }, tx);
      return advance;
    });
  }

  /** Applies part/all of an advance to an open item (spec sections 25-26)
   * — always traceable back to the original payment via
   * `SettlementAdvance.sourceDocumentId` (spec section 25: "Advance
   * original payment ilə traceable qalmalıdır"). */
  async apply(tenantId: string, organizationId: string, userId: string, advanceId: string, openItemType: OpenItemType, openItemId: string, amount: number) {
    return this.prisma.runInTransaction(async (tx) => {
      const advance = await tx.settlementAdvance.findFirst({ where: { id: advanceId, tenantId } });
      if (!advance) throw new NotFoundAppError('SettlementAdvance', advanceId);
      const applyAmount = new Decimal(amount);
      const remaining = new Decimal(advance.remainingAmount.toString());
      if (applyAmount.gt(remaining.plus('0.01'))) throw new ValidationAppError(`Advance ${advanceId} has only ${remaining.toString()} remaining.`);

      const newRemaining = remaining.minus(applyAmount);
      await tx.settlementAdvance.update({ where: { id: advanceId }, data: { appliedAmount: { increment: applyAmount.toString() }, remainingAmount: newRemaining.toString(), status: newRemaining.lte('0.01') ? 'FULLY_APPLIED' : 'PARTIALLY_APPLIED' } });

      const { newRemaining: itemRemaining, status } = await this.openItems.applyToOpenItem(tenantId, openItemType, openItemId, applyAmount, tx);

      const item = openItemType === 'SETTLEMENT_OBLIGATION' ? await tx.settlementObligation.findUniqueOrThrow({ where: { id: openItemId } }) : await tx.supplierPayable.findUniqueOrThrow({ where: { id: openItemId } });
      const sourceDocumentType = item.sourceDocumentType;

      const allocation = await tx.settlementAllocation.create({
        data: {
          tenantId,
          organizationId,
          paymentDocumentType: 'SETTLEMENT_ADVANCE',
          paymentDocumentId: advanceId,
          counterpartyId: advance.counterpartyId,
          contractId: advance.contractId ?? undefined,
          sourceOpenItemType: openItemType,
          sourceOpenItemId: openItemId,
          allocationDate: new Date(),
          paymentCurrencyId: advance.currencyId,
          settlementCurrencyId: item.currencyId ?? advance.currencyId,
          paymentAmount: applyAmount.toString(),
          settlementAmount: applyAmount.toString(),
          baseCurrencyAmount: applyAmount.toString(),
          allocationType: 'ADVANCE_APPLICATION',
          status: 'ACTIVE',
          createdBy: userId,
        },
      });

      await this.movements.record(
        tenantId,
        {
          organizationId,
          counterpartyId: advance.counterpartyId,
          counterpartyRole: advance.counterpartyRole as 'CUSTOMER' | 'SUPPLIER',
          settlementDocumentType: sourceDocumentType,
          settlementDocumentId: openItemId,
          currencyId: advance.currencyId,
          transactionCurrencyAmount: advance.counterpartyRole === 'CUSTOMER' ? applyAmount : applyAmount.negated(),
          baseCurrencyAmount: advance.counterpartyRole === 'CUSTOMER' ? applyAmount : applyAmount.negated(),
          movementType: advance.counterpartyRole === 'CUSTOMER' ? 'CUSTOMER_ADVANCE_APPLY' : 'SUPPLIER_ADVANCE_APPLY',
          sourceDocumentType: 'SETTLEMENT_ADVANCE',
          sourceDocumentId: advanceId,
          effectiveDate: new Date(),
        },
        tx,
      );
      await this.movements.record(
        tenantId,
        {
          organizationId,
          counterpartyId: advance.counterpartyId,
          counterpartyRole: advance.counterpartyRole as 'CUSTOMER' | 'SUPPLIER',
          settlementDocumentType: sourceDocumentType,
          settlementDocumentId: openItemId,
          currencyId: advance.currencyId,
          transactionCurrencyAmount: advance.counterpartyRole === 'CUSTOMER' ? applyAmount.negated() : applyAmount,
          baseCurrencyAmount: advance.counterpartyRole === 'CUSTOMER' ? applyAmount.negated() : applyAmount,
          movementType: advance.counterpartyRole === 'CUSTOMER' ? 'RECEIVABLE_REDUCE' : 'PAYABLE_REDUCE',
          sourceDocumentType: 'SETTLEMENT_ADVANCE',
          sourceDocumentId: advanceId,
          effectiveDate: new Date(),
        },
        tx,
      );

      await this.allocations.postReclassification(tenantId, organizationId, userId, advance.counterpartyRole as 'CUSTOMER' | 'SUPPLIER', applyAmount, new Decimal(0), sourceDocumentType, allocation.id, new Date(), tx);

      await this.audit.record({ tenantId, eventType: 'ADVANCE_APPLIED', entityType: 'SETTLEMENT_ADVANCE', entityId: advanceId, action: 'UPDATE', userId, newValues: { openItemId, amount: applyAmount.toString(), remaining: newRemaining.toString() } }, tx);
      return { allocation, advanceRemaining: newRemaining, openItemRemaining: itemRemaining, openItemStatus: status };
    });
  }

  async listUnapplied(tenantId: string, organizationId: string, counterpartyRole?: 'CUSTOMER' | 'SUPPLIER') {
    return this.prisma.settlementAdvance.findMany({ where: { tenantId, organizationId, counterpartyRole, status: { in: ['OPEN', 'PARTIALLY_APPLIED'] } }, orderBy: { createdAt: 'asc' } });
  }
}
