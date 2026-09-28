import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CompensationService } from './compensation.service';
import { CreateCompensationAssignmentDto } from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('payroll/compensation')
export class CompensationController {
  constructor(private readonly compensation: CompensationService) {}

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW_SALARY)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('employmentId') employmentId: string) {
    return this.compensation.list(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_EDIT_COMPENSATION)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateCompensationAssignmentDto,
  ) {
    return this.compensation.create(tenantId, user.userId, dto);
  }
}
