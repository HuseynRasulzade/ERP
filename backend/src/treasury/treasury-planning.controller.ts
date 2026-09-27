import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentCalendarService } from './payment-calendar.service';
import { LiquidityForecastService } from './liquidity-forecast.service';
import { TreasuryLiquidityPolicyService } from './treasury-liquidity-policy.service';
import { TreasuryApprovalRuleService } from './treasury-approval-rule.service';
import { TreasuryHealthService } from './treasury-health.service';
import {
  CreateTreasuryApprovalRuleDto,
  CreateTreasuryLiquidityPolicyDto,
} from './dto/treasury.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';
import { ValidationAppError } from '../common/errors/app-error';

@Controller('organizations/:organizationId/treasury')
export class TreasuryPlanningController {
  constructor(
    private readonly calendar: PaymentCalendarService,
    private readonly liquidity: LiquidityForecastService,
    private readonly liquidityPolicies: TreasuryLiquidityPolicyService,
    private readonly approvalRules: TreasuryApprovalRuleService,
    private readonly health: TreasuryHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_LIQUIDITY)
  @Get('payment-calendar')
  paymentCalendar(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.calendar.list(
      tenantId,
      membershipId,
      organizationId,
      this.parseDate(fromDate),
      this.parseDate(toDate),
    );
  }

  @RequirePermissions(PermissionCodes.TREASURY_VIEW_LIQUIDITY)
  @Get('liquidity-forecast')
  liquidityForecast(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.liquidity.forecast(
      tenantId,
      membershipId,
      organizationId,
      this.parseDate(fromDate),
      this.parseDate(toDate),
    );
  }

  @RequirePermissions(PermissionCodes.TREASURY_HEALTH_VIEW)
  @Get('health')
  healthCheck(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_LIQUIDITY_POLICY_MANAGE)
  @Get('liquidity-policies')
  listLiquidityPolicies(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.liquidityPolicies.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_LIQUIDITY_POLICY_MANAGE)
  @Post('liquidity-policies')
  createLiquidityPolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTreasuryLiquidityPolicyDto,
  ) {
    return this.liquidityPolicies.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.TREASURY_LIQUIDITY_POLICY_MANAGE)
  @Delete('liquidity-policies/:id')
  deactivateLiquidityPolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.liquidityPolicies.deactivate(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
    );
  }

  @RequirePermissions(PermissionCodes.TREASURY_APPROVAL_RULE_MANAGE)
  @Get('approval-rules')
  listApprovalRules(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.approvalRules.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.TREASURY_APPROVAL_RULE_MANAGE)
  @Post('approval-rules')
  createApprovalRule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateTreasuryApprovalRuleDto,
  ) {
    return this.approvalRules.create(
      tenantId,
      membershipId,
      organizationId,
      user.userId,
      dto,
    );
  }

  @RequirePermissions(PermissionCodes.TREASURY_APPROVAL_RULE_MANAGE)
  @Delete('approval-rules/:id')
  deactivateApprovalRule(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.approvalRules.deactivate(
      tenantId,
      membershipId,
      organizationId,
      id,
      user.userId,
    );
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
