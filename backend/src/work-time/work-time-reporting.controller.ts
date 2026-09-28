import { Controller, Get, Param, Query } from '@nestjs/common';
import { WorkTimeReportingService } from './work-time-reporting.service';
import { WorkTimeHealthService } from './work-time-health.service';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

@Controller('organizations/:organizationId/work-time/reports')
export class WorkTimeReportingController {
  constructor(
    private readonly reports: WorkTimeReportingService,
    private readonly health: WorkTimeHealthService,
  ) {}

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('monthly-summary')
  monthlySummary(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.monthlySummary(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('plan-vs-actual')
  planVsActual(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.planVsActual(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('overtime')
  overtime(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.overtimeReport(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('night-work')
  nightWork(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.nightWorkReport(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('holiday-weekend-work')
  holidayWeekendWork(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.holidayWeekendReport(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('attendance-exceptions')
  attendanceExceptions(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.attendanceExceptionsReport(
      tenantId,
      membershipId,
      organizationId,
      fromDate,
      toDate,
    );
  }

  @RequirePermissions(PermissionCodes.TIME_VIEW_DEPARTMENT)
  @Get('health')
  healthCheck(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.health.check(tenantId, membershipId, organizationId);
  }
}
