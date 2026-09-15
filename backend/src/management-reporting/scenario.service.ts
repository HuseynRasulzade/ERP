import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * ScenarioService (docx spec Phase 24, sections 99-104). Applies
 * `ScenarioAssumption` perturbations to already-resolved ACTUAL measure
 * values and stores the result as a `ScenarioResult` row — NEVER
 * touches actual data (spec sections 101, 215's own critical rule:
 * "Actual data-nı scenario ilə mutate etmə"). Dependency between
 * assumptions (spec section 103 — e.g. a volume assumption affecting
 * both Revenue and COGS) is handled by applying every assumption whose
 * `measureCode` matches the requested measure, compounding multiple
 * PERCENT assumptions multiplicatively and ABSOLUTE assumptions
 * additively, in the order they were created — a simple, disclosed
 * dependency model rather than a full DAG across derived measures
 * (docs/MANAGEMENT_REPORTING.md section J).
 */
@Injectable()
export class ScenarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async create(tenantId: string, dto: { code: string; name: string; scenarioType?: string; baseScenario?: string }) {
    return this.prisma.managementScenario.create({ data: { tenantId, code: dto.code, name: dto.name, scenarioType: dto.scenarioType ?? 'CUSTOM', baseScenario: dto.baseScenario ?? 'ACTUAL' } });
  }

  async addAssumptionByCode(tenantId: string, scenarioCode: string, dto: { measureCode: string; adjustmentType?: string; adjustmentValue: number; description?: string }) {
    const scenario = await this.prisma.managementScenario.findFirstOrThrow({ where: { tenantId, code: scenarioCode } });
    return this.addAssumption(tenantId, scenario.id, dto);
  }

  async addAssumption(tenantId: string, scenarioId: string, dto: { measureCode: string; adjustmentType?: string; adjustmentValue: number; description?: string }) {
    return this.prisma.scenarioAssumption.create({ data: { tenantId, scenarioId, measureCode: dto.measureCode, adjustmentType: dto.adjustmentType ?? 'PERCENT', adjustmentValue: dto.adjustmentValue, description: dto.description } });
  }

  /** What-if calculation (spec sections 101-102) — reads ACTUAL via
   * `ManagementMeasureService`, applies this scenario's own assumptions
   * for `measureCode`, and persists the base-vs-scenario pair. Retrying
   * the same request for the same (scenario, org, period, measure)
   * replaces the prior result rather than duplicating it (spec section
   * 148). */
  async calculate(tenantId: string, userId: string, scenarioCode: string, organizationId: string, mode: MeasureMode, period: string, measureCode: string) {
    const scenario = await this.prisma.managementScenario.findFirst({ where: { tenantId, code: scenarioCode } });
    if (!scenario) throw new NotFoundAppError('ManagementScenario', scenarioCode);

    const base = await this.measures.evaluate(tenantId, organizationId, measureCode, mode);
    const assumptions = await this.prisma.scenarioAssumption.findMany({ where: { tenantId, scenarioId: scenario.id, measureCode }, orderBy: { id: 'asc' } });

    let scenarioValue = base.value;
    for (const assumption of assumptions) {
      const adjustment = new Decimal(assumption.adjustmentValue.toString());
      scenarioValue = assumption.adjustmentType === 'PERCENT' ? scenarioValue.mul(new Decimal(1).plus(adjustment.div(100))) : scenarioValue.plus(adjustment);
    }

    const existing = await this.prisma.scenarioResult.findFirst({ where: { tenantId, scenarioId: scenario.id, organizationId, period, measureCode } });
    const result = existing
      ? await this.prisma.scenarioResult.update({ where: { id: existing.id }, data: { baseValue: base.value.toString(), scenarioValue: scenarioValue.toString() } })
      : await this.prisma.scenarioResult.create({ data: { tenantId, scenarioId: scenario.id, organizationId, period, measureCode, baseValue: base.value.toString(), scenarioValue: scenarioValue.toString() } });

    await this.audit.record({ tenantId, eventType: 'SCENARIO_CALCULATED', entityType: 'ManagementScenario', entityId: scenario.id, action: 'UPDATE', userId, newValues: { measureCode, period, baseValue: base.value.toString(), scenarioValue: scenarioValue.toString() } });
    return result;
  }
}
