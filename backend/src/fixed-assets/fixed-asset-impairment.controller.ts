import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FixedAssetImpairmentService } from './fixed-asset-impairment.service';
import { CreateImpairmentDto } from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets/impairments')
export class FixedAssetImpairmentController {
  constructor(private readonly impairments: FixedAssetImpairmentService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.impairments.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.impairments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_IMPAIR)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateImpairmentDto,
  ) {
    return this.impairments.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }
}
