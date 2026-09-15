import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError, ConcurrencyConflictError } from '../common/errors/app-error';

/**
 * BudgetService (docx spec Phase 24, sections 86-93). `BudgetVersion`
 * uses optimistic locking via `recordVersion` (spec section 149) —
 * every fact write must pass the version it read, or the write is
 * rejected rather than silently overwriting a concurrent edit. Once
 * LOCKED/APPROVED/SUPERSEDED, a version's facts are immutable — a
 * correction always creates the NEXT version (spec section 87's own
 * `version` field, never an in-place edit of a locked one).
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createVersion(tenantId: string, userId: string, dto: { organizationId: string; fiscalYear: number; scenario?: string; baseCurrencyId: string; effectiveFrom?: string; effectiveTo?: string }) {
    const latest = await this.prisma.budgetVersion.findFirst({ where: { tenantId, organizationId: dto.organizationId, fiscalYear: dto.fiscalYear, scenario: dto.scenario ?? 'BUDGET' }, orderBy: { version: 'desc' } });
    const version = await this.prisma.budgetVersion.create({
      data: { tenantId, organizationId: dto.organizationId, fiscalYear: dto.fiscalYear, version: (latest?.version ?? 0) + 1, scenario: dto.scenario ?? 'BUDGET', baseCurrencyId: dto.baseCurrencyId, effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined, effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined, status: 'DRAFT', createdBy: userId },
    });
    if (latest && latest.status !== 'SUPERSEDED') await this.prisma.budgetVersion.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
    await this.audit.record({ tenantId, eventType: 'BUDGET_VERSION_CREATED', entityType: 'BudgetVersion', entityId: version.id, action: 'CREATE', userId, newValues: { fiscalYear: dto.fiscalYear, version: version.version } });
    return version;
  }

  /** `expectedRecordVersion` implements the optimistic lock (spec
   * section 149's own "concurrent draft edit -> conflict, not lost
   * update"). */
  async upsertFact(
    tenantId: string,
    budgetVersionId: string,
    expectedRecordVersion: number,
    dto: { period: string; departmentId?: string; costCenterId?: string; projectId?: string; productGroupId?: string; customerId?: string; measureCode: string; amount: number; quantity?: number },
  ) {
    const version = await this.getVersion(tenantId, budgetVersionId);
    if (version.status === 'LOCKED' || version.status === 'APPROVED' || version.status === 'SUPERSEDED') throw new ValidationAppError(`Budget version ${version.fiscalYear}-V${version.version} is ${version.status} and cannot be edited (spec section 149).`);
    if (version.recordVersion !== expectedRecordVersion) throw new ConcurrencyConflictError();

    await this.prisma.$transaction([
      this.prisma.budgetVersion.update({ where: { id: version.id }, data: { recordVersion: { increment: 1 }, status: version.status === 'DRAFT' ? 'WORKING' : version.status } }),
      this.prisma.budgetFact.deleteMany({ where: { tenantId, budgetVersionId, period: dto.period, departmentId: dto.departmentId ?? null, costCenterId: dto.costCenterId ?? null, projectId: dto.projectId ?? null, customerId: dto.customerId ?? null, measureCode: dto.measureCode } }),
    ]);
    return this.prisma.budgetFact.create({ data: { tenantId, budgetVersionId, period: dto.period, departmentId: dto.departmentId, costCenterId: dto.costCenterId, projectId: dto.projectId, productGroupId: dto.productGroupId, customerId: dto.customerId, measureCode: dto.measureCode, amount: dto.amount, quantity: dto.quantity } });
  }

  async submit(tenantId: string, userId: string, budgetVersionId: string) {
    const version = await this.getVersion(tenantId, budgetVersionId);
    return this.prisma.budgetVersion.update({ where: { id: version.id }, data: { status: 'SUBMITTED' } });
  }

  async approve(tenantId: string, userId: string, budgetVersionId: string) {
    const version = await this.getVersion(tenantId, budgetVersionId);
    if (version.status !== 'SUBMITTED') throw new ValidationAppError(`Cannot approve from status ${version.status}`);
    const updated = await this.prisma.budgetVersion.update({ where: { id: version.id }, data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'BUDGET_VERSION_APPROVED', entityType: 'BudgetVersion', entityId: version.id, action: 'UPDATE', userId });
    return updated;
  }

  async lock(tenantId: string, userId: string, budgetVersionId: string) {
    const version = await this.getVersion(tenantId, budgetVersionId);
    if (version.status !== 'APPROVED') throw new ValidationAppError(`Cannot lock from status ${version.status}`);
    return this.prisma.budgetVersion.update({ where: { id: version.id }, data: { status: 'LOCKED' } });
  }

  async getMeasure(tenantId: string, budgetVersionId: string, period: string, measureCode: string, filters: { departmentId?: string; costCenterId?: string; projectId?: string } = {}) {
    const agg = await this.prisma.budgetFact.aggregate({ where: { tenantId, budgetVersionId, period, measureCode, ...filters }, _sum: { amount: true } });
    return agg._sum.amount ?? 0;
  }

  private async getVersion(tenantId: string, id: string) {
    const version = await this.prisma.budgetVersion.findFirst({ where: { id, tenantId } });
    if (!version) throw new NotFoundAppError('BudgetVersion', id);
    return version;
  }
}
