import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PayrollRecalculationService } from './payroll-recalculation.service';
import { RequestRecalculationDto } from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('payroll/recalculation-requests')
export class PayrollRecalculationController {
  constructor(private readonly recalc: PayrollRecalculationService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId?: string) {
    return this.recalc.listPending(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_RECALCULATE)
  @Post()
  request(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: RequestRecalculationDto,
  ) {
    return this.recalc.request(tenantId, user.userId, dto);
  }
}

@Controller('organizations/:organizationId/payroll/recalculation-requests')
export class PayrollRecalculationProcessController {
  constructor(private readonly recalc: PayrollRecalculationService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_RECALCULATE)
  @Post(':id/process')
  process(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.recalc.recalculate(tenantId, membershipId, organizationId, user.userId, id);
  }
}
