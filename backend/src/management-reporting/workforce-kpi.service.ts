import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';

/**
 * WorkforceAnalyticsService (docx spec Phase 24, sections 72-74).
 * Headcount is always resolved as-of a date from Phase 17's own
 * effective-dated `EmployeeAssignment` history (spec section 73), never
 * the current live employee count. Sensitive-detail access control
 * (spec section 141) is enforced at the CONTROLLER layer via
 * `MGMT_WORKFORCE_COST_VIEW` (aggregate) vs `MGMT_SENSITIVE_DRILLDOWN`
 * (employee-level) — this service itself never filters fields, it
 * exposes only aggregate results by construction (no method here
 * returns a single employee's salary).
 */
@Injectable()
export class WorkforceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async departmentCost(tenantId: string, organizationId: string, departmentId: string, periodStart: Date, periodEnd: Date, netRevenueForRatio?: Decimal) {
    const period: MeasureMode = { type: 'PERIOD', periodStart, periodEnd };
    const asOf: MeasureMode = { type: 'AS_OF', asOfDate: periodEnd };
    const laborCost = await this.measures.evaluate(tenantId, organizationId, 'LABOR_COST', period, { departmentId });
    const headcount = await this.measures.evaluate(tenantId, organizationId, 'HEADCOUNT', asOf, { departmentId });
    const overtimeHours = await this.prisma.overtimeRecord.aggregate({ where: { tenantId, date: { gte: periodStart, lte: periodEnd }, status: 'APPROVED', employment: { organizationId } }, _sum: { approvedHours: true } });

    const laborCostPerHeadcount = headcount.value.eq(0) ? null : laborCost.value.div(headcount.value);
    const revenue = netRevenueForRatio ?? (await this.measures.evaluate(tenantId, organizationId, 'NET_REVENUE', period)).value;
    const revenuePerHeadcount = headcount.value.eq(0) ? null : revenue.div(headcount.value);

    return {
      departmentId,
      headcount: headcount.value.toFixed(0),
      payrollCost: laborCost.value.toFixed(2),
      overtimeHours: (overtimeHours._sum.approvedHours ?? 0).toString(),
      laborCostPerHeadcount: laborCostPerHeadcount?.toFixed(2) ?? null,
      revenuePerHeadcount: revenuePerHeadcount?.toFixed(2) ?? null,
      payrollCostPctRevenue: revenue.eq(0) ? null : laborCost.value.div(revenue).mul(100).toFixed(2),
    };
  }

  /** Absence rate = absence days / (headcount × working days) — a
   * simple foundation definition (spec section 72's own "Absence Rate"),
   * not a full labor-calendar-aware calculation. */
  async absenceRate(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date) {
    const absenceDays = await this.prisma.absenceRecord.count({ where: { tenantId, startDate: { lte: periodEnd }, endDate: { gte: periodStart }, employment: { organizationId } } });
    const headcount = await this.measures.evaluate(tenantId, organizationId, 'HEADCOUNT', { type: 'AS_OF', asOfDate: periodEnd });
    const workingDays = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86400000) + 1);
    const denominator = headcount.value.mul(workingDays);
    return { absenceRatePct: denominator.eq(0) ? null : new Decimal(absenceDays).div(denominator).mul(100).toFixed(2) };
  }
}
