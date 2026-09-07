import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BranchService } from './branch.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { VersionedCommandDto } from './dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/branches')
export class BranchController {
  constructor(private readonly branches: BranchService) {}

  @RequirePermissions(PermissionCodes.BRANCH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.branches.list(tenantId, membershipId, organizationId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.BRANCH_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateBranchDto,
  ) {
    return this.branches.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.BRANCH_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.branches.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.BRANCH_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateBranchDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.branches.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.BRANCH_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.branches.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
