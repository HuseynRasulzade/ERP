import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryCountSheetService } from './inventory-count-sheet.service';
import { AssignInventoryCountSheetDto, GenerateInventoryCountSheetsDto } from './dto/inventory-count-sheet.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/inventory-count/sessions/:sessionId/sheets')
export class InventoryCountSheetController {
  constructor(private readonly sheets: InventoryCountSheetService) {}

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('sessionId') sessionId: string) {
    return this.sheets.list(tenantId, membershipId, organizationId, sessionId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START_SESSION)
  @Post('generate')
  generate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Body() dto: GenerateInventoryCountSheetsDto,
  ) {
    return this.sheets.generate(tenantId, membershipId, organizationId, user.userId, sessionId, dto);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_START_SESSION)
  @Post(':sheetId/assign')
  assign(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('sheetId') sheetId: string,
    @Body() dto: AssignInventoryCountSheetDto,
  ) {
    return this.sheets.assign(tenantId, membershipId, organizationId, user.userId, sessionId, sheetId, dto.assignedUserId);
  }

  @RequirePermissions(PermissionCodes.INVENTORY_COUNT_ENTER)
  @Post(':sheetId/complete')
  complete(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
    @Param('sheetId') sheetId: string,
  ) {
    return this.sheets.complete(tenantId, membershipId, organizationId, user.userId, sessionId, sheetId);
  }
}
