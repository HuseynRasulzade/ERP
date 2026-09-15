import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';
import { ManagementAllocationService } from './management-allocation.service';

export interface ProfitabilityRow {
  key: string;
  label: string;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
  marginPct: string | null;
  allocatedCost: string;
  contribution: string;
  freshness: 'PRELIMINARY' | 'FINAL';
}

/**
 * ProfitabilityService (docx spec Phase 24, sections 29-39). ONE
 * generic by-dimension profitability engine — CUSTOMER, PRODUCT, and
 * CHANNEL profitability are all the same calculation shape (Net
 * Revenue, COGS, Gross Profit, allocated cost, Contribution) grouped by
 * a different key, so this is a single calculator with three thin
 * public entry points rather than three duplicated ones (spec section
 * 153's own "Do not build monolithic AnalyticsService" is about NOT
 * merging every unrelated report into one class — a shared calculation
 * shape genuinely used by three dimensions is the opposite problem).
 * CHANNEL is foundation-only in this build: no `channel` field exists
 * on `SalesInvoice` yet, so `byChannel` returns an empty result set
 * with that gap disclosed rather than guessing (docs/
 * MANAGEMENT_REPORTING.md section D).
 */
@Injectable()
export class ProfitabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly measures: ManagementMeasureService,
    private readonly allocation: ManagementAllocationService,
  ) {}

  async byCustomer(tenantId: string, organizationId: string, mode: MeasureMode, allocationRuleCode?: string, period?: string): Promise<ProfitabilityRow[]> {
    if (mode.type === 'AS_OF') return [];
    const customers = await this.prisma.salesInvoice.findMany({ where: { tenantId, organizationId, documentDate: { gte: mode.periodStart, lte: mode.periodEnd }, postingStatus: 'POSTED' }, select: { counterpartyId: true }, distinct: ['counterpartyId'] });
    const rows: ProfitabilityRow[] = [];
    for (const { counterpartyId } of customers) {
      const counterparty = await this.prisma.counterparty.findUnique({ where: { id: counterpartyId } });
      const row = await this.calculateRow(tenantId, organizationId, mode, { customerId: counterpartyId }, counterpartyId, counterparty?.name ?? counterpartyId);
      rows.push(row);
    }
    return allocationRuleCode && period ? this.applyAllocation(tenantId, organizationId, rows, allocationRuleCode, period) : rows;
  }

  async byProduct(tenantId: string, organizationId: string, mode: MeasureMode, allocationRuleCode?: string, period?: string): Promise<ProfitabilityRow[]> {
    if (mode.type === 'AS_OF') return [];
    const products = await this.prisma.salesInvoiceLine.findMany({ where: { tenantId, salesInvoice: { organizationId, documentDate: { gte: mode.periodStart, lte: mode.periodEnd }, postingStatus: 'POSTED' } }, select: { productId: true }, distinct: ['productId'] });
    const rows: ProfitabilityRow[] = [];
    for (const { productId } of products) {
      const product = await this.prisma.product.findUnique({ where: { id: productId } });
      const row = await this.calculateRow(tenantId, organizationId, mode, { productId }, productId, product?.name ?? productId);
      rows.push(row);
    }
    return allocationRuleCode && period ? this.applyAllocation(tenantId, organizationId, rows, allocationRuleCode, period) : rows;
  }

  /** Foundation only (docs/MANAGEMENT_REPORTING.md section D) — no
   * governed `channel` dimension exists on source documents yet. */
  async byChannel(): Promise<ProfitabilityRow[]> {
    return [];
  }

  private async calculateRow(tenantId: string, organizationId: string, mode: MeasureMode, filters: { customerId?: string; productId?: string }, key: string, label: string): Promise<ProfitabilityRow> {
    const revenue = await this.measures.evaluate(tenantId, organizationId, 'NET_REVENUE', mode, filters);
    const cogs = await this.measures.evaluate(tenantId, organizationId, 'COGS', mode, filters);
    const grossProfit = revenue.value.minus(cogs.value);
    const marginPct = revenue.value.eq(0) ? null : grossProfit.div(revenue.value).mul(100);
    return {
      key,
      label,
      netRevenue: revenue.value.toFixed(2),
      cogs: cogs.value.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      marginPct: marginPct?.toFixed(2) ?? null,
      allocatedCost: '0.00',
      contribution: grossProfit.toFixed(2),
      freshness: cogs.freshness,
    };
  }

  /** Overlays a `ManagementAllocationRun`'s lines onto the profitability
   * rows (spec sections 29, 49) — Contribution = Gross Profit -
   * Allocated Cost. Never mutates GL (spec section 50). */
  private async applyAllocation(tenantId: string, organizationId: string, rows: ProfitabilityRow[], allocationRuleCode: string, period: string): Promise<ProfitabilityRow[]> {
    const lines = await this.allocation.getRunLines(tenantId, organizationId, allocationRuleCode, period);
    const byKey = new Map(lines.map((l) => [l.targetKey, new Decimal(l.allocatedAmount.toString())]));
    return rows.map((row) => {
      const allocated = byKey.get(row.key) ?? new Decimal(0);
      return { ...row, allocatedCost: allocated.toFixed(2), contribution: new Decimal(row.grossProfit).minus(allocated).toFixed(2) };
    });
  }
}
