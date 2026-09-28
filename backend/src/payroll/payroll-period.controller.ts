import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollCloseService } from './payroll-close.service';
import {
  ApprovePayrollPeriodDto,
  CreatePayrollPeriodDto,
  ReopenPayrollPeriodDto,
} from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payroll/periods')
export class PayrollPeriodController {
  constructor(
    private readonly periods: PayrollPeriodService,
    private readonly closeService: PayrollCloseService,
  ) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.periods.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.periods.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CALCULATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePayrollPeriodDto,
  ) {
    return this.periods.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ApprovePayrollPeriodDto,
  ) {
    return this.periods.approve(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_REOPEN)
  @Post(':id/reopen')
  reopen(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: ReopenPayrollPeriodDto,
  ) {
    return this.periods.reopen(tenantId, membershipId, organizationId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CLOSE)
  @Post(':id/close')
  close(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.closeService.close(tenantId, membershipId, organizationId, user.userId, id);
  }
}
