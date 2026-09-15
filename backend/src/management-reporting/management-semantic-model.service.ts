import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { ManagementMeasureService, MeasureMode, MeasureFilters, MeasureResult } from './management-measure.service';
import { FinancialReportFormulaService } from '../financial-reporting/financial-report-formula.service';

/**
 * ManagementSemanticModelService (docx spec Phase 24, sections 3-6).
 * Owns `ManagementSemanticModel`/`Version`/`ManagementMeasureDefinition`
 * governance and is the ONLY place a caller resolves a measure CODE to
 * an actual value — either a canonical measure (dispatched to
 * `ManagementMeasureService`) or a DERIVED/FORMULA measure (evaluated
 * against already-resolved canonical measures via the SAME tiny formula
 * engine Phase 23 built for report rows, reused here rather than
 * reimplemented — spec section 40's own "İKI" reuse principle).
 */
@Injectable()
export class ManagementSemanticModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly measures: ManagementMeasureService,
    private readonly formula: FinancialReportFormulaService,
  ) {}

  async createModel(tenantId: string, userId: string, dto: { code: string; name: string }) {
    const model = await this.prisma.managementSemanticModel.create({ data: { tenantId, code: dto.code, name: dto.name } });
    await this.audit.record({ tenantId, eventType: 'MGMT_SEMANTIC_MODEL_CREATED', entityType: 'ManagementSemanticModel', entityId: model.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return model;
  }

  async createVersion(tenantId: string, userId: string, semanticModelId: string, dto: { effectiveFrom: string; notes?: string }) {
    const latest = await this.prisma.managementSemanticModelVersion.findFirst({ where: { tenantId, semanticModelId }, orderBy: { version: 'desc' } });
    return this.prisma.managementSemanticModelVersion.create({ data: { tenantId, semanticModelId, version: (latest?.version ?? 0) + 1, effectiveFrom: new Date(dto.effectiveFrom), notes: dto.notes, status: 'DRAFT', createdBy: userId } });
  }

  async activateVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.getVersion(tenantId, versionId);
    if (version.status !== 'DRAFT') throw new ValidationAppError(`Cannot activate from status ${version.status}`);
    const measureDefs = await this.prisma.managementMeasureDefinition.findMany({ where: { tenantId, semanticModelVersionId: version.id }, orderBy: { code: 'asc' } });
    const definitionHash = createHash('sha256').update(measureDefs.map((m) => `${m.code}|${m.formula ?? ''}|${m.aggregationType}`).join('\n')).digest('hex');
    const updated = await this.prisma.managementSemanticModelVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE', approvedBy: userId, definitionHash } });
    await this.audit.record({ tenantId, eventType: 'MGMT_SEMANTIC_MODEL_VERSION_ACTIVATED', entityType: 'ManagementSemanticModelVersion', entityId: version.id, action: 'UPDATE', userId });
    return updated;
  }

  async resolveActiveVersion(tenantId: string, semanticModelId: string, asOfDate: Date) {
    const version = await this.prisma.managementSemanticModelVersion.findFirst({
      where: { tenantId, semanticModelId, status: 'ACTIVE', effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!version) throw new NotFoundAppError('ManagementSemanticModelVersion', `active as of ${asOfDate.toISOString().slice(0, 10)}`);
    return version;
  }

  async createMeasure(tenantId: string, semanticModelVersionId: string, dto: { code: string; name: string; sourceFact: string; aggregationType?: string; formula?: string; unit?: string; measureType?: string; signPolicy?: string }) {
    return this.prisma.managementMeasureDefinition.create({
      data: { tenantId, semanticModelVersionId, code: dto.code, name: dto.name, sourceFact: dto.sourceFact, aggregationType: dto.aggregationType ?? 'SUM', formula: dto.formula, unit: dto.unit ?? 'AMOUNT', measureType: dto.measureType ?? 'FINANCIAL', signPolicy: dto.signPolicy ?? 'AS_IS' },
    });
  }

  /** Resolves a measure by code — canonical (dispatched to
   * `ManagementMeasureService`) if not defined in this semantic-model
   * version, or a governed FORMULA measure otherwise (spec section 5's
   * own `formula` field). Formula measures may only reference OTHER
   * measures resolvable this same way — evaluated recursively with the
   * same cycle-checked engine Phase 23 uses for report rows. */
  async resolveMeasure(tenantId: string, organizationId: string, semanticModelVersionId: string, measureCode: string, mode: MeasureMode, filters: MeasureFilters = {}): Promise<MeasureResult> {
    const definition = await this.prisma.managementMeasureDefinition.findFirst({ where: { tenantId, semanticModelVersionId, code: measureCode } });
    if (!definition || definition.aggregationType !== 'FORMULA' || !definition.formula) {
      return this.measures.evaluate(tenantId, organizationId, measureCode, mode, filters);
    }
    const dependencies = this.formula.parseDependencies(definition.formula);
    const resolved = new Map<string, Decimal>();
    let anyPreliminary = false;
    for (const dep of dependencies) {
      const result = await this.resolveMeasure(tenantId, organizationId, semanticModelVersionId, dep, mode, filters);
      resolved.set(dep, result.value);
      if (result.freshness === 'PRELIMINARY') anyPreliminary = true;
    }
    const value = this.formula.evaluate(definition.formula, resolved);
    return { value: definition.signPolicy === 'FLIP' ? value.neg() : value, freshness: anyPreliminary ? 'PRELIMINARY' : 'FINAL', sourceCount: dependencies.length };
  }

  list(tenantId: string) {
    return this.prisma.managementSemanticModel.findMany({ where: { tenantId }, include: { versions: true } });
  }

  private async getVersion(tenantId: string, id: string) {
    const version = await this.prisma.managementSemanticModelVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundAppError('ManagementSemanticModelVersion', id);
    return version;
  }
}
