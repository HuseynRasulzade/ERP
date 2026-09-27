import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CashierAssignmentService } from './cashier-assignment.service';
import { AssignCashierDto, EndCashierAssignmentDto } from './dto/cash-desk.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cashier-assignments')
export class CashierAssignmentController {
  constructor(private readonly assignments: CashierAssignmentService) {}

  @RequirePermissions(PermissionCodes.CASH_VIEW)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('cashboxId') cashboxId?: string,
  ) {
    return this.assignments.list(
      tenantId,
      membershipId,
      organizationId,
      cashboxId,
    );
  }

  @RequirePermissions(PermissionCodes.CASHIER_ASSIGNMENT_MANAGE)
  @Post()
  assign(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: AssignCashierDto,
  ) {
    return this.assignments.assign(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.CASHIER_ASSIGNMENT_MANAGE)
  @Post(':id/end')
  end(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: EndCashierAssignmentDto,
  ) {
    return this.assignments.end(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
      dto.expectedVersion,
      dto.endDate,
    );
  }
}
