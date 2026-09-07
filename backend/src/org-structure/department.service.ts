import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from './organization-access.service';
import { StructuralValidationService } from './structural-validation.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

export interface DepartmentInput {
  code: string;
  name: string;
  branchId?: string;
  parentDepartmentId?: string;
  managerPersonId?: string;
}

/**
 * Hierarchical department within an Organization (section 7/8). Cycle
 * detection is enforced server-side — never trusted to the frontend tree
 * widget alone.
 */
@Injectable()
export class DepartmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly validation: StructuralValidationService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, includeInactive = false) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.department.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  /** Ancestor path from root to `departmentId` inclusive (section 8). */
  async getPath(organizationId: string, departmentId: string): Promise<string[]> {
    const path: string[] = [];
    let current: { id: string; parentDepartmentId: string | null } | null =
      await this.prisma.department.findFirst({ where: { id: departmentId, organizationId } });
    while (current) {
      path.unshift(current.id);
      current = current.parentDepartmentId
        ? await this.prisma.department.findFirst({ where: { id: current.parentDepartmentId, organizationId } })
        : null;
    }
    return path;
  }

  /** All descendant department ids of `departmentId`, inclusive (section 8). */
  async getDescendantIds(organizationId: string, departmentId: string): Promise<string[]> {
    const all = await this.prisma.department.findMany({ where: { organizationId }, select: { id: true, parentDepartmentId: true } });
    const childrenOf = new Map<string, string[]>();
    for (const d of all) {
      if (!d.parentDepartmentId) continue;
      childrenOf.set(d.parentDepartmentId, [...(childrenOf.get(d.parentDepartmentId) ?? []), d.id]);
    }
    const result: string[] = [];
    const stack = [departmentId];
    while (stack.length) {
      const id = stack.pop()!;
      result.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }
    return result;
  }

  private async assertNoCycle(organizationId: string, departmentId: string | null, proposedParentId: string | null | undefined) {
    if (!proposedParentId) return;
    if (departmentId && proposedParentId === departmentId) {
      throw new ValidationAppError('A department cannot be its own parent');
    }
    if (departmentId) {
      const descendants = await this.getDescendantIds(organizationId, departmentId);
      if (descendants.includes(proposedParentId)) {
        throw new ValidationAppError('This would create a circular department hierarchy');
      }
    }
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, input: DepartmentInput) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    await this.validation.assertBranchBelongsToOrganization(organizationId, input.branchId);
    await this.validation.assertResponsiblePersonInTenant(tenantId, input.managerPersonId);

    if (input.parentDepartmentId) {
      const parent = await this.prisma.department.findFirst({ where: { id: input.parentDepartmentId, organizationId } });
      if (!parent) throw new ValidationAppError('Parent department must belong to the same organization');
    }

    const existing = await this.prisma.department.findUnique({
      where: { organizationId_code: { organizationId, code: input.code } },
    });
    if (existing) throw new ConflictAppError(`Department code already exists: ${input.code}`);

    const dept = await this.prisma.department.create({
      data: { tenantId, organizationId, createdBy: userId, updatedBy: userId, ...input },
    });

    await this.audit.record({
      tenantId,
      eventType: 'DEPARTMENT_CREATED',
      entityType: 'Department',
      entityId: dept.id,
      action: 'CREATE',
      userId,
      newValues: { code: dept.code, name: dept.name, parentDepartmentId: dept.parentDepartmentId },
    });

    return dept;
  }

  async get(tenantId: string, membershipId: string, organizationId: string, departmentId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const dept = await this.prisma.department.findFirst({ where: { id: departmentId, organizationId } });
    if (!dept) throw new NotFoundAppError('Department', departmentId);
    return dept;
  }

  async update(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    departmentId: string,
    userId: string,
    expectedVersion: number,
    patch: Partial<DepartmentInput>,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (patch.branchId !== undefined) await this.validation.assertBranchBelongsToOrganization(organizationId, patch.branchId);
    if (patch.managerPersonId !== undefined) await this.validation.assertResponsiblePersonInTenant(tenantId, patch.managerPersonId);
    if (patch.parentDepartmentId !== undefined) {
      await this.assertNoCycle(organizationId, departmentId, patch.parentDepartmentId);
      if (patch.parentDepartmentId) {
        const parent = await this.prisma.department.findFirst({ where: { id: patch.parentDepartmentId, organizationId } });
        if (!parent) throw new ValidationAppError('Parent department must belong to the same organization');
      }
    }

    const result = await this.prisma.department.updateMany({
      where: { id: departmentId, organizationId, version: expectedVersion },
      data: { ...patch, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'DEPARTMENT_UPDATED',
      entityType: 'Department',
      entityId: departmentId,
      action: 'UPDATE',
      userId,
      newValues: patch,
    });

    return this.prisma.department.findUnique({ where: { id: departmentId } });
  }

  async deactivate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    departmentId: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const dept = await this.get(tenantId, membershipId, organizationId, departmentId);
    if (!dept.active) throw new ValidationAppError('Department is already inactive');

    const result = await this.prisma.department.updateMany({
      where: { id: departmentId, organizationId, version: expectedVersion },
      data: { active: false, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'DEPARTMENT_DEACTIVATED',
      entityType: 'Department',
      entityId: departmentId,
      action: 'DEACTIVATE',
      userId,
    });

    return this.prisma.department.findUnique({ where: { id: departmentId } });
  }
}
