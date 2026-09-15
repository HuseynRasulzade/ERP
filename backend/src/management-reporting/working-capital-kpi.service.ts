import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';

export interface WorkingCapitalResult {
  arBalance: string;
  apBalance: string;
  inventoryValue: string;
  operatingWorkingCapital: string;
  dso: string;
  dpo: string;
  dio: string;
  cashConversionCycle: string;
}

/**
 * WorkingCapitalAnalyticsService (docx spec Phase 24, sections 54-67).
 * DSO/DPO/DIO all use the SAME governed methodology (ending balance /
 * period activity × days-in-period, spec section 63's own "must be
 * explicit") so CCC = DIO + DSO - DPO is dimensionally consistent (spec
 * section 65) — never mixes an average-balance DSO with an
 * ending-balance DPO.
 */
@Injectable()
export class WorkingCapitalAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async calculate(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date): Promise<WorkingCapitalResult> {
    const days = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1);
    const asOf: MeasureMode = { type: 'AS_OF', asOfDate: periodEnd };
    const period: MeasureMode = { type: 'PERIOD', periodStart, periodEnd };

    const ar = await this.measures.evaluate(tenantId, organizationId, 'AR_BALANCE', asOf);
    const ap = await this.measures.evaluate(tenantId, organizationId, 'AP_BALANCE', asOf);
    const inventory = await this.measures.evaluate(tenantId, organizationId, 'INVENTORY_VALUE', asOf);
    const netRevenue = await this.measures.evaluate(tenantId, organizationId, 'NET_REVENUE', period);
    const cogs = await this.measures.evaluate(tenantId, organizationId, 'COGS', period);

    const dso = netRevenue.value.eq(0) ? new Decimal(0) : ar.value.div(netRevenue.value).mul(days);
    const dpo = cogs.value.eq(0) ? new Decimal(0) : ap.value.div(cogs.value).mul(days);
    const dio = cogs.value.eq(0) ? new Decimal(0) : inventory.value.div(cogs.value).mul(days);
    const ccc = dio.plus(dso).minus(dpo);
    const owc = ar.value.plus(inventory.value).minus(ap.value);

    return { arBalance: ar.value.toFixed(2), apBalance: ap.value.toFixed(2), inventoryValue: inventory.value.toFixed(2), operatingWorkingCapital: owc.toFixed(2), dso: dso.toFixed(1), dpo: dpo.toFixed(1), dio: dio.toFixed(1), cashConversionCycle: ccc.toFixed(1) };
  }

  /** Inventory Turnover = COGS / Average Inventory (opening/closing
   * average, spec sections 55-56). */
  async inventoryTurnover(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date): Promise<{ turnover: string; averageInventory: string }> {
    const cogs = await this.measures.evaluate(tenantId, organizationId, 'COGS', { type: 'PERIOD', periodStart, periodEnd });
    const opening = await this.measures.evaluate(tenantId, organizationId, 'INVENTORY_VALUE', { type: 'AS_OF', asOfDate: new Date(periodStart.getTime() - 86400000) });
    const closing = await this.measures.evaluate(tenantId, organizationId, 'INVENTORY_VALUE', { type: 'AS_OF', asOfDate: periodEnd });
    const average = opening.value.plus(closing.value).div(2);
    const turnover = average.eq(0) ? new Decimal(0) : cogs.value.div(average);
    return { turnover: turnover.toFixed(2), averageInventory: average.toFixed(2) };
  }

  /** Slow-moving inventory (spec section 58) — policy: no sales
   * movement out of a costing key within `slowMoveDays`. Foundation
   * definition only; category-specific policy overrides are not yet
   * implemented (disclosed, docs/MANAGEMENT_REPORTING.md section G). */
  async slowMovingInventory(tenantId: string, organizationId: string, asOfDate: Date, slowMoveDays = 90) {
    const cutoff = new Date(asOfDate.getTime() - slowMoveDays * 86400000);
    const layers = await this.prisma.inventoryCostLayer.findMany({ where: { tenantId, organizationId, status: { not: 'REVERSED' }, receiptDate: { lte: cutoff }, currentRemainingValue: { gt: 0 } }, select: { productId: true, warehouseId: true, currentRemainingValue: true, receiptDate: true } });
    return layers.map((l) => ({ productId: l.productId, warehouseId: l.warehouseId, value: l.currentRemainingValue.toString(), ageInDays: Math.round((asOfDate.getTime() - l.receiptDate.getTime()) / 86400000) }));
  }
}
