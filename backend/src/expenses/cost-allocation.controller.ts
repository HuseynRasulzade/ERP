import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AllocationDriverService } from './allocation-driver.service';
import { AllocationRuleService } from './allocation-rule.service';
import { CostAllocationRunService } from './cost-allocation-run.service';
import {
  SetAllocationDriverValueDto,
  ComputeDriverValuesDto,
  CreateAllocationRuleDto,
  RunCostAllocationDto,
} from './dto/expenses.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/cost-allocations')
export class CostAllocationController {
  constructor(
    private readonly drivers: AllocationDriverService,
    private readonly rules: AllocationRuleService,
    private readonly runs: CostAllocationRunService,
  ) {}

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('drivers/seed-defaults')
  seedDrivers(@CurrentTenantId() tenantId: string) {
    return this.drivers.seedDefaults(tenantId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_COST_CENTER)
  @Get('drivers')
  listDrivers(@CurrentTenantId() tenantId: string) {
    return this.drivers.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('drivers/values')
  setDriverValue(@CurrentTenantId() tenantId: string, @Body() dto: SetAllocationDriverValueDto) {
    return this.drivers.setValue(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('drivers/compute-headcount')
  computeHeadcount(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: ComputeDriverValuesDto,
  ) {
    return this.drivers.computeHeadcount(tenantId, organizationId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('drivers/compute-fte')
  computeFte(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: ComputeDriverValuesDto,
  ) {
    return this.drivers.computeFte(tenantId, organizationId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('drivers/compute-worked-hours')
  computeWorkedHours(@CurrentTenantId() tenantId: string, @Body() dto: ComputeDriverValuesDto) {
    return this.drivers.computeWorkedHours(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_VIEW_COST_CENTER)
  @Get('rules')
  listRules(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string) {
    return this.rules.list(tenantId, organizationId);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_EDIT)
  @Post('rules')
  createRule(
    @CurrentTenantId() tenantId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateAllocationRuleDto,
  ) {
    return this.rules.create(tenantId, organizationId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_RUN)
  @Post('preview')
  preview(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Body() dto: RunCostAllocationDto,
  ) {
    return this.runs.preview(tenantId, membershipId, organizationId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_RUN)
  @Post('run')
  calculate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: RunCostAllocationDto,
  ) {
    return this.runs.calculate(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.EXPENSE_ALLOCATION_RUN)
  @Post(':id/post')
  post(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
    @Body('expectedVersion') expectedVersion: number,
  ) {
    return this.runs.post(tenantId, membershipId, organizationId, user.userId, id, expectedVersion);
  }
}
