import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EmploymentContractService } from './employment-contract.service';
import {
  AmendEmploymentContractDto,
  CreateEmploymentContractDto,
} from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller(
  'organizations/:organizationId/hr/employments/:employmentId/contract',
)
export class EmploymentContractController {
  constructor(private readonly contracts: EmploymentContractService) {}

  @RequirePermissions(PermissionCodes.HR_CONTRACT_VIEW)
  @Get()
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('employmentId') employmentId: string,
  ) {
    return this.contracts.get(
      tenantId,
      membershipId,
      organizationId,
      employmentId,
    );
  }

  @RequirePermissions(PermissionCodes.HR_CONTRACT_EDIT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('employmentId') employmentId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateEmploymentContractDto,
  ) {
    dto.employmentId = employmentId;
    return this.contracts.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.HR_CONTRACT_EDIT)
  @Post('amend')
  amend(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('employmentId') employmentId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: AmendEmploymentContractDto,
  ) {
    return this.contracts.amend(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      employmentId,
      dto,
    );
  }
}
