import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OpenItemService } from './open-item.service';
import { AgeingService } from './ageing.service';
import { SettlementReconciliationService } from './settlement-reconciliation.service';

/**
 * SettlementReportingService (spec sections 116-125, 89-91). Read-only
 * aggregation over this module's own tables — delegates to
 * `OpenItemService`/`AgeingService`/`SettlementReconciliationService`
 * rather than re-deriving open-item logic (spec section 141's own "no
 * monolithic service" rule).
 */
@Injectable()
export class SettlementReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openItems: OpenItemService,
    private readonly ageing: AgeingService,
    private readonly reconciliation: SettlementReconciliationService,
  ) {}

  async openReceivables(tenantId: string, organizationId: string, counterpartyId?: string) {
    const [items, ageingRows] = await Promise.all([this.openItems.getReceivables(tenantId, organizationId, { counterpartyId }), this.ageing.customerAgeing(tenantId, organizationId)]);
    const ageingById = new Map(ageingRows.map((r) => [r.openItemId, r]));
    return items.map((i) => ({ ...i, ageing: ageingById.get(i.id) ?? null }));
  }

  async openPayables(tenantId: string, organizationId: string, counterpartyId?: string) {
    const [items, ageingRows] = await Promise.all([this.openItems.getPayables(tenantId, organizationId, { counterpartyId }), this.ageing.supplierAgeing(tenantId, organizationId)]);
    const ageingById = new Map(ageingRows.map((r) => [r.openItemId, r]));
    return items.map((i) => ({ ...i, ageing: ageingById.get(i.id) ?? null }));
  }

  async advancesReport(tenantId: string, organizationId: string, counterpartyRole?: 'CUSTOMER' | 'SUPPLIER') {
    return this.prisma.settlementAdvance.findMany({ where: { tenantId, organizationId, counterpartyRole }, orderBy: { createdAt: 'asc' } });
  }

  async unallocatedPaymentsReport(tenantId: string, organizationId: string) {
    const payments = await this.prisma.settlementPayment.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED' } });
    const rows = [];
    for (const p of payments) {
      const allocated = await this.prisma.settlementAllocation.aggregate({ where: { tenantId, paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: p.id, status: 'ACTIVE' }, _sum: { paymentAmount: true } });
      const advanced = await this.prisma.settlementAdvance.aggregate({ where: { tenantId, sourceDocumentType: 'SETTLEMENT_PAYMENT', sourceDocumentId: p.id }, _sum: { originalAmount: true } });
      const unallocated = new Decimal(p.amount.toString()).minus((allocated._sum.paymentAmount ?? 0).toString()).minus((advanced._sum.originalAmount ?? 0).toString());
      if (unallocated.gt('0.01')) rows.push({ paymentId: p.id, number: p.number, counterpartyId: p.counterpartyId, date: p.documentDate, amount: p.amount.toString(), currencyId: p.currencyId, reference: p.reference, unallocated: unallocated.toString(), ageDays: Math.floor((Date.now() - p.documentDate.getTime()) / 86_400_000) });
    }
    return rows;
  }

  /** Two-directional drill-down (spec section 122). */
  async allocationHistoryForPayment(tenantId: string, paymentDocumentType: string, paymentDocumentId: string) {
    return this.prisma.settlementAllocation.findMany({ where: { tenantId, paymentDocumentType, paymentDocumentId }, orderBy: { createdAt: 'asc' } });
  }

  async allocationHistoryForOpenItem(tenantId: string, sourceOpenItemType: string, sourceOpenItemId: string) {
    return this.prisma.settlementAllocation.findMany({ where: { tenantId, sourceOpenItemType, sourceOpenItemId }, orderBy: { createdAt: 'asc' } });
  }

  /** Debt movement report (spec section 123) — period totals grouped by
   * movementType, from the immutable register. */
  async debtMovementReport(tenantId: string, organizationId: string, counterpartyId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', periodStart: Date, periodEnd: Date) {
    const grouped = await this.prisma.settlementMovement.groupBy({
      by: ['movementType'],
      where: { tenantId, organizationId, counterpartyId, counterpartyRole, effectiveDate: { gte: periodStart, lte: periodEnd } },
      _sum: { baseCurrencyAmount: true },
    });
    return grouped.map((g) => ({ movementType: g.movementType, amount: new Decimal((g._sum.baseCurrencyAmount ?? 0).toString()).toString() }));
  }

  async customerStatement(tenantId: string, organizationId: string, counterpartyId: string, periodStart: Date, periodEnd: Date) {
    return this.reconciliation.statementLines(tenantId, organizationId, counterpartyId, 'CUSTOMER', periodStart, periodEnd);
  }

  async supplierStatement(tenantId: string, organizationId: string, counterpartyId: string, periodStart: Date, periodEnd: Date) {
    return this.reconciliation.statementLines(tenantId, organizationId, counterpartyId, 'SUPPLIER', periodStart, periodEnd);
  }

  async reconciliationDifferencesReport(tenantId: string, organizationId: string) {
    return this.prisma.settlementReconciliation.findMany({ where: { tenantId, organizationId, status: { in: ['DIFFERENCE_FOUND', 'ADJUSTMENT_REQUIRED'] } }, orderBy: { periodEnd: 'desc' } });
  }
}
