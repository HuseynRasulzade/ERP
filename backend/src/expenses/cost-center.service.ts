import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateCostCenterDto } from './dto/expenses.dto';

/**
 * CostCenterService (docx spec Phase 20 sections 4-6) — deliberately NOT
 * the same master as Department: a CostCenter is a financial-
 * responsibility/expense-collection dimension, optionally anchored to a
 * Department but never identical to it (one department can contain
 * several cost centers).
 */
@Injectable()
export class CostCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.costCenter.findMany({ where: { organizationId }, orderBy: { code: 'asc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.costCenter.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('CostCenter', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateCostCenterDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.parentCostCenterId) {
      const parent = await this.prisma.costCenter.findFirst({
        where: { id: dto.parentCostCenterId, organizationId },
      });
      if (!parent) throw new ValidationAppError('parentCostCenterId does not belong to this organization');
    }
    return this.prisma.costCenter.create({
      data: {
        tenantId,
        organizationId,
        code: dto.code,
        name: dto.name,
        parentCostCenterId: dto.parentCostCenterId,
        departmentId: dto.departmentId,
        responsiblePersonId: dto.responsiblePersonId,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        createdBy: userId,
      },
    });
  }

  async deactivate(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.get(tenantId, membershipId, organizationId, id);
    return this.prisma.costCenter.update({ where: { id: row.id }, data: { active: false } });
  }
}
