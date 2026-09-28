import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CapitalInvestmentProjectService } from './capital-investment-project.service';
import {
  CapitalizeCipDto,
  CreateCipProjectDto,
  MarkCipReadyDto,
} from './dto/fixed-asset.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { DocumentCommandDto } from '../document-framework/dto/document-command.dto';

@Controller('organizations/:organizationId/fixed-assets/cip')
export class CapitalInvestmentProjectController {
  constructor(private readonly cip: CapitalInvestmentProjectService) {}

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
  ) {
    return this.cip.list(tenantId, membershipId, organizationId, status);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.cip.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_VIEW_COST)
  @Get(':id/balance')
  balance(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.cip
      .getRemainingBalance(tenantId, membershipId, organizationId, id)
      .then((balance) => ({ remainingBalance: balance.toFixed(2) }));
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCipProjectDto,
  ) {
    return this.cip.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/activate')
  activate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DocumentCommandDto,
  ) {
    return this.cip.activate(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/suspend')
  suspend(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DocumentCommandDto,
  ) {
    return this.cip.suspend(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/mark-ready')
  markReady(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: MarkCipReadyDto,
  ) {
    return this.cip.markReady(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.FIXED_ASSET_CREATE)
  @Post(':id/capitalize')
  capitalize(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CapitalizeCipDto,
  ) {
    return this.cip.capitalize(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
