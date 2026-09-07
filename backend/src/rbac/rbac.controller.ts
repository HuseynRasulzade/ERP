import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { CreateRoleDto, SetRolePermissionsDto } from './dto/rbac.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from './permission-codes';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestContextService } from '../common/context/request-context.service';

@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly rbac: RbacService,
    private readonly requestContext: RequestContextService,
  ) {}

  @RequirePermissions(PermissionCodes.CORE_ROLES_VIEW)
  @Get()
  list() {
    return this.rbac.listPermissions();
  }

  /** Powers permission-aware UI (section 51): the frontend hides actions
   * the caller cannot perform, but the backend guard remains authoritative
   * regardless of what this endpoint reports. */
  @Get('me')
  myPermissions() {
    return { permissions: this.requestContext.getTenant()?.permissions ?? [] };
  }
}

@Controller('roles')
export class RolesController {
  constructor(
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions(PermissionCodes.CORE_ROLES_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.rbac.listRoles(tenantId);
  }

  @RequirePermissions(PermissionCodes.CORE_ROLES_MANAGE)
  @Post()
  async create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: { userId: string },
  ) {
    const role = await this.rbac.createRole(tenantId, dto.code, dto.name, dto.permissionCodes);
    await this.audit.record({
      tenantId,
      eventType: 'ROLE_CREATED',
      entityType: 'Role',
      entityId: role.id,
      action: 'CREATE',
      userId: user.userId,
      newValues: { code: role.code, name: role.name, permissionCodes: dto.permissionCodes },
    });
    return role;
  }

  @RequirePermissions(PermissionCodes.CORE_ROLES_MANAGE)
  @Patch(':roleId/permissions')
  async setPermissions(
    @CurrentTenantId() tenantId: string,
    @Param('roleId') roleId: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: { userId: string },
  ) {
    const role = await this.rbac.setRolePermissions(tenantId, roleId, dto.permissionCodes);
    await this.audit.record({
      tenantId,
      eventType: 'PERMISSION_CHANGED',
      entityType: 'Role',
      entityId: roleId,
      action: 'UPDATE',
      userId: user.userId,
      newValues: { permissionCodes: dto.permissionCodes },
    });
    return role;
  }

  @RequirePermissions(PermissionCodes.CORE_ROLES_MANAGE)
  @Post('assign/:membershipId/:roleId')
  async assign(
    @CurrentTenantId() tenantId: string,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.rbac.assignRole(tenantId, membershipId, roleId);
    await this.audit.record({
      tenantId,
      eventType: 'ROLE_ASSIGNED',
      entityType: 'TenantMembership',
      entityId: membershipId,
      action: 'UPDATE',
      userId: user.userId,
      newValues: { roleId },
    });
    return result;
  }

  @RequirePermissions(PermissionCodes.CORE_ROLES_MANAGE)
  @Delete('assign/:membershipId/:roleId')
  async unassign(
    @CurrentTenantId() tenantId: string,
    @Param('membershipId') membershipId: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.rbac.unassignRole(tenantId, membershipId, roleId);
    await this.audit.record({
      tenantId,
      eventType: 'ROLE_UNASSIGNED',
      entityType: 'TenantMembership',
      entityId: membershipId,
      action: 'UPDATE',
      userId: user.userId,
      oldValues: { roleId },
    });
    return { success: true };
  }
}
