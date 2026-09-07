import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AccountingPolicyService } from './accounting-policy.service';
import { CreateAccountingPolicyDto, UpdateAccountingPolicyDto } from './dto/accounting-policy.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/accounting-policies')
export class AccountingPolicyController {
  constructor(private readonly policies: AccountingPolicyService) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_POLICY_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.policies.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_POLICY_VIEW)
  @Get('resolve')
  resolve(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
    @Query('businessDate') businessDate: string,
  ) {
    return this.policies.resolve(tenantId, organizationId, new Date(businessDate));
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_POLICY_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAccountingPolicyDto,
  ) {
    return this.policies.create(tenantId, membershipId, organizationId, user.userId, {
      ...dto,
      validFrom: new Date(dto.validFrom),
      validTo: dto.validTo ? new Date(dto.validTo) : null,
    });
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_POLICY_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.policies.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_POLICY_MANAGE)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateAccountingPolicyDto,
  ) {
    const { expectedVersion, ...rest } = dto;
    return this.policies.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, {
      ...rest,
      validFrom: rest.validFrom ? new Date(rest.validFrom) : undefined,
      validTo: rest.validTo ? new Date(rest.validTo) : undefined,
    });
  }
}
