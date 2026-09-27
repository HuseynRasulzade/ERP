import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrencyDenominationService } from './currency-denomination.service';
import { CreateCurrencyDenominationDto } from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('currency-denominations')
export class CurrencyDenominationController {
  constructor(private readonly denominations: CurrencyDenominationService) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('currencyId') currencyId?: string,
  ) {
    return this.denominations.list(tenantId, currencyId);
  }

  @RequirePermissions(PermissionCodes.CASH_DENOMINATION_MANAGE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCurrencyDenominationDto,
  ) {
    return this.denominations.create(
      tenantId,
      user.userId,
      dto.currencyId,
      dto.faceValue,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_DENOMINATION_MANAGE)
  @Post(':id/deactivate')
  deactivate(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.denominations.deactivate(tenantId, id);
  }
}
