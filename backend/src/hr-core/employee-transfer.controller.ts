import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EmployeeTransferService } from './employee-transfer.service';
import {
  CreateEmployeeTransferDto,
  PostEmployeeTransferDto,
} from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/hr/transfers')
export class EmployeeTransferController {
  constructor(private readonly transfers: EmployeeTransferService) {}

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('employmentId') employmentId?: string,
  ) {
    return this.transfers.list(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.transfers.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.HR_TRANSFER_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateEmployeeTransferDto,
  ) {
    return this.transfers.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_TRANSFER_POST)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PostEmployeeTransferDto,
  ) {
    return this.transfers.post(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
