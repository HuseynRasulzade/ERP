import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CashDeskTransferService } from './cash-desk-transfer.service';
import {
  CreateCashDeskTransferDto,
  ReceiveCashDeskTransferDto,
} from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-desk-transfers')
export class CashDeskTransferController {
  constructor(private readonly transfers: CashDeskTransferService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.transfers.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.transfers.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSFER_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCashDeskTransferDto,
  ) {
    return this.transfers.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSFER_RECEIVE)
  @Post(':id/receive')
  receive(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReceiveCashDeskTransferDto,
  ) {
    return this.transfers.receive(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }
}
