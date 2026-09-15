import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ManagementMeasureService, MeasureMode } from './management-measure.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * ForecastService (docx spec Phase 24, sections 94-98). Every publish
 * creates a brand-NEW `ManagementForecastVersion` (FC1, FC2, ...) —
 * publishing FC2 never overwrites FC1 (spec section 95, tested by
 * section 200). "Actual + Forecast = Latest Estimate" combines actual
 * measures (via `ManagementMeasureService`, canonical) with the
 * forecast facts for the remaining months of the fiscal year — never
 * blending forecast INTO the actual data itself (spec section 91).
 */
@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly measures: ManagementMeasureService,
  ) {}

  async createVersion(tenantId: string, userId: string, dto: { organizationId: string; fiscalYear: number; code: string }) {
    const existing = await this.prisma.managementForecastVersion.findFirst({ where: { tenantId, organizationId: dto.organizationId, fiscalYear: dto.fiscalYear, code: dto.code } });
    if (existing) throw new ValidationAppError(`Forecast version ${dto.code} already exists for FY${dto.fiscalYear} (spec section 95 — never overwrite).`);
    return this.prisma.managementForecastVersion.create({ data: { tenantId, organizationId: dto.organizationId, fiscalYear: dto.fiscalYear, code: dto.code, status: 'DRAFT', createdBy: userId } });
  }

  async setFact(tenantId: string, forecastVersionId: string, dto: { period: string; departmentId?: string; costCenterId?: string; projectId?: string; measureCode: string; amount: number }) {
    const version = await this.getVersion(tenantId, forecastVersionId);
    if (version.status === 'PUBLISHED') throw new ValidationAppError('Cannot edit a published forecast version — create a new one (spec section 95).');
    await this.prisma.forecastFact.deleteMany({ where: { tenantId, forecastVersionId, period: dto.period, departmentId: dto.departmentId ?? null, costCenterId: dto.costCenterId ?? null, projectId: dto.projectId ?? null, measureCode: dto.measureCode } });
    return this.prisma.forecastFact.create({ data: { tenantId, forecastVersionId, period: dto.period, departmentId: dto.departmentId, costCenterId: dto.costCenterId, projectId: dto.projectId, measureCode: dto.measureCode, amount: dto.amount } });
  }

  async publish(tenantId: string, userId: string, forecastVersionId: string) {
    const version = await this.getVersion(tenantId, forecastVersionId);
    const updated = await this.prisma.managementForecastVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: userId } });
    await this.audit.record({ tenantId, eventType: 'FORECAST_VERSION_PUBLISHED', entityType: 'ManagementForecastVersion', entityId: version.id, action: 'UPDATE', userId, newValues: { code: version.code } });
    return updated;
  }

  /** Jan-Aug Actual + Sep-Dec Forecast = FY Latest Estimate (spec
   * section 98). `actualThroughMonth` (1-12) marks the boundary. */
  async latestEstimate(tenantId: string, organizationId: string, forecastVersionId: string, fiscalYear: number, measureCode: string, actualThroughMonth: number) {
    const actualPeriodStart = new Date(Date.UTC(fiscalYear, 0, 1));
    const actualPeriodEnd = new Date(Date.UTC(fiscalYear, actualThroughMonth, 0));
    const actualMode: MeasureMode = { type: 'PERIOD', periodStart: actualPeriodStart, periodEnd: actualPeriodEnd };
    const actual = await this.measures.evaluate(tenantId, organizationId, measureCode, actualMode);

    const forecastPeriods: string[] = [];
    for (let m = actualThroughMonth + 1; m <= 12; m++) forecastPeriods.push(`${fiscalYear}-${String(m).padStart(2, '0')}`);
    const forecastAgg = await this.prisma.forecastFact.aggregate({ where: { tenantId, forecastVersionId, period: { in: forecastPeriods }, measureCode }, _sum: { amount: true } });
    const forecastRemaining = new Decimal((forecastAgg._sum.amount ?? 0).toString());

    return { actualToDate: actual.value.toFixed(2), forecastRemaining: forecastRemaining.toFixed(2), latestEstimate: actual.value.plus(forecastRemaining).toFixed(2) };
  }

  private async getVersion(tenantId: string, id: string) {
    const version = await this.prisma.managementForecastVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundAppError('ManagementForecastVersion', id);
    return version;
  }
}
