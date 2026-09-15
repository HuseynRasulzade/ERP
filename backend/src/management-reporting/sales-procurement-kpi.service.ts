import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';

/**
 * Sales KPIs (spec sections 81-83) and Procurement KPI foundation (spec
 * sections 84-85) combined into one file — both are simple period
 * aggregations over their own module's already-posted documents, with
 * no shared calculation engine complex enough to justify Phase 23/24's
 * shared-resolver pattern.
 */
@Injectable()
export class SalesProcurementKPIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async salesKPIs(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const period: MeasureMode = { type: 'PERIOD', periodStart, periodEnd };
    const grossRevenue = await this.measures.evaluate(tenantId, organizationId, 'GROSS_REVENUE', period);
    const netRevenue = await this.measures.evaluate(tenantId, organizationId, 'NET_REVENUE', period);
    const returns = await this.measures.evaluate(tenantId, organizationId, 'SALES_RETURN', period);
    const salesQty = await this.measures.evaluate(tenantId, organizationId, 'SALES_QTY', period);

    const invoices = await this.prisma.salesInvoice.findMany({ where: { tenantId, organizationId, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'POSTED' }, select: { id: true, counterpartyId: true } });
    const customerCount = new Set(invoices.map((i) => i.counterpartyId)).size;
    const averageSellingPrice = salesQty.value.eq(0) ? null : netRevenue.value.div(salesQty.value);
    const discountPct = grossRevenue.value.eq(0) ? null : new Decimal(0); // no separate discount capture in this codebase (disclosed, see docs section A)
    const returnPct = grossRevenue.value.eq(0) ? null : returns.value.div(grossRevenue.value).mul(100);

    return {
      orders: invoices.length,
      units: salesQty.value.toFixed(4),
      grossRevenue: grossRevenue.value.toFixed(2),
      netRevenue: netRevenue.value.toFixed(2),
      averageSellingPrice: averageSellingPrice?.toFixed(4) ?? null,
      discountPct: discountPct?.toFixed(2) ?? null,
      returnPct: returnPct?.toFixed(2) ?? null,
      customerCount,
    };
  }

  async procurementKPIs(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const invoices = await this.prisma.purchaseInvoice.findMany({ where: { tenantId, organizationId, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'POSTED' }, select: { id: true, grandTotal: true, counterpartyId: true } });
    const purchaseValue = invoices.reduce((s, i) => s.plus(i.grandTotal.toString()), new Decimal(0));
    const supplierTotals = new Map<string, Decimal>();
    for (const inv of invoices) supplierTotals.set(inv.counterpartyId, (supplierTotals.get(inv.counterpartyId) ?? new Decimal(0)).plus(inv.grandTotal.toString()));
    const topSupplierShare = purchaseValue.eq(0) ? null : Decimal.max(...Array.from(supplierTotals.values()).map((v) => v), new Decimal(0)).div(purchaseValue).mul(100);

    const returns = await this.prisma.purchaseReturn.count({ where: { tenantId, organizationId, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'POSTED' } });
    const matchingExceptions = await this.prisma.purchaseMatchingResult.count({ where: { tenantId, overallStatus: { not: 'MATCHED' }, purchaseInvoice: { organizationId, documentDate: { gte: periodStart, lte: periodEnd } } } });

    return {
      purchaseValue: purchaseValue.toFixed(2),
      supplierCount: supplierTotals.size,
      supplierConcentrationPct: topSupplierShare?.toFixed(2) ?? null,
      purchaseReturns: returns,
      invoiceMatchExceptions: matchingExceptions,
    };
  }
}
