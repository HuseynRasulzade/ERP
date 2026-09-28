import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PayrollExecutionOrderService } from './payroll-execution-order.service';
import { CreateExecutionOrderDto } from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('payroll/execution-orders')
export class PayrollExecutionOrderController {
  constructor(private readonly orders: PayrollExecutionOrderService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId: string) {
    return this.orders.list(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_MANAGE_DEDUCTIONS)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateExecutionOrderDto,
  ) {
    return this.orders.create(tenantId, user.userId, dto);
  }
}
