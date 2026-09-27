import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FXConversionService } from './fx-conversion.service';
import { CreateFXConversionDto } from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fx-conversions')
export class FXConversionController {
  constructor(private readonly conversions: FXConversionService) {}

  @RequirePermissions(PermissionCodes.FX_CONVERSION_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.conversions.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FX_CONVERSION_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.conversions.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FX_CONVERSION_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateFXConversionDto,
  ) {
    return this.conversions.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }
}
