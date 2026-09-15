import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';

export interface VarianceResult {
  actual: string;
  comparator: string;
  variance: string;
  variancePct: string | null;
  favorability: 'FAVORABLE' | 'UNFAVORABLE' | 'NEUTRAL';
}

const REVENUE_LIKE_MEASURES = new Set(['GROSS_REVENUE', 'NET_REVENUE', 'GROSS_PROFIT', 'SALES_QTY']);

/**
 * VarianceAnalysisService (docx spec Phase 24, sections 92-93, 116-119).
 * Favorable/unfavorable is measure-semantics-driven (spec section 93) —
 * a revenue-like measure exceeding its comparator is FAVORABLE, an
 * expense-like measure exceeding its comparator is UNFAVORABLE; this is
 * hard-coded off a small curated list rather than reading each
 * measure's own `signPolicy`, which governs presentation sign, not
 * favorability semantics (disclosed simplification,
 * docs/MANAGEMENT_REPORTING.md section K). The variance BRIDGE (spec
 * section 118 — Volume/Price/Mix/Cost decomposition) is not
 * implemented as an automated calculation in this build; only the
 * simple actual-vs-comparator variance is (disclosed, section K).
 */
@Injectable()
export class VarianceAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async actualVsBudget(tenantId: string, organizationId: string, budgetVersionId: string, period: string, measureCode: string, mode: MeasureMode, filters: { departmentId?: string; costCenterId?: string; projectId?: string } = {}): Promise<VarianceResult> {
    const actual = await this.measures.evaluate(tenantId, organizationId, measureCode, mode, filters);
    const budgetAgg = await this.prisma.budgetFact.aggregate({ where: { tenantId, budgetVersionId, period, measureCode, ...filters }, _sum: { amount: true } });
    return this.buildResult(actual.value, new Decimal((budgetAgg._sum.amount ?? 0).toString()), measureCode);
  }

  async actualVsForecast(tenantId: string, organizationId: string, forecastVersionId: string, period: string, measureCode: string, mode: MeasureMode): Promise<VarianceResult> {
    const actual = await this.measures.evaluate(tenantId, organizationId, measureCode, mode);
    const forecastAgg = await this.prisma.forecastFact.aggregate({ where: { tenantId, forecastVersionId, period, measureCode }, _sum: { amount: true } });
    return this.buildResult(actual.value, new Decimal((forecastAgg._sum.amount ?? 0).toString()), measureCode);
  }

  async currentVsPrior(tenantId: string, organizationId: string, measureCode: string, currentMode: MeasureMode, priorMode: MeasureMode): Promise<VarianceResult> {
    const current = await this.measures.evaluate(tenantId, organizationId, measureCode, currentMode);
    const prior = await this.measures.evaluate(tenantId, organizationId, measureCode, priorMode);
    return this.buildResult(current.value, prior.value, measureCode);
  }

  private buildResult(actual: Decimal, comparator: Decimal, measureCode: string): VarianceResult {
    const variance = actual.minus(comparator);
    const variancePct = comparator.eq(0) ? null : variance.div(comparator.abs()).mul(100); // spec section 117 — no infinite%/crash on zero baseline
    const isRevenueLike = REVENUE_LIKE_MEASURES.has(measureCode);
    const favorability: VarianceResult['favorability'] = variance.eq(0) ? 'NEUTRAL' : (variance.gt(0)) === isRevenueLike ? 'FAVORABLE' : 'UNFAVORABLE';
    return { actual: actual.toFixed(2), comparator: comparator.toFixed(2), variance: variance.toFixed(2), variancePct: variancePct?.toFixed(2) ?? null, favorability };
  }
}
