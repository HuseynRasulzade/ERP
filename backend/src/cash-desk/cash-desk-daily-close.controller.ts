import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CashDeskDailyCloseService } from './cash-desk-daily-close.service';
import {
  CloseCashDeskDailyCloseDto,
  LinkPhysicalCountDto,
  OpenCashDeskDailyCloseDto,
  ReopenCashDeskDailyCloseDto,
} from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-desk-daily-closes')
export class CashDeskDailyCloseController {
  constructor(private readonly closes: CashDeskDailyCloseService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('cashboxId') cashboxId?: string,
  ) {
    return this.closes.list(tenantId, membershipId, organizationId, cashboxId);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.closes.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_DAILY_CLOSE)
  @Post()
  open(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: OpenCashDeskDailyCloseDto,
  ) {
    return this.closes.open(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto.cashboxId,
      dto.businessDate,
      dto.cashierId,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_DAILY_CLOSE)
  @Post(':id/link-count')
  linkCount(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: LinkPhysicalCountDto,
  ) {
    return this.closes.linkPhysicalCount(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.physicalCountId,
      dto.expectedVersion,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_DAILY_CLOSE)
  @Post(':id/refresh')
  refresh(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.closes.refresh(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_DAILY_CLOSE)
  @Post(':id/close')
  close(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CloseCashDeskDailyCloseDto,
  ) {
    return this.closes.close(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      dto.expectedVersion,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_DAILY_CLOSE_REOPEN)
  @Post(':id/reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReopenCashDeskDailyCloseDto,
  ) {
    return this.closes.reopen(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      dto.expectedVersion,
      dto.reason,
    );
  }
}
