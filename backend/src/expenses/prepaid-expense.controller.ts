import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrepaidExpenseService } from './prepaid-expense.service';
import { PrepaidRecognitionRunService } from './prepaid-recognition-run.service';
import { CreatePrepaidExpenseDto, RunPrepaidRecognitionDto } from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/expenses/prepaids')
export class PrepaidExpenseController {
  constructor(
    private readonly prepaids: PrepaidExpenseService,
    private readonly recognitionRuns: PrepaidRecognitionRunService,
  ) {}

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_ACCOUNTING)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.prepaids.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_ACCOUNTING)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
  ) {
    return this.prepaids.get(tenantId, membershipId, organizationId, id);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_PREPAID_CREATE)
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePrepaidExpenseDto,
  ) {
    return this.prepaids.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_PREPAID_CREATE)
  @Post('recognize')
  recognize(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: RunPrepaidRecognitionDto,
  ) {
    return this.recognitionRuns.run(tenantId, membershipId, organizationId, user.userId, dto);
  }
}
