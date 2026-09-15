import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { KPIService } from './kpi.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * ManagementAlertService (docx spec Phase 24, sections 123-125). Raises
 * insight only — never a workflow/task (spec section 125; corrective
 * approval flows are Phase 26's own extension). `condition` is a small
 * "OPERATOR THRESHOLD" grammar (`LT 15`, `GT 60`, ...) evaluated against
 * either a KPI's actual value or a raw measure value — not arbitrary
 * code (same "no arbitrary executable formula" discipline as Phase 23's
 * formula engine).
 */
@Injectable()
export class ManagementAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KPIService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async createRule(tenantId: string, dto: { code: string; name: string; kpiCode?: string; measureCode?: string; condition: string; severity?: string }) {
    if (!dto.kpiCode && !dto.measureCode) throw new ValidationAppError('An alert rule needs either a kpiCode or a measureCode');
    return this.prisma.managementAlertRule.create({ data: { tenantId, code: dto.code, name: dto.name, kpiCode: dto.kpiCode, measureCode: dto.measureCode, condition: dto.condition, severity: dto.severity ?? 'WARNING' } });
  }

  async evaluate(tenantId: string, organizationId: string, mode: MeasureMode, period: string, dimensionKey?: string) {
    const rules = await this.prisma.managementAlertRule.findMany({ where: { tenantId, active: true } });
    const results = [];
    for (const rule of rules) {
      const actual = rule.kpiCode
        ? (await this.kpi.evaluate(tenantId, organizationId, rule.kpiCode, mode, period)).actual
        : (await this.measures.evaluate(tenantId, organizationId, rule.measureCode!, mode)).value;
      if (actual === null) continue;
      if (this.breaches(actual, rule.condition)) {
        const result = await this.prisma.managementAlertResult.create({ data: { tenantId, ruleId: rule.id, organizationId, period, dimensionKey, actualValue: actual.toString(), severity: rule.severity } });
        results.push(result);
      }
    }
    return results;
  }

  private breaches(actual: Decimal, condition: string): boolean {
    const [operator, thresholdRaw] = condition.trim().split(/\s+/);
    const threshold = new Decimal(thresholdRaw);
    switch (operator) {
      case 'LT': return actual.lt(threshold);
      case 'LTE': return actual.lte(threshold);
      case 'GT': return actual.gt(threshold);
      case 'GTE': return actual.gte(threshold);
      default: return false;
    }
  }

  list(tenantId: string, organizationId: string, period?: string) {
    return this.prisma.managementAlertResult.findMany({ where: { tenantId, organizationId, period }, orderBy: { triggeredAt: 'desc' } });
  }
}
