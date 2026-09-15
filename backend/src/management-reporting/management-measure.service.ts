import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { ValidationAppError } from '../common/errors/app-error';

export type MeasureMode = { type: 'PERIOD'; periodStart: Date; periodEnd: Date } | { type: 'AS_OF'; asOfDate: Date };
export interface MeasureFilters {
  customerId?: string;
  supplierId?: string;
  productId?: string;
  warehouseId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectId?: string;
}
export interface MeasureResult {
  value: Decimal;
  freshness: 'PRELIMINARY' | 'FINAL';
  sourceCount: number;
}

/**
 * ManagementMeasureService (docx spec Phase 24, sections 5-6, 13-14, 21-27).
 * The canonical measure evaluation engine every KPI/profitability/
 * working-capital/production/workforce service in this module delegates
 * to — computed LIVE against the same operational/GL tables every other
 * phase already established (Sales, Inventory Costing, Settlement,
 * Payroll, Production, GL), never a duplicated "management truth" table
 * or a separate analytical fact/projection store (spec sections 2, 13-14
 * — disclosed simplification, docs/MANAGEMENT_REPORTING.md section A).
 * A measure whose COGS/production cost inputs are still provisional
 * (Phase 11/21 costing not yet finalized) reports `freshness:
 * 'PRELIMINARY'` (spec sections 16, 26) rather than silently presenting
 * a number indistinguishable from a final one.
 */
@Injectable()
export class ManagementMeasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costing: InventoryCostingService,
    private readonly mapping: AccountingMappingService,
  ) {}

  async evaluate(tenantId: string, organizationId: string, measureCode: string, mode: MeasureMode, filters: MeasureFilters = {}): Promise<MeasureResult> {
    switch (measureCode) {
      case 'GROSS_REVENUE':
        return this.salesLineAggregate(tenantId, organizationId, mode, filters, 'lineTotal', 1);
      case 'SALES_RETURN':
        return this.salesReturnAggregate(tenantId, organizationId, mode, filters, 'returnNet');
      case 'NET_REVENUE': {
        const gross = await this.evaluate(tenantId, organizationId, 'GROSS_REVENUE', mode, filters);
        const returns = await this.evaluate(tenantId, organizationId, 'SALES_RETURN', mode, filters);
        return { value: gross.value.minus(returns.value), freshness: 'FINAL', sourceCount: gross.sourceCount + returns.sourceCount };
      }
      case 'SALES_QTY': {
        const gross = await this.salesLineAggregate(tenantId, organizationId, mode, filters, 'quantity', 1);
        const returned = await this.salesReturnAggregate(tenantId, organizationId, mode, filters, 'quantity');
        return { value: gross.value.minus(returned.value), freshness: 'FINAL', sourceCount: gross.sourceCount + returned.sourceCount };
      }
      case 'COGS':
        return this.cogsAggregate(tenantId, organizationId, mode, filters);
      case 'GROSS_PROFIT': {
        const revenue = await this.evaluate(tenantId, organizationId, 'NET_REVENUE', mode, filters);
        const cogs = await this.evaluate(tenantId, organizationId, 'COGS', mode, filters);
        return { value: revenue.value.minus(cogs.value), freshness: cogs.freshness, sourceCount: revenue.sourceCount + cogs.sourceCount };
      }
      case 'GROSS_MARGIN_PCT': {
        const revenue = await this.evaluate(tenantId, organizationId, 'NET_REVENUE', mode, filters);
        const profit = await this.evaluate(tenantId, organizationId, 'GROSS_PROFIT', mode, filters);
        if (revenue.value.eq(0)) return { value: new Decimal(0), freshness: profit.freshness, sourceCount: 0 }; // spec section 25/209 — safe zero-revenue handling
        return { value: profit.value.div(revenue.value).mul(100), freshness: profit.freshness, sourceCount: profit.sourceCount };
      }
      case 'AR_BALANCE':
        return this.openItemBalance(tenantId, organizationId, 'AR', mode, filters);
      case 'AP_BALANCE':
        return this.openItemBalance(tenantId, organizationId, 'AP', mode, filters);
      case 'INVENTORY_VALUE':
        return this.inventoryValue(tenantId, organizationId, mode, filters);
      case 'WIP_VALUE':
        return this.wipValue(tenantId, organizationId, mode);
      case 'CASH_BALANCE':
        return this.glBalance(tenantId, organizationId, [MappingKeys.CASH, MappingKeys.BANK], mode);
      case 'LABOR_COST':
        return this.laborCost(tenantId, organizationId, mode, filters);
      case 'OPERATING_EXPENSE':
        return this.glMovement(tenantId, organizationId, [MappingKeys.ADMIN_EXPENSE, MappingKeys.OTHER_OPERATING_EXPENSE], mode);
      case 'HEADCOUNT':
        return this.headcount(tenantId, organizationId, mode, filters);
      default:
        throw new ValidationAppError(`Unknown or unsupported canonical measure: ${measureCode}`);
    }
  }

  /** Formula-defined measures (e.g. CONTRIBUTION_MARGIN, DIRECT_EXPENSE)
   * are evaluated by the caller (`ManagementMeasureDefinitionService`)
   * combining already-resolved base measures via the SAME tiny formula
   * engine Phase 23 built for report rows — reused across modules
   * rather than reimplemented (docs/MANAGEMENT_REPORTING.md section B). */

  private dateFilter(mode: MeasureMode): { gte?: Date; lte: Date } {
    return mode.type === 'AS_OF' ? { lte: mode.asOfDate } : { gte: mode.periodStart, lte: mode.periodEnd };
  }

  private async salesLineAggregate(tenantId: string, organizationId: string, mode: MeasureMode, filters: MeasureFilters, field: 'lineTotal' | 'quantity', sign: 1 | -1): Promise<MeasureResult> {
    if (mode.type === 'AS_OF') throw new ValidationAppError('GROSS_REVENUE/SALES_QTY are period measures, not as-of measures');
    const lines = await this.prisma.salesInvoiceLine.findMany({
      where: { tenantId, salesInvoice: { organizationId, documentDate: this.dateFilter(mode), postingStatus: 'POSTED', ...(filters.customerId ? { counterpartyId: filters.customerId } : {}) }, ...(filters.productId ? { productId: filters.productId } : {}) },
      select: { [field]: true },
    });
    const total = lines.reduce((s, l) => s.plus(new Decimal((l as unknown as Record<string, Decimal>)[field].toString())), new Decimal(0)).mul(sign);
    return { value: total, freshness: 'FINAL', sourceCount: lines.length };
  }

  private async salesReturnAggregate(tenantId: string, organizationId: string, mode: MeasureMode, filters: MeasureFilters, field: 'returnNet' | 'quantity'): Promise<MeasureResult> {
    if (mode.type === 'AS_OF') throw new ValidationAppError('SALES_RETURN is a period measure, not an as-of measure');
    const lines = await this.prisma.salesReturnLine.findMany({
      where: { tenantId, salesReturn: { organizationId, documentDate: this.dateFilter(mode), postingStatus: 'POSTED', ...(filters.customerId ? { counterpartyId: filters.customerId } : {}) }, ...(filters.productId ? { productId: filters.productId } : {}) },
      select: { [field]: true },
    });
    const total = lines.reduce((s, l) => s.plus(new Decimal((l as unknown as Record<string, Decimal>)[field].toString())), new Decimal(0));
    return { value: total, freshness: 'FINAL', sourceCount: lines.length };
  }

  private async cogsAggregate(tenantId: string, organizationId: string, mode: MeasureMode, filters: MeasureFilters): Promise<MeasureResult> {
    if (mode.type === 'AS_OF') throw new ValidationAppError('COGS is a period measure, not an as-of measure');
    const lines = await this.prisma.salesInvoiceLine.findMany({
      where: { tenantId, salesInvoice: { organizationId, documentDate: this.dateFilter(mode), postingStatus: 'POSTED', ...(filters.customerId ? { counterpartyId: filters.customerId } : {}) }, ...(filters.productId ? { productId: filters.productId } : {}) },
      select: { id: true },
    });
    let total = new Decimal(0);
    let anyProvisional = false;
    for (const line of lines) {
      const cogs = await this.costing.getCOGSForLine(tenantId, 'SALES_INVOICE', line.id);
      if (cogs === null) { anyProvisional = true; continue; }
      total = total.plus(cogs);
    }
    return { value: total, freshness: anyProvisional ? 'PRELIMINARY' : 'FINAL', sourceCount: lines.length };
  }

  /** AR/AP balance is inherently "as of now" in this build — the
   * settlement subledger keeps no historical daily-balance snapshot
   * table, so `mode` is accepted for interface consistency but not
   * applied here (disclosed, docs/MANAGEMENT_REPORTING.md section C). */
  private async openItemBalance(tenantId: string, organizationId: string, side: 'AR' | 'AP', mode: MeasureMode, filters: MeasureFilters): Promise<MeasureResult> {
    void mode;
    if (side === 'AR') {
      const agg = await this.prisma.settlementObligation.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] }, ...(filters.customerId ? { counterpartyId: filters.customerId } : {}) }, _sum: { remainingAmount: true }, _count: true });
      return { value: new Decimal((agg._sum.remainingAmount ?? 0).toString()), freshness: 'FINAL', sourceCount: agg._count };
    }
    const agg = await this.prisma.supplierPayable.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] }, ...(filters.supplierId ? { counterpartyId: filters.supplierId } : {}) }, _sum: { remainingAmount: true }, _count: true });
    return { value: new Decimal((agg._sum.remainingAmount ?? 0).toString()), freshness: 'FINAL', sourceCount: agg._count };
  }

  private async inventoryValue(tenantId: string, organizationId: string, mode: MeasureMode, filters: MeasureFilters): Promise<MeasureResult> {
    const asOf = mode.type === 'AS_OF' ? mode.asOfDate : mode.periodEnd;
    const layers = await this.prisma.inventoryCostLayer.findMany({ where: { tenantId, organizationId, status: { not: 'REVERSED' }, receiptDate: { lte: asOf }, ...(filters.productId ? { productId: filters.productId } : {}), ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}) }, select: { currentRemainingValue: true } });
    const value = layers.reduce((s, l) => s.plus(l.currentRemainingValue.toString()), new Decimal(0));
    return { value, freshness: 'FINAL', sourceCount: layers.length };
  }

  private async wipValue(tenantId: string, organizationId: string, mode: MeasureMode): Promise<MeasureResult> {
    const asOf = mode.type === 'AS_OF' ? mode.asOfDate : mode.periodEnd;
    const agg = await this.prisma.productionCostMovement.aggregate({ where: { tenantId, organizationId, reversed: false, effectiveDate: { lte: asOf } }, _sum: { costIn: true, costOut: true }, _count: true });
    const value = new Decimal((agg._sum.costIn ?? 0).toString()).minus(new Decimal((agg._sum.costOut ?? 0).toString()));
    return { value, freshness: 'FINAL', sourceCount: agg._count };
  }

  private async glBalance(tenantId: string, organizationId: string, mappingKeys: string[], mode: MeasureMode): Promise<MeasureResult> {
    const asOf = mode.type === 'AS_OF' ? mode.asOfDate : mode.periodEnd;
    let total = new Decimal(0);
    let count = 0;
    for (const key of mappingKeys) {
      try {
        const account = await this.mapping.resolve(tenantId, organizationId, key, asOf);
        const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId: account.id, businessDate: { lte: asOf } }, _sum: { amountBase: true }, _count: { _all: true } });
        const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
        const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
        total = total.plus(debit.minus(credit));
        count += agg.reduce((s, r) => s + r._count._all, 0);
      } catch {
        // No mapping configured — contributes zero.
      }
    }
    return { value: total, freshness: 'FINAL', sourceCount: count };
  }

  private async glMovement(tenantId: string, organizationId: string, mappingKeys: string[], mode: MeasureMode): Promise<MeasureResult> {
    if (mode.type === 'AS_OF') throw new ValidationAppError('OPERATING_EXPENSE is a period measure, not an as-of measure');
    let total = new Decimal(0);
    let count = 0;
    for (const key of mappingKeys) {
      try {
        const account = await this.mapping.resolve(tenantId, organizationId, key, mode.periodEnd);
        const agg = await this.prisma.accountingMovement.groupBy({ by: ['side'], where: { tenantId, organizationId, accountId: account.id, businessDate: { gte: mode.periodStart, lte: mode.periodEnd } }, _sum: { amountBase: true }, _count: { _all: true } });
        const debit = new Decimal((agg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
        const credit = new Decimal((agg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
        total = total.plus(debit.minus(credit));
        count += agg.reduce((s, r) => s + r._count._all, 0);
      } catch {
        // No mapping configured — contributes zero.
      }
    }
    return { value: total, freshness: 'FINAL', sourceCount: count };
  }

  private async laborCost(tenantId: string, organizationId: string, mode: MeasureMode, filters: MeasureFilters): Promise<MeasureResult> {
    if (mode.type === 'AS_OF') throw new ValidationAppError('LABOR_COST is a period measure, not an as-of measure');
    let employmentIds: string[] | undefined;
    if (filters.departmentId) {
      const assignments = await this.prisma.employeeAssignment.findMany({ where: { tenantId, organizationId, departmentId: filters.departmentId, effectiveTo: null }, select: { employmentId: true } });
      employmentIds = assignments.map((a) => a.employmentId);
    }
    const lines = await this.prisma.payrollResultLine.findMany({
      where: { tenantId, lineType: 'EARNING', result: { organizationId, status: { not: 'SUPERSEDED' }, ...(employmentIds ? { employmentId: { in: employmentIds } } : {}), period: { periodStart: { gte: mode.periodStart }, periodEnd: { lte: mode.periodEnd } } } },
      select: { amount: true },
    });
    const total = lines.reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    return { value: total, freshness: 'FINAL', sourceCount: lines.length };
  }

  private async headcount(tenantId: string, organizationId: string, mode: MeasureMode, filters: MeasureFilters): Promise<MeasureResult> {
    const asOf = mode.type === 'AS_OF' ? mode.asOfDate : mode.periodEnd;
    if (filters.departmentId) {
      // As-of departmental headcount from the effective-dated assignment
      // history (spec section 73) — never the current live count.
      const count = await this.prisma.employeeAssignment.count({ where: { tenantId, organizationId, departmentId: filters.departmentId, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] } });
      return { value: new Decimal(count), freshness: 'FINAL', sourceCount: count };
    }
    const count = await this.prisma.employment.count({ where: { tenantId, organizationId, employmentStatus: 'ACTIVE' } });
    return { value: new Decimal(count), freshness: 'FINAL', sourceCount: count };
  }
}
