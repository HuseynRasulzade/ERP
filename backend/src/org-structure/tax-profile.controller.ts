import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TaxProfileService } from './tax-profile.service';
import { CreateTaxProfileDto, UpdateTaxProfileDto } from './dto/tax-profile.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/tax-profiles')
export class TaxProfileController {
  constructor(private readonly taxProfiles: TaxProfileService) {}

  @RequirePermissions(PermissionCodes.TAX_PROFILE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.taxProfiles.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TAX_PROFILE_VIEW)
  @Get('resolve')
  resolve(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
    @Query('businessDate') businessDate: string,
  ) {
    return this.taxProfiles.resolve(tenantId, organizationId, new Date(businessDate));
  }

  @RequirePermissions(PermissionCodes.TAX_PROFILE_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTaxProfileDto,
  ) {
    return this.taxProfiles.create(tenantId, membershipId, organizationId, user.userId, {
      ...dto,
      validFrom: new Date(dto.validFrom),
      validTo: dto.validTo ? new Date(dto.validTo) : null,
      vatRegistrationDate: dto.vatRegistrationDate ? new Date(dto.vatRegistrationDate) : undefined,
      vatDeregistrationDate: dto.vatDeregistrationDate ? new Date(dto.vatDeregistrationDate) : undefined,
    });
  }

  @RequirePermissions(PermissionCodes.TAX_PROFILE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.taxProfiles.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.TAX_PROFILE_MANAGE)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateTaxProfileDto,
  ) {
    const { expectedVersion, ...rest } = dto;
    return this.taxProfiles.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, {
      ...rest,
      validFrom: rest.validFrom ? new Date(rest.validFrom) : undefined,
      validTo: rest.validTo ? new Date(rest.validTo) : undefined,
      vatRegistrationDate: rest.vatRegistrationDate ? new Date(rest.vatRegistrationDate) : undefined,
      vatDeregistrationDate: rest.vatDeregistrationDate ? new Date(rest.vatDeregistrationDate) : undefined,
    });
  }
}
