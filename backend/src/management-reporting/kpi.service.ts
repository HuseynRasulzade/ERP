import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ManagementSemanticModelService } from './management-semantic-model.service';
import { MeasureMode, MeasureFilters } from './management-measure.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface KPIEvaluation {
  code: string;
  actual: Decimal | null;
  target: Decimal | null;
  variance: Decimal | null;
  variancePct: Decimal | null;
  directionality: string;
  status: 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'INFORMATIONAL' | 'NO_TARGET';
  freshness: 'PRELIMINARY' | 'FINAL';
}

/**
 * KPIService (docx spec Phase 24, sections 17-20). A KPI is a
 * numerator/denominator pair (or a formula) over governed measures plus
 * directionality/thresholds — the coloring/status logic lives HERE, not
 * in a frontend widget (spec section 18's own "Dashboard coloring
 * business logic frontend-də hard-code edilməsin").
 */
@Injectable()
export class KPIService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly semanticModel: ManagementSemanticModelService,
  ) {}

  async create(tenantId: string, semanticModelVersionId: string, dto: { code: string; name: string; category?: string; numeratorMeasure: string; denominatorMeasure?: string; formula?: string; unit?: string; directionality?: string; warningThreshold?: number; criticalThreshold?: number; owner?: string; description?: string }) {
    return this.prisma.kPIDefinition.create({
      data: { tenantId, semanticModelVersionId, code: dto.code, name: dto.name, category: dto.category, numeratorMeasure: dto.numeratorMeasure, denominatorMeasure: dto.denominatorMeasure, formula: dto.formula, unit: dto.unit ?? 'PERCENT', directionality: dto.directionality ?? 'HIGHER_IS_BETTER', warningThreshold: dto.warningThreshold, criticalThreshold: dto.criticalThreshold, owner: dto.owner, description: dto.description },
    });
  }

  async setTargetByCode(tenantId: string, kpiCode: string, dto: { organizationId: string; departmentId?: string; productGroupId?: string; period: string; scenario?: string; target: number; minimum?: number; maximum?: number }) {
    const kpi = await this.prisma.kPIDefinition.findFirstOrThrow({ where: { tenantId, code: kpiCode } });
    return this.setTarget(tenantId, kpi.id, dto);
  }

  async setTarget(tenantId: string, kpiDefinitionId: string, dto: { organizationId: string; departmentId?: string; productGroupId?: string; period: string; scenario?: string; target: number; minimum?: number; maximum?: number }) {
    return this.prisma.kPITarget.upsert({
      where: { tenantId_kpiDefinitionId_organizationId_period_scenario: { tenantId, kpiDefinitionId, organizationId: dto.organizationId, period: dto.period, scenario: dto.scenario ?? 'BUDGET' } },
      create: { tenantId, kpiDefinitionId, organizationId: dto.organizationId, departmentId: dto.departmentId, productGroupId: dto.productGroupId, period: dto.period, scenario: dto.scenario ?? 'BUDGET', target: dto.target, minimum: dto.minimum, maximum: dto.maximum },
      update: { target: dto.target, minimum: dto.minimum, maximum: dto.maximum },
    });
  }

  async evaluate(tenantId: string, organizationId: string, kpiCode: string, mode: MeasureMode, period: string, filters: MeasureFilters = {}, scenario = 'BUDGET'): Promise<KPIEvaluation> {
    const kpi = await this.prisma.kPIDefinition.findFirst({ where: { tenantId, code: kpiCode } });
    if (!kpi) throw new NotFoundAppError('KPIDefinition', kpiCode);

    const numerator = await this.semanticModel.resolveMeasure(tenantId, organizationId, kpi.semanticModelVersionId, kpi.numeratorMeasure, mode, filters);
    let actual: Decimal | null;
    let freshness: 'PRELIMINARY' | 'FINAL' = numerator.freshness;
    if (kpi.denominatorMeasure) {
      const denominator = await this.semanticModel.resolveMeasure(tenantId, organizationId, kpi.semanticModelVersionId, kpi.denominatorMeasure, mode, filters);
      if (denominator.freshness === 'PRELIMINARY') freshness = 'PRELIMINARY';
      actual = denominator.value.eq(0) ? null : numerator.value.div(denominator.value).mul(kpi.unit === 'PERCENT' ? 100 : 1); // spec section 72/209 — safe divide-by-zero
    } else {
      actual = numerator.value;
    }

    const targetRow = await this.prisma.kPITarget.findFirst({ where: { tenantId, kpiDefinitionId: kpi.id, organizationId, period, scenario } });
    const target = targetRow ? new Decimal(targetRow.target.toString()) : null;
    const variance = actual !== null && target !== null ? actual.minus(target) : null;
    const variancePct = variance !== null && target !== null && !target.eq(0) ? variance.div(target.abs()).mul(100) : null;

    let status: KPIEvaluation['status'] = 'INFORMATIONAL';
    if (kpi.directionality === 'INFORMATIONAL') status = 'INFORMATIONAL';
    else if (actual === null) status = 'NO_TARGET';
    else if (kpi.criticalThreshold !== null && this.breaches(actual, new Decimal(kpi.criticalThreshold?.toString() ?? '0'), kpi.directionality)) status = 'CRITICAL';
    else if (kpi.warningThreshold !== null && this.breaches(actual, new Decimal(kpi.warningThreshold?.toString() ?? '0'), kpi.directionality)) status = 'WARNING';
    else status = 'ON_TARGET';

    return { code: kpiCode, actual, target, variance, variancePct, directionality: kpi.directionality, status, freshness };
  }

  private breaches(actual: Decimal, threshold: Decimal, directionality: string): boolean {
    if (directionality === 'HIGHER_IS_BETTER') return actual.lt(threshold);
    if (directionality === 'LOWER_IS_BETTER') return actual.gt(threshold);
    return false; // TARGET_RANGE handled via minimum/maximum on the target row, not thresholds
  }

  async snapshot(tenantId: string, userId: string, organizationId: string, kpiCode: string, mode: MeasureMode, period: string, filters: MeasureFilters = {}, scenario = 'BUDGET') {
    const kpi = await this.prisma.kPIDefinition.findFirstOrThrow({ where: { tenantId, code: kpiCode } });
    const evaluation = await this.evaluate(tenantId, organizationId, kpiCode, mode, period, filters, scenario);
    const version = await this.prisma.managementSemanticModelVersion.findUniqueOrThrow({ where: { id: kpi.semanticModelVersionId } });

    const snapshot = await this.prisma.kPIResultSnapshot.create({
      data: {
        tenantId,
        kpiDefinitionId: kpi.id,
        organizationId,
        period,
        dimensions: filters as object,
        actual: evaluation.actual?.toString(),
        target: evaluation.target?.toString(),
        variance: evaluation.variance?.toString(),
        variancePct: evaluation.variancePct?.toString(),
        semanticVersion: version.version,
        sourceFreshness: evaluation.freshness,
      },
    });
    await this.audit.record({ tenantId, eventType: 'KPI_SNAPSHOT_CREATED', entityType: 'KPIResultSnapshot', entityId: snapshot.id, action: 'CREATE', userId, newValues: { kpiCode, period } });
    return snapshot;
  }
}
