import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError } from '../common/errors/app-error';

/** CostCenterService (spec sections 4-5) — a financial-responsibility
 * dimension, deliberately distinct from Department (one department may
 * contain several cost centers). */
@Injectable()
export class CostCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { code: string; name: string; parentCostCenterId?: string; departmentId?: string; responsiblePersonId?: string; effectiveFrom?: string; effectiveTo?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.costCenter.create({ data: { tenantId, organizationId, code: dto.code, name: dto.name, parentCostCenterId: dto.parentCostCenterId, departmentId: dto.departmentId, responsiblePersonId: dto.responsiblePersonId, effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined, effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'COST_CENTER_CREATED', entityType: 'COST_CENTER', entityId: row.id, action: 'CREATE', userId, newValues: { code: dto.code, name: dto.name } });
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.costCenter.findMany({ where: { tenantId, organizationId, active: true }, orderBy: { code: 'asc' } }));
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.costCenter.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('CostCenter', id);
    return row;
  }
}
