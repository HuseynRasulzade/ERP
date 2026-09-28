import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto } from './dto/hr-core.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('hr/employees')
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('status') status?: string) {
    return this.employees.list(tenantId, status);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.employees.getWithPerson(tenantId, id);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employees.create(tenantId, user.userId, dto);
  }
}
