import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OpeningBalanceService } from './opening-balance.service';
import { CreateManualOperationDto, PostJournalEntryDto } from './dto/accounting-core.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/** Opening balances (Accounting Core spec sections 53-55, 132). */
@Controller('organizations/:organizationId/opening-balances')
export class OpeningBalancesController {
  constructor(private readonly service: OpeningBalanceService) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_OPENING_BALANCE_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId);
  }

  /** Posts immediately: the body's `businessDate` is the opening date. */
  @RequirePermissions(PermissionCodes.ACCOUNTING_OPENING_BALANCE_MANAGE)
  @Post()
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateManualOperationDto,
  ) {
    return this.service.post(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_OPENING_BALANCE_MANAGE, PermissionCodes.ACCOUNTING_JOURNAL_REVERSE)
  @Post(':id/reverse')
  reverse(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PostJournalEntryDto,
  ) {
    return this.service.reverse(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }
}
