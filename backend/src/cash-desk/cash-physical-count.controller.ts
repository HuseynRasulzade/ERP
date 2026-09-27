import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CashPhysicalCountService } from './cash-physical-count.service';
import {
  DecideCashPhysicalCountDto,
  StartCashPhysicalCountDto,
  SubmitCashPhysicalCountDto,
} from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cash-physical-counts')
export class CashPhysicalCountController {
  constructor(private readonly counts: CashPhysicalCountService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('cashboxId') cashboxId?: string,
  ) {
    return this.counts.list(tenantId, membershipId, organizationId, cashboxId);
  }

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.counts.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.CASH_COUNT)
  @Post()
  start(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: StartCashPhysicalCountDto,
  ) {
    return this.counts.start(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_COUNT)
  @Post(':id/submit')
  submit(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: SubmitCashPhysicalCountDto,
  ) {
    return this.counts.submitLines(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_COUNT)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DecideCashPhysicalCountDto,
  ) {
    return this.counts.approve(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }

  @RequirePermissions(PermissionCodes.CASH_COUNT)
  @Post(':id/reject')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: DecideCashPhysicalCountDto,
  ) {
    return this.counts.reject(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      id,
      dto.expectedVersion,
    );
  }
}
