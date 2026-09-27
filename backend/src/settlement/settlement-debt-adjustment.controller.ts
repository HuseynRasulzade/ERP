import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DebtAdjustmentService } from './debt-adjustment.service';
import { CreateDebtAdjustmentDto } from './dto/settlement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/settlements/debt-adjustments')
export class SettlementDebtAdjustmentController {
  constructor(private readonly adjustments: DebtAdjustmentService) {}

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('counterpartyId') counterpartyId?: string) {
    return this.adjustments.list(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.adjustments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_CREATE_ADJUSTMENT)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateDebtAdjustmentDto) {
    return this.adjustments.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_APPROVE_ADJUSTMENT)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body('expectedVersion') expectedVersion: number,
  ) {
    return this.adjustments.approve(tenantId, membershipId, organizationId, user.userId, id, expectedVersion);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_APPROVE_ADJUSTMENT)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body('expectedVersion') expectedVersion: number,
  ) {
    return this.adjustments.post(tenantId, membershipId, organizationId, user.userId, id, expectedVersion);
  }
}
