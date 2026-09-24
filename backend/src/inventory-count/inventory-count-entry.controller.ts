import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { InventoryCountEntryService } from './inventory-count-entry.service';
import { SubmitInventoryCountEntryDto } from './dto/inventory-count-entry.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-count/sessions/:sessionId/sheets/:sheetId/entries')
export class InventoryCountEntryController {
  constructor(private readonly entries: InventoryCountEntryService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('sessionId') sessionId: string,
    @Param('sheetId') sheetId: string,
  ) {
    return this.entries.list(tenantId, membershipId, organizationId, sessionId, sheetId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Post()
  submit(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('sheetId') sheetId: string,
    @Body() dto: SubmitInventoryCountEntryDto,
  ) {
    return this.entries.submit(tenantId, membershipId, organizationId, user.userId, sessionId, sheetId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Delete(':entryId')
  void_(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('sheetId') sheetId: string,
    @Param('entryId') entryId: string,
    @Body('reason') reason: string,
  ) {
    return this.entries.voidEntry(tenantId, membershipId, organizationId, user.userId, sessionId, sheetId, entryId, reason);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW_ACCOUNTING_QUANTITY)
  @Get('compare')
  compare(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('sessionId') sessionId: string,
    @Param('sheetId') sheetId: string,
  ) {
    return this.entries.compareToSnapshot(tenantId, membershipId, organizationId, sessionId, sheetId);
  }
}
