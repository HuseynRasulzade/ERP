import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DepartmentService } from './department.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { VersionedCommandDto } from './dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/departments')
export class DepartmentController {
  constructor(private readonly departments: DepartmentService) {}

  @RequirePermissions(PermissionCodes.DEPARTMENT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.departments.list(tenantId, membershipId, organizationId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.DEPARTMENT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.DEPARTMENT_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.departments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.DEPARTMENT_VIEW)
  @Get(':id/path')
  path(@Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.departments.getPath(organizationId, id);
  }

  @RequirePermissions(PermissionCodes.DEPARTMENT_VIEW)
  @Get(':id/descendants')
  descendants(@Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.departments.getDescendantIds(organizationId, id);
  }

  @RequirePermissions(PermissionCodes.DEPARTMENT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateDepartmentDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.departments.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.DEPARTMENT_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.departments.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
