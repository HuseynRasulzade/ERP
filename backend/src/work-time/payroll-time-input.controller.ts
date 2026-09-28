import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PayrollTimeInputService } from './payroll-time-input.service';
import { GeneratePayrollTimeInputDto } from './dto/work-time.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/work-time/payroll-inputs')
export class PayrollTimeInputController {
  constructor(private readonly payrollInputs: PayrollTimeInputService) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_PAYROLL_INPUT)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('payrollPeriodStart') payrollPeriodStart: string,
    @Query('payrollPeriodEnd') payrollPeriodEnd: string,
  ) {
    return this.payrollInputs.list(
      tenantId,
      membershipId,
      organizationId,
      payrollPeriodStart,
      payrollPeriodEnd,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_LOCK)
  @Post('generate')
  generate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: GeneratePayrollTimeInputDto,
  ) {
    dto.organizationId = organizationId;
    return this.payrollInputs.generate(tenantId, membershipId, dto);
  }

  @RequirePermissions(PermissionCodes.TIME_TIMESHEET_LOCK)
  @Post(':id/approve')
  approve(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.payrollInputs.approve(tenantId, id);
  }
}
