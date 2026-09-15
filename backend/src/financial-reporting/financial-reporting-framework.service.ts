import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * FinancialReportingFrameworkService (docx spec Phase 23, sections 7-8).
 * Core never hard-codes a concrete framework (spec section 7) — callers
 * seed whichever framework codes they need (e.g. `LOCAL_STATUTORY`,
 * `MANAGEMENT_FINANCIAL`) as ordinary rows.
 */
@Injectable()
export class FinancialReportingFrameworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string, dto: { code: string; name: string; frameworkType: string }) {
    const framework = await this.prisma.financialReportingFramework.create({ data: { tenantId, code: dto.code, name: dto.name, frameworkType: dto.frameworkType, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORTING_FRAMEWORK_CREATED', entityType: 'FinancialReportingFramework', entityId: framework.id, action: 'CREATE', userId, newValues: { code: dto.code } });
    return framework;
  }

  async createVersion(tenantId: string, userId: string, frameworkId: string, dto: { effectiveFrom: string; effectiveTo?: string; description?: string }) {
    const latest = await this.prisma.financialReportingFrameworkVersion.findFirst({ where: { tenantId, frameworkId }, orderBy: { version: 'desc' } });
    const version = await this.prisma.financialReportingFrameworkVersion.create({
      data: { tenantId, frameworkId, version: (latest?.version ?? 0) + 1, effectiveFrom: new Date(dto.effectiveFrom), effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined, description: dto.description, status: 'DRAFT', createdBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORTING_FRAMEWORK_VERSION_CREATED', entityType: 'FinancialReportingFrameworkVersion', entityId: version.id, action: 'CREATE', userId, newValues: { version: version.version } });
    return version;
  }

  /** Activating a version freezes it — spec section 8's own "Historical
   * final report istifadə etdiyi framework version-i freeze etməlidir."
   * Once ACTIVE, `FinancialReportMappingService` still allows adding new
   * mappings against it (mappings are independently effective-dated),
   * but this version's own definition (its framework, effective window)
   * never changes again — restatement/correction always creates a NEW
   * version instead. */
  async activate(tenantId: string, userId: string, versionId: string) {
    const version = await this.getVersion(tenantId, versionId);
    if (version.status !== 'DRAFT') throw new ValidationAppError(`Cannot activate from status ${version.status}`);
    const updated = await this.prisma.financialReportingFrameworkVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE', approvedBy: userId, approvedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'FIN_REPORTING_FRAMEWORK_VERSION_ACTIVATED', entityType: 'FinancialReportingFrameworkVersion', entityId: version.id, action: 'UPDATE', userId });
    return updated;
  }

  async resolveActiveVersion(tenantId: string, frameworkId: string, asOfDate: Date) {
    const version = await this.prisma.financialReportingFrameworkVersion.findFirst({
      where: { tenantId, frameworkId, status: 'ACTIVE', effectiveFrom: { lte: asOfDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!version) throw new NotFoundAppError('FinancialReportingFrameworkVersion', `active as of ${asOfDate.toISOString().slice(0, 10)}`);
    return version;
  }

  list(tenantId: string) {
    return this.prisma.financialReportingFramework.findMany({ where: { tenantId }, include: { versions: true } });
  }

  private async getVersion(tenantId: string, id: string) {
    const version = await this.prisma.financialReportingFrameworkVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundAppError('FinancialReportingFrameworkVersion', id);
    return version;
  }
}
