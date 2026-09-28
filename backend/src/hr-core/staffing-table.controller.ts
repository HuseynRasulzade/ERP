import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StaffingTableService } from './staffing-table.service';
import {
  ActivateStaffingTableDto,
  AddStaffingPositionDto,
  CreateStaffingTableDto,
} from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/hr/staffing-tables')
export class StaffingTableController {
  constructor(private readonly tables: StaffingTableService) {}

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.tables.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get('active')
  getActive(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.tables.getActive(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.tables.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateStaffingTableDto,
  ) {
    return this.tables.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post(':id/positions')
  addPosition(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: AddStaffingPositionDto,
  ) {
    return this.tables.addPosition(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post(':id/activate')
  activate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ActivateStaffingTableDto,
  ) {
    return this.tables.activate(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
