import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { FixedAssetAcquisitionCandidateService } from './fixed-asset-acquisition-candidate.service';
import {
  ClassifyAcquisitionCandidateDto,
  CreateAcquisitionCandidateDto,
} from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/fixed-assets/acquisition-candidates')
export class FixedAssetAcquisitionCandidateController {
  constructor(
    private readonly candidates: FixedAssetAcquisitionCandidateService,
  ) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.candidates.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.candidates.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAcquisitionCandidateDto,
  ) {
    return this.candidates.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/classify')
  classify(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ClassifyAcquisitionCandidateDto,
  ) {
    return this.candidates.classify(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
