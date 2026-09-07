import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';
import { VersionedCommandDto } from './dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccounts: BankAccountService) {}

  @RequirePermissions(PermissionCodes.BANK_ACCOUNT_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.bankAccounts.list(tenantId, membershipId, organizationId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.BANK_ACCOUNT_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.bankAccounts.create(tenantId, membershipId, organizationId, user.userId, {
      ...dto,
      openedDate: dto.openedDate ? new Date(dto.openedDate) : undefined,
    });
  }

  @RequirePermissions(PermissionCodes.BANK_ACCOUNT_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.bankAccounts.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.BANK_ACCOUNT_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateBankAccountDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.bankAccounts.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.BANK_ACCOUNT_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.bankAccounts.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
