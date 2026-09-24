import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CashTransactionService } from './cash-transaction.service';
import { CreateCashTransactionDto, UpdateCashTransactionDto } from './dto/treasury.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-transactions')
export class CashTransactionController {
  constructor(private readonly service: CashTransactionService) {}

  @RequirePermissions(PermissionCodes.CASH_TRANSACTION_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.service.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSACTION_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSACTION_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCashTransactionDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASH_TRANSACTION_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateCashTransactionDto,
  ) {
    return this.service.update(tenantId, membershipId, organizationId, id, user.userId, dto);
  }
}
