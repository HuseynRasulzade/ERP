import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface CostCenterPnLRow {
  costCenterId: string;
  directCost: string;
  allocatedIn: string;
  allocatedOut: string;
  netCost: string;
}

export interface ProjectPnLRow {
  projectId: string;
  revenue: string;
  directMaterial: string;
  directLabor: string;
  otherDirectCost: string;
  contribution: string;
}

/**
 * CostCenterReportingService + ProjectProfitabilityService (docx spec
 * Phase 24, sections 40-43) combined into one file — both read the SAME
 * dimensioned `AccountingMovement`/Phase 20 allocation tables, just
 * grouped by a different soft-reference dimension (`costCenterId` vs
 * `projectId`), so splitting them into two classes would only duplicate
 * the aggregation plumbing. `Project` has no dedicated master table in
 * this codebase (`projectId` is a soft reference everywhere, per
 * Phase 17/20's own established convention) — Project P&L groups by the
 * raw id string (disclosed, docs/MANAGEMENT_REPORTING.md section E).
 */
@Injectable()
export class CostCenterProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async costCenterPnL(tenantId: string, organizationId: string, costCenterId: string, periodStart: Date, periodEnd: Date): Promise<CostCenterPnLRow> {
    const costCenterDimensionId = await this.resolveDimensionId(tenantId, 'COST_CENTER');
    const directAgg = costCenterDimensionId
      ? await this.prisma.accountingMovement.groupBy({
          by: ['side'],
          where: { tenantId, organizationId, businessDate: { gte: periodStart, lte: periodEnd }, dimensions: { some: { dimensionDefinitionId: costCenterDimensionId, referenceId: costCenterId } } },
          _sum: { amountBase: true },
        })
      : [];
    const debit = new Decimal((directAgg.find((r) => r.side === 'DEBIT')?._sum.amountBase ?? 0).toString());
    const credit = new Decimal((directAgg.find((r) => r.side === 'CREDIT')?._sum.amountBase ?? 0).toString());
    const directCost = debit.minus(credit);

    const allocatedInAgg = await this.prisma.costAllocationRunLine.aggregate({ where: { tenantId, targetCostCenterId: costCenterId, run: { organizationId, period: { gte: periodStart, lte: periodEnd }, status: 'POSTED' } }, _sum: { amount: true } });
    const allocatedIn = new Decimal((allocatedInAgg._sum.amount ?? 0).toString());

    const sourceRuns = await this.prisma.costAllocationRun.findMany({ where: { tenantId, organizationId, period: { gte: periodStart, lte: periodEnd }, status: 'POSTED', rule: { sourceCostCenterId: costCenterId } }, select: { allocatedAmount: true } });
    const allocatedOut = sourceRuns.reduce((s, r) => s.plus(r.allocatedAmount.toString()), new Decimal(0)).neg();

    return { costCenterId, directCost: directCost.toFixed(2), allocatedIn: allocatedIn.toFixed(2), allocatedOut: allocatedOut.toFixed(2), netCost: directCost.plus(allocatedIn).plus(allocatedOut).toFixed(2) };
  }

  /** Direct material (production/purchase issues tagged to the
   * project), direct labor (payroll/time-input tagged to the project),
   * and other direct cost (expense claims) — all via the SAME
   * `AccountingMovement` dimension the rest of this codebase already
   * writes when a document carries a `projectId` (spec section 41). */
  async projectPnL(tenantId: string, organizationId: string, projectId: string, periodStart: Date, periodEnd: Date): Promise<ProjectPnLRow> {
    const projectDimensionId = await this.resolveDimensionId(tenantId, 'PROJECT');
    const movements = projectDimensionId
      ? await this.prisma.accountingMovement.findMany({
          where: { tenantId, organizationId, businessDate: { gte: periodStart, lte: periodEnd }, dimensions: { some: { dimensionDefinitionId: projectDimensionId, referenceId: projectId } } },
          include: { account: { select: { accountClass: true } } },
        })
      : [];

    let revenue = new Decimal(0);
    let directMaterial = new Decimal(0);
    let directLabor = new Decimal(0);
    let otherDirectCost = new Decimal(0);
    for (const m of movements) {
      const signed = m.side === 'CREDIT' ? new Decimal(m.amountBase.toString()) : new Decimal(m.amountBase.toString()).neg();
      if (m.account.accountClass === 'REVENUE') revenue = revenue.plus(signed.neg());
      else if (m.account.accountClass === 'EXPENSE') otherDirectCost = otherDirectCost.plus(signed.neg());
    }
    // Material/labor split requires a cost-component tag this build's
    // AccountingMovement dimension model does not carry — both are
    // currently pooled into `otherDirectCost` (disclosed simplification,
    // docs/MANAGEMENT_REPORTING.md section E).
    void directMaterial;
    void directLabor;

    const contribution = revenue.minus(otherDirectCost);
    return { projectId, revenue: revenue.toFixed(2), directMaterial: directMaterial.toFixed(2), directLabor: directLabor.toFixed(2), otherDirectCost: otherDirectCost.toFixed(2), contribution: contribution.toFixed(2) };
  }

  /** Dimension codes (e.g. 'COST_CENTER', 'PROJECT') are stored as
   * `AccountingDimensionDefinition.code`; `AccountingMovementDimension`
   * itself keys by the definition's UUID, so every dimension-scoped
   * query must resolve the code first. Returns null if the tenant has
   * never had this dimension seeded — callers then correctly report
   * zero rather than erroring. */
  private async resolveDimensionId(tenantId: string, code: string): Promise<string | null> {
    const definition = await this.prisma.accountingDimensionDefinition.findFirst({ where: { code, OR: [{ tenantId }, { tenantId: null }] } });
    return definition?.id ?? null;
  }
}
