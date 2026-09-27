import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CashCountAdjustmentService } from './cash-count-adjustment.service';
import { CreateCashCountAdjustmentDto } from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-count-adjustments')
export class CashCountAdjustmentController {
  constructor(private readonly adjustments: CashCountAdjustmentService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.adjustments.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.adjustments.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_ADJUSTMENT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCashCountAdjustmentDto,
  ) {
    return this.adjustments.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }
}
