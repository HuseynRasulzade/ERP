import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ManualOperationService } from './manual-operation.service';
import { CreateManualOperationDto, PostJournalEntryDto } from './dto/accounting-core.dto';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/manual-operations')
export class ManualOperationsController {
  constructor(private readonly service: ManualOperationService) {}

  @RequirePermissions(PermissionCodes.ACCOUNTING_MANUAL_OPERATION_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.service.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_MANUAL_OPERATION_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.service.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_MANUAL_OPERATION_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateManualOperationDto,
  ) {
    return this.service.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_MANUAL_OPERATION_POST)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PostJournalEntryDto,
  ) {
    return this.service.post(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_MANUAL_OPERATION_UNPOST)
  @Post(':id/unpost')
  unpost(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: PostJournalEntryDto,
  ) {
    return this.service.unpost(tenantId, membershipId, organizationId, id, user.userId, dto.expectedVersion);
  }

  @RequirePermissions(PermissionCodes.ACCOUNTING_JOURNAL_REVERSE)
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
