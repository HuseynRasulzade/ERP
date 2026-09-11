import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SupplyPegService } from './supply-peg.service';
import { CreateSupplyPegDto } from './dto/procurement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/supply-pegs')
export class SupplyPegController {
  constructor(private readonly pegs: SupplyPegService) {}

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLY_PLANNING_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('demandType') demandType: string, @Query('demandId') demandId: string, @Query('demandLineId') demandLineId: string) {
    return this.pegs.listForDemand(tenantId, demandType, demandId, demandLineId);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLY_PEGGING_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSupplyPegDto,
  ) {
    return this.pegs.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_SUPPLY_PEGGING_MANAGE)
  @Post(':id/remove')
  remove(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.pegs.remove(tenantId, membershipId, organizationId, id, user.userId);
  }
}
