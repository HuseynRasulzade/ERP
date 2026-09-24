import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BankService } from './bank.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { VersionedCommandDto } from '../org-structure/dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('banks')
export class BankController {
  constructor(private readonly service: BankService) {}

  @RequirePermissions(PermissionCodes.BANK_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(tenantId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.BANK_CREATE)
  @Post()
  create(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateBankDto) {
    return this.service.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.BANK_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.BANK_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateBankDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.service.update(tenantId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.BANK_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: VersionedCommandDto,
  ) {
    return this.service.deactivate(tenantId, id, user.userId, dto.expectedVersion);
  }
}
