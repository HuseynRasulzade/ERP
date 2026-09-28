import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PayrollCalculationEngine } from './payroll-calculation.engine';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { CalculatePayrollDto } from './dto/payroll.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/payroll/periods/:periodId')
export class PayrollCalculationController {
  constructor(
    private readonly engine: PayrollCalculationEngine,
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  @RequirePermissions(PermissionCodes.PAYROLL_CALCULATE)
  @Post('calculate')
  calculate(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: { userId: string },
    @Body() dto: CalculatePayrollDto,
  ) {
    return this.engine.calculate(tenantId, membershipId, organizationId, user.userId, periodId, dto);
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('results')
  async results(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.payrollCalculationResult.findMany({
      where: { tenantId, payrollPeriodId: periodId, status: 'CALCULATED' },
      include: { lines: { orderBy: { calculationSequence: 'asc' } } },
    });
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('results/:employmentId')
  async resultForEmployment(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
    @Param('employmentId') employmentId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.payrollCalculationResult.findFirst({
      where: { tenantId, payrollPeriodId: periodId, employmentId, status: 'CALCULATED' },
      include: { lines: { orderBy: { calculationSequence: 'asc' } } },
      orderBy: { version: 'desc' },
    });
  }

  @RequirePermissions(PermissionCodes.PAYROLL_VIEW)
  @Get('errors')
  async errors(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('periodId') periodId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.payrollError.findMany({
      where: { tenantId, calculationRun: { payrollPeriodId: periodId } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
