import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { StructuralValidationService } from './structural-validation.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface BranchInput {
  code: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  managerPersonId?: string;
}

/** Optional operating subdivision of an Organization (section 6). */
@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly validation: StructuralValidationService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.branch.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: BranchInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.validation.assertResponsiblePersonInTenant(tenantId, input.managerPersonId);

    const existing = await this.prisma.branch.findUnique({ where: { organizationId_code: { organizationId, code: input.code } } });
    if (existing) throw new ConflictAppError(`Branch code already exists: ${input.code}`);

    const branch = await this.prisma.branch.create({
      data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'BRANCH_CREATED',
      entityType: 'Branch',
      entityId: branch.id,
      action: 'CREATE',
      userId,
      newValues: { code: branch.code, name: branch.name },
    });

    return branch;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, branchId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundAppError('Branch', branchId);
    return branch;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    branchId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<BranchInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.managerPersonId !== undefined) {
      await this.validation.assertResponsiblePersonInTenant(tenantId, patch.managerPersonId);
    }

    const result = await this.prisma.branch.updateMany({
      where: { id: branchId, organizationId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'BRANCH_UPDATED',
      entityType: 'Branch',
      entityId: branchId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.branch.findUnique({ where: { id: branchId } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    branchId: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const branch = await this.get(tenantId, membershipId, organizationId, branchId);
    if (!branch.active) throw new ValidationAppError('Branch is already inactive');

    const result = await this.prisma.branch.updateMany({
      where: { id: branchId, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'BRANCH_DEACTIVATED',
      entityType: 'Branch',
      entityId: branchId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.branch.findUnique({ where: { id: branchId } });
  }
}
