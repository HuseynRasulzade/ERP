import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CashierHandoverService } from './cashier-handover.service';
import {
  CompleteCashierHandoverDto,
  CreateCashierHandoverDto,
} from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cashier-handovers')
export class CashierHandoverController {
  constructor(private readonly handovers: CashierHandoverService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('cashboxId') cashboxId?: string,
  ) {
    return this.handovers.list(
      tenantId,
      membershipId,
      organizationId,
      cashboxId,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.handovers.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASHIER_HANDOVER_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCashierHandoverDto,
  ) {
    return this.handovers.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.CASHIER_HANDOVER_MANAGE)
  @Post(':id/complete')
  complete(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CompleteCashierHandoverDto,
  ) {
    return this.handovers.complete(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }
}
