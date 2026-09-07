import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * Reusable RBAC (section 6): User -> TenantMembership -> Roles -> Permissions.
 * Role names are never checked directly in business logic — only permission
 * codes (enforced by PermissionsGuard). This service is the only place
 * roles/permissions are assigned or aggregated.
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }

  listRoles(tenantId: string) {
    return this.prisma.role.findMany({
      where: { OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRole(tenantId: string, code: string, name: string, permissionCodes: string[]) {
    const existing = await this.prisma.role.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (existing) throw new ConflictAppError(`Role code already exists in this tenant: ${code}`);

    const permissions = await this.resolvePermissions(permissionCodes);

    return this.prisma.role.create({
      data: {
        tenantId,
        code,
        name,
        permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async setRolePermissions(tenantId: string, roleId: string, permissionCodes: string[]) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new NotFoundAppError('Role', roleId);
    if (role.isSystem) throw new ValidationAppError('System roles cannot be modified');

    const permissions = await this.resolvePermissions(permissionCodes);

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId, permissionId: p.id })),
      }),
    ]);

    return this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async assignRole(tenantId: string, membershipId: string, roleId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) throw new NotFoundAppError('TenantMembership', membershipId);

    const role = await this.prisma.role.findFirst({
      where: { id: roleId, OR: [{ tenantId }, { tenantId: null, isSystem: true }] },
    });
    if (!role) throw new NotFoundAppError('Role', roleId);

    return this.prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId, roleId } },
      create: { membershipId, roleId },
      update: {},
    });
  }

  async unassignRole(tenantId: string, membershipId: string, roleId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) throw new NotFoundAppError('TenantMembership', membershipId);

    await this.prisma.membershipRole.deleteMany({ where: { membershipId, roleId } });
  }

  /** Aggregate effective permission codes for a membership (all roles combined). */
  async effectivePermissions(membershipId: string): Promise<string[]> {
    const roles = await this.prisma.membershipRole.findMany({
      where: { membershipId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const codes = new Set<string>();
    for (const mr of roles) {
      for (const rp of mr.role.permissions) codes.add(rp.permission.code);
    }
    return Array.from(codes);
  }

  private async resolvePermissions(codes: string[]) {
    if (codes.length === 0) return [];
    const permissions = await this.prisma.permission.findMany({ where: { code: { in: codes } } });
    const found = new Set(permissions.map((p) => p.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      throw new ValidationAppError(`Unknown permission code(s): ${missing.join(', ')}`);
    }
    return permissions;
  }
}
