import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrencyService } from './currency.service';
import { RecordExchangeRateDto } from './dto/currency.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('currencies')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Get()
  list() {
    return this.currency.listCurrencies();
  }

  @RequirePermissions(PermissionCodes.CURRENCY_MANAGE)
  @Post('exchange-rates')
  recordRate(@CurrentTenantId() tenantId: string, @Body() dto: RecordExchangeRateDto) {
    return this.currency.recordExchangeRate({
      tenantId,
      currencyCode: dto.currencyCode,
      baseCurrencyCode: dto.baseCurrencyCode,
      effectiveDate: new Date(dto.effectiveDate),
      rate: dto.rate,
      rateType: dto.rateType,
      source: dto.source,
    });
  }

  @Get('exchange-rates/resolve')
  resolveRate(
    @CurrentTenantId() tenantId: string,
    @Query('currencyCode') currencyCode: string,
    @Query('baseCurrencyCode') baseCurrencyCode: string,
    @Query('businessDate') businessDate: string,
    @Query('rateType') rateType?: string,
  ) {
    return this.currency.resolveRate({
      tenantId,
      currencyCode,
      baseCurrencyCode,
      businessDate: new Date(businessDate),
      rateType,
    });
  }
}
