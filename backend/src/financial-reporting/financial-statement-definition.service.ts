import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FinancialStatementDefinitionService (docx spec Phase 23, sections
 * 9-12). Definitions (TRIAL_BALANCE/BALANCE_SHEET/PROFIT_AND_LOSS/
 * CASH_FLOW/CHANGES_IN_EQUITY/...) are versioned exactly like the
 * framework — activating a version freezes its row structure so a
 * layout change never mutates an already-generated historical report
 * (spec section 10, 146).
 */
@Injectable()
export class FinancialStatementDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { code: string; name: string; statementType: string }) {
    const definition = await this.prisma.financialStatementDefinition.create({ data: { tenantId, code: dto.code, name: dto.name, statementType: dto.statementType, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'FIN_STATEMENT_DEFINITION_CREATED', entityType: 'FinancialStatementDefinition', entityId: definition.id, action: 'CREATE', userId, newValues: { code: dto.code, statementType: dto.statementType } });
    return definition;
  }

  async createVersion(tenantId: string, userId: string, statementDefinitionId: string, dto: { effectiveFrom: string; effectiveTo?: string; frameworkVersionId?: string }) {
    const latest = await this.prisma.financialStatementVersion.findFirst({ where: { tenantId, statementDefinitionId }, orderBy: { version: 'desc' } });
    const version = await this.prisma.financialStatementVersion.create({
      data: { tenantId, statementDefinitionId, frameworkVersionId: dto.frameworkVersionId, version: (latest?.version ?? 0) + 1, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined, status: 'DRAFT', createdBy: userId },
    });
    return version;
  }

  async addRow(
    tenantId: string,
    statementVersionId: string,
    dto: { rowCode: string; parentRowId?: string; label: string; rowType?: string; sequence?: number; level?: number; signPolicy?: string; formula?: string; mappingGroup?: string; displayZeroPolicy?: string; drilldownEnabled?: boolean; notesReference?: string },
  ) {
    return this.prisma.financialReportRowDefinition.create({
      data: {
        tenantId,
        statementVersionId,
        rowCode: dto.rowCode,
        parentRowId: dto.parentRowId,
        label: dto.label,
        rowType: dto.rowType ?? 'DATA',
        sequence: dto.sequence ?? 0,
        level: dto.level ?? 0,
        signPolicy: dto.signPolicy ?? 'AS_IS',
        formula: dto.formula,
        mappingGroup: dto.mappingGroup,
        displayZeroPolicy: dto.displayZeroPolicy ?? 'SHOW',
        drilldownEnabled: dto.drilldownEnabled ?? true,
        notesReference: dto.notesReference,
      },
    });
  }

  async activateVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.getVersion(tenantId, versionId);
    if (version.status !== 'DRAFT') throw new ValidationAppError(`Cannot activate from status ${version.status}`);
    const updated = await this.prisma.financialStatementVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE' } });
    await this.audit.record({ tenantId, eventType: 'FIN_STATEMENT_VERSION_ACTIVATED', entityType: 'FinancialStatementVersion', entityId: version.id, action: 'UPDATE', userId });
    return updated;
  }

  async resolveActiveVersion(tenantId: string, statementDefinitionId: string, asOfDate: Date) {
    const version = await this.prisma.financialStatementVersion.findFirst({
      where: { tenantId, statementDefinitionId, status: 'ACTIVE', effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!version) throw new NotFoundAppError('FinancialStatementVersion', `active as of ${asOfDate.toISOString().slice(0, 10)} for ${statementDefinitionId}`);
    return version;
  }

  rows(tenantId: string, statementVersionId: string) {
    return this.prisma.financialReportRowDefinition.findMany({ where: { tenantId, statementVersionId }, orderBy: { sequence: 'asc' } });
  }

  list(tenantId: string) {
    return this.prisma.financialStatementDefinition.findMany({ where: { tenantId }, include: { versions: true } });
  }

  private async getVersion(tenantId: string, id: string) {
    const version = await this.prisma.financialStatementVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundAppError('FinancialStatementVersion', id);
    return version;
  }
}
