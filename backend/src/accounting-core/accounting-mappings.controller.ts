import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AccountingMappingService } from './accounting-mapping.service';
import { AccountingMappingDto } from './dto/accounting-core.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('accounting/mappings')
export class AccountingMappingsController {
  constructor(private readonly mappings: AccountingMappingService) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_MAPPING_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('organizationId') organizationId?: string) {
    return this.mappings.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_MAPPING_MANAGE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: AccountingMappingDto) {
    return this.mappings.upsert(tenantId, user.userId, {
      ...dto,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
    });
  }
}
