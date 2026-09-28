import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PayrollVariableInputService } from './payroll-variable-input.service';
import { CreateVariableInputDto } from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('payroll/variable-inputs')
export class PayrollVariableInputController {
  constructor(private readonly inputs: PayrollVariableInputService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('employmentId') employmentId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.inputs.list(tenantId, employmentId, new Date(fromDate), new Date(toDate));
  }

  @RequirePermissions(PermissionCodes.PAYROLL_CREATE_VARIABLE_INPUT)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateVariableInputDto,
  ) {
    return this.inputs.create(tenantId, user.userId, dto);
  }
}
