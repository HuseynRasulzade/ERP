import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { OpenItemService } from '../settlement/open-item.service';

export interface PaymentCalendarItem {
  date: string;
  organizationId: string;
  bankAccountId: string | null;
  cashFlowDirection: 'INFLOW' | 'OUTFLOW';
  category: string;
  sourceType: string;
  sourceId: string;
  counterpartyId: string | null;
  currencyId: string | null;
  amount: string;
  priority: string | null;
  approved: boolean;
  executedAmount: string;
  remainingAmount: string;
}

/**
 * PaymentCalendarService (spec sections 14-17) — a live, rebuildable
 * projection (never a stored table, same principle as
 * SettlementOpenItem/SettlementHealthService), never a source of actual
 * cash movement (spec section 22: "Payment Calendar Does Not Alter Bank
 * Balance").
 *
 * Planned OUTFLOWS come from this phase's own PaymentRequest (approved or
 * not-requiring-approval, still with something remaining to execute).
 * Planned INFLOWS reuse Phase 13's own open receivables (never
 * duplicated here) — a customer invoice's own due date. Executed amounts
 * are always computed live from POSTED PaymentOrder/IncomingBankPayment
 * rows, never a stored field (spec section 7 principle applied
 * calendar-wide).
 */
@Injectable()
export class PaymentCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly openItems: OpenItemService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<PaymentCalendarItem[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const items: PaymentCalendarItem[] = [];

    const requests = await this.prisma.paymentRequest.findMany({
      where: {
        organizationId,
        status: { notIn: ['CANCELLED'] },
        approvalStatus: { in: ['NOT_REQUIRED', 'APPROVED'] },
        requestedPaymentDate: { gte: fromDate, lte: toDate },
      },
    });
    for (const request of requests) {
      const orders = await this.prisma.paymentOrder.findMany({
        where: { paymentRequestId: request.id, status: { not: 'CANCELLED' } },
      });
      const committed = orders.reduce(
        (s, o) => s.plus(o.amount.toString()),
        new Decimal(0),
      );
      const executed = orders
        .filter((o) => o.postingStatus === 'POSTED')
        .reduce((s, o) => s.plus(o.amount.toString()), new Decimal(0));
      const approvedCap =
        request.approvedAmount != null
          ? new Decimal(request.approvedAmount.toString())
          : new Decimal(request.amount.toString());
      const remaining = approvedCap.minus(committed);
      if (remaining.lte(0) && executed.gte(approvedCap)) continue; // fully executed — nothing left to plan

      items.push({
        date: request.requestedPaymentDate!.toISOString().slice(0, 10),
        organizationId,
        bankAccountId: null,
        cashFlowDirection: 'OUTFLOW',
        category: request.category,
        sourceType: 'PAYMENT_REQUEST',
        sourceId: request.id,
        counterpartyId: request.counterpartyId,
        currencyId: request.currencyId,
        amount: approvedCap.toString(),
        priority: request.priority,
        approved:
          request.approvalStatus === 'APPROVED' ||
          request.approvalStatus === 'NOT_REQUIRED',
        executedAmount: executed.toFixed(2),
        remainingAmount: remaining.toFixed(2),
      });
    }

    const receivables = await this.openItems.list(
      tenantId,
      membershipId,
      organizationId,
      { itemType: 'RECEIVABLE' },
    );
    for (const item of receivables) {
      if (!item.dueDate) continue;
      const dueDate = new Date(item.dueDate);
      if (dueDate < fromDate || dueDate > toDate) continue;
      const remaining = new Decimal(item.remainingAmount);
      if (remaining.lte(0)) continue; // a credit position, not a planned inflow
      items.push({
        date: item.dueDate,
        organizationId,
        bankAccountId: null,
        cashFlowDirection: 'INFLOW',
        category: 'CUSTOMER_RECEIVABLE',
        sourceType: item.sourceDocumentType,
        sourceId: item.sourceDocumentId,
        counterpartyId: item.counterpartyId,
        currencyId: item.currencyId,
        amount: item.originalAmount,
        priority: null,
        approved: true,
        executedAmount: new Decimal(item.originalAmount)
          .minus(remaining)
          .toFixed(2),
        remainingAmount: remaining.toFixed(2),
      });
    }

    return items.sort((a, b) => a.date.localeCompare(b.date));
  }
}
