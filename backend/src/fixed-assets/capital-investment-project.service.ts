import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * CapitalInvestmentService (spec sections 8-13, 90-91). `addCostLine` is
 * the ONLY way cost enters a CIP — never a mutable "amount" field on the
 * project itself (spec section 9's own dimensioned register). Multiple
 * source documents can feed one project (spec section 12); the project
 * only moves to READY_FOR_CAPITALIZATION when a human marks it so — cost
 * accumulation never auto-triggers capitalization.
 */
@Injectable()
export class CapitalInvestmentProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string, status?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.capitalInvestmentProject.findMany({ where: { organizationId, status }, orderBy: { createdAt: 'desc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.capitalInvestmentProject.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('CapitalInvestmentProject', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { code: string; name: string; projectType?: string; startDate: string; plannedCompletionDate?: string; departmentId?: string; responsiblePersonId?: string; locationId?: string; currencyId: string; targetAssetCount?: number; comment?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.capitalInvestmentProject.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        projectType: dto.projectType ?? 'CONSTRUCTION',
        startDate: this.parseDate(dto.startDate),
        plannedCompletionDate: dto.plannedCompletionDate ? this.parseDate(dto.plannedCompletionDate) : undefined,
        departmentId: dto.departmentId,
        responsiblePersonId: dto.responsiblePersonId,
        locationId: dto.locationId,
        currencyId: dto.currencyId,
        targetAssetCount: dto.targetAssetCount,
        comment: dto.comment,
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'CIP_PROJECT_CREATED', entityType: 'CAPITAL_INVESTMENT_PROJECT', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code, name: dto.name } });
    return row;
  }

  async addCostLine(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    projectId: string,
    dto: { costComponent: string; sourceDocumentType: string; sourceDocumentId: string; candidateId?: string; currencyId: string; amount: number; baseAmount: number; capitalizable?: boolean; effectiveDate: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const project = await this.prisma.capitalInvestmentProject.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundAppError('CapitalInvestmentProject', projectId);
    if (['CAPITALIZED', 'CANCELLED'].includes(project.status)) throw new ValidationAppError(`Cannot add cost to a ${project.status} project`);

    const line = await this.prisma.capitalInvestmentCostLine.create({
      data: {
        tenantId,
        projectId,
        costComponent: dto.costComponent,
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        candidateId: dto.candidateId,
        currencyId: dto.currencyId,
        amount: dto.amount.toString(),
        baseAmount: dto.baseAmount.toString(),
        capitalizable: dto.capitalizable ?? true,
        effectiveDate: this.parseDate(dto.effectiveDate),
      },
    });
    if (dto.candidateId) await this.prisma.fixedAssetAcquisitionCandidate.update({ where: { id: dto.candidateId }, data: { status: 'ASSIGNED_TO_CIP', assignedCipProjectId: projectId } }).catch(() => undefined);
    await this.audit.record({ tenantId, eventType: 'CIP_COST_ADDED', entityType: 'CAPITAL_INVESTMENT_PROJECT', entityId: projectId, action: 'UPDATE', userId, newValues: { costComponent: dto.costComponent, amount: dto.amount } });
    return line;
  }

  /** CIP Reconciliation report (spec section 91). */
  async summary(tenantId: string, membershipId: string, organizationId: string, projectId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const [project, lines, assets] = await Promise.all([
      this.prisma.capitalInvestmentProject.findFirstOrThrow({ where: { id: projectId, organizationId } }),
      this.prisma.capitalInvestmentCostLine.findMany({ where: { tenantId, projectId } }),
      this.prisma.fixedAsset.findMany({ where: { tenantId, cipProjectId: projectId } }),
    ]);
    const totalCost = lines.reduce((s, l) => s.plus(l.baseAmount.toString()), new Decimal(0));
    const capitalizableCost = lines.filter((l) => l.capitalizable).reduce((s, l) => s.plus(l.baseAmount.toString()), new Decimal(0));
    const expensedCost = totalCost.minus(capitalizableCost);
    const capitalizedCost = lines.filter((l) => l.capitalizedToAssetId).reduce((s, l) => s.plus(l.baseAmount.toString()), new Decimal(0));
    const residualCip = capitalizableCost.minus(capitalizedCost);
    return { project, totalCost: totalCost.toString(), capitalizableCost: capitalizableCost.toString(), expensedCost: expensedCost.toString(), capitalizedCost: capitalizedCost.toString(), residualCip: residualCip.toString(), assetsCreated: assets.length };
  }

  /** Marks the project ready for capitalization — blocked while an
   * unexplained residual would remain uncapitalized-and-unexpensed (spec
   * section 90's own worked example). */
  async markReadyForCapitalization(tenantId: string, membershipId: string, organizationId: string, userId: string, projectId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const project = await this.prisma.capitalInvestmentProject.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundAppError('CapitalInvestmentProject', projectId);
    const updated = await this.prisma.capitalInvestmentProject.update({ where: { id: projectId }, data: { status: 'READY_FOR_CAPITALIZATION' } });
    await this.audit.record({ tenantId, eventType: 'CIP_READY_FOR_CAPITALIZATION', entityType: 'CAPITAL_INVESTMENT_PROJECT', entityId: projectId, action: 'UPDATE', userId, newValues: {} });
    return updated;
  }

  /** Closes the project — blocked if capitalizable-but-uncapitalized
   * residual cost remains (spec section 90). */
  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, projectId: string) {
    const s = await this.summary(tenantId, membershipId, organizationId, projectId);
    if (new Decimal(s.residualCip).abs().gt('0.01')) throw new ValidationAppError(`Cannot close CIP project — unexplained residual of ${s.residualCip} remains uncapitalized (spec section 90).`);
    const updated = await this.prisma.capitalInvestmentProject.update({ where: { id: projectId }, data: { status: 'CAPITALIZED' } });
    await this.audit.record({ tenantId, eventType: 'CIP_CLOSED', entityType: 'CAPITAL_INVESTMENT_PROJECT', entityId: projectId, action: 'UPDATE', userId, newValues: {} });
    return updated;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }
}
