import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FixedAssetModernizationService } from './fixed-asset-modernization.service';
import { CreateModernizationDto } from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets/modernizations')
export class FixedAssetModernizationController {
  constructor(
    private readonly modernizations: FixedAssetModernizationService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.modernizations.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.modernizations.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_MODERNIZE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateModernizationDto,
  ) {
    return this.modernizations.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }
}
