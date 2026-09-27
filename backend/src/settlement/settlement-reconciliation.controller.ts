import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SettlementReconciliationService } from './settlement-reconciliation.service';
import { GenerateReconciliationDto, ConfirmReconciliationDto } from './dto/settlement.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/settlements/reconciliations')
export class SettlementReconciliationController {
  constructor(private readonly reconciliations: SettlementReconciliationService) {}

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('counterpartyId') counterpartyId?: string) {
    return this.reconciliations.list(tenantId, membershipId, organizationId, counterpartyId);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.reconciliations.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_RECONCILE)
  @Post()
  generate(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: GenerateReconciliationDto) {
    return this.reconciliations.generate(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.SETTLEMENT_RECONCILE)
  @Post(':id/confirm')
  confirm(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: ConfirmReconciliationDto,
  ) {
    return this.reconciliations.confirm(tenantId, membershipId, organizationId, user.userId, id, dto);
  }
}
