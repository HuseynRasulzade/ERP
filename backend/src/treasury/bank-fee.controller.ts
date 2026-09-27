import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BankFeeService } from './bank-fee.service';
import { CreateBankFeeDto } from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/bank-fees')
export class BankFeeController {
  constructor(private readonly fees: BankFeeService) {}

  @RequirePermissions(PermissionCodes.BANK_FEE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.fees.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.BANK_FEE_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.fees.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.BANK_FEE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateBankFeeDto,
  ) {
    return this.fees.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }
}
