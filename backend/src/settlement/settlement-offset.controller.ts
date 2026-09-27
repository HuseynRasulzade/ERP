import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SettlementOffsetService } from './settlement-offset.service';
import { CreateOffsetDto } from './dto/settlement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/settlements/offsets')
export class SettlementOffsetController {
  constructor(private readonly offsets: SettlementOffsetService) {}

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('counterpartyId') counterpartyId?: string) {
    return this.offsets.list(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_OFFSET)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateOffsetDto) {
    return this.offsets.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_OFFSET)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body('expectedVersion') expectedVersion: number,
  ) {
    return this.offsets.post(tenantId, membershipId, organizationId, user.userId, id, expectedVersion);
  }
}
