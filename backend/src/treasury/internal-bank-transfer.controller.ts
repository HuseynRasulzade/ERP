import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InternalBankTransferService } from './internal-bank-transfer.service';
import { CreateInternalBankTransferDto } from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/internal-bank-transfers')
export class InternalBankTransferController {
  constructor(private readonly transfers: InternalBankTransferService) {}

  @RequirePermissions(PermissionCodes.INTERNAL_BANK_TRANSFER_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.transfers.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.INTERNAL_BANK_TRANSFER_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.transfers.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.INTERNAL_BANK_TRANSFER_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateInternalBankTransferDto,
  ) {
    return this.transfers.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }
}
