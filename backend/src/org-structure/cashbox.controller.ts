import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CashboxService } from './cashbox.service';
import { CreateCashboxDto, UpdateCashboxDto } from './dto/cashbox.dto';
import { VersionedCommandDto } from './dto/common.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cashboxes')
export class CashboxController {
  constructor(private readonly cashboxes: CashboxService) {}

  @RequirePermissions(PermissionCodes.CASHBOX_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.cashboxes.list(tenantId, membershipId, organizationId, includeInactive === 'true');
  }

  @RequirePermissions(PermissionCodes.CASHBOX_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCashboxDto,
  ) {
    return this.cashboxes.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.CASHBOX_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.cashboxes.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASHBOX_EDIT)
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateCashboxDto,
  ) {
    const { expectedVersion, ...patch } = dto;
    return this.cashboxes.update(tenantId, membershipId, organizationId, id, user.userId, expectedVersion, patch);
  }

  @RequirePermissions(PermissionCodes.CASHBOX_DEACTIVATE)
  @Post(':id/deactivate')
  deactivate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: VersionedCommandDto,
  ) {
    return this.cashboxes.deactivate(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
