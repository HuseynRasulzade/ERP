import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PaymentCalendarService (spec sections 14-17, 74-75). Items are created
 * once (from an approved `PaymentRequest`, or a manual forecast entry)
 * and never overwritten — `executedAmount`/`remainingAmount` update as
 * actual `SettlementPayment`s post (see `SettlementPaymentPostingHandler`),
 * but `plannedAmount`/`amount` itself never changes (spec section 74).
 */
@Injectable()
export class PaymentCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromApprovedRequest(tenantId: string, organizationId: string, request: { id: string; requestedPaymentDate: Date | null; requestDate: Date; paymentCategory: string; counterpartyId: string | null; currencyId: string; approvedAmount: unknown; bankAccountId: string | null; paymentPriority: string }) {
    const amount = new Decimal(String(request.approvedAmount));
    return this.prisma.paymentCalendarItem.create({
      data: {
        tenantId,
        organizationId,
        bankAccountId: request.bankAccountId,
        itemDate: request.requestedPaymentDate ?? request.requestDate,
        cashFlowDirection: 'OUTFLOW',
        category: request.paymentCategory,
        sourceType: 'PAYMENT_REQUEST',
        sourceId: request.id,
        paymentRequestId: request.id,
        counterpartyId: request.counterpartyId,
        currencyId: request.currencyId,
        amount: amount.toString(),
        baseAmount: amount.toString(),
        priority: request.paymentPriority,
        approved: true,
        committed: false,
        remainingAmount: amount.toString(),
      },
    });
  }

  /** Manual forecast entry — expected customer collections, recurring
   * income, loan proceeds, etc. (spec sections 16-18). */
  async createManual(tenantId: string, organizationId: string, dto: { itemDate: string; cashFlowDirection: 'INFLOW' | 'OUTFLOW'; category: string; counterpartyId?: string; bankAccountId?: string; currencyId: string; amount: number; probability?: string; priority?: string }) {
    return this.prisma.paymentCalendarItem.create({
      data: {
        tenantId,
        organizationId,
        bankAccountId: dto.bankAccountId,
        itemDate: new Date(dto.itemDate),
        cashFlowDirection: dto.cashFlowDirection,
        category: dto.category,
        sourceType: 'MANUAL_FORECAST',
        counterpartyId: dto.counterpartyId,
        currencyId: dto.currencyId,
        amount: dto.amount.toString(),
        baseAmount: dto.amount.toString(),
        probability: dto.probability ?? 'MEDIUM',
        priority: dto.priority ?? 'NORMAL',
        remainingAmount: dto.amount.toString(),
      },
    });
  }

  /** Adds expected customer collections from Phase 13's own open
   * receivables (spec section 16) as INFLOW calendar items — read-only
   * projection, never persisted twice (call with a fresh date range each
   * time; does not deduplicate against previously-materialized items,
   * left to the caller to only call once per planning cycle). */
  async expectedCollections(tenantId: string, organizationId: string, fromDate: Date, toDate: Date) {
    const items = await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] }, dueDate: { gte: fromDate, lte: toDate } } });
    return items.map((i) => ({ date: i.dueDate, counterpartyId: i.counterpartyId, currencyId: i.currencyId, amount: new Decimal(i.remainingAmount!.toString()).toString(), sourceDocumentId: i.sourceDocumentId }));
  }

  async supplierDues(tenantId: string, organizationId: string, fromDate: Date, toDate: Date) {
    const items = await this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] }, dueDate: { gte: fromDate, lte: toDate } } });
    return items.map((i) => ({ date: i.dueDate, counterpartyId: i.counterpartyId, currencyId: i.currencyId, amount: new Decimal(i.remainingAmount!.toString()).toString(), sourceDocumentId: i.sourceDocumentId }));
  }

  async list(tenantId: string, organizationId: string, filters: { bankAccountId?: string; currencyId?: string; fromDate?: Date; toDate?: Date; priority?: string; category?: string; status?: string } = {}) {
    return this.prisma.paymentCalendarItem.findMany({
      where: { tenantId, organizationId, bankAccountId: filters.bankAccountId, currencyId: filters.currencyId, priority: filters.priority, category: filters.category, itemDate: filters.fromDate || filters.toDate ? { gte: filters.fromDate, lte: filters.toDate } : undefined },
      orderBy: { itemDate: 'asc' },
    });
  }
}
