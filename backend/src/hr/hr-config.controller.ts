import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes as P } from '../rbac/permission-codes';
import {
  AckEventsDto,
  CatalogItemDto,
  CreatePositionDto,
  CreateStaffingPositionDto,
  CreateStaffingTableDto,
  CreateWorkScheduleDto,
  HrPeriodDto,
  ImportValidateDto,
  UpdateHrPolicyDto,
  UpdatePositionDto,
  UpdateStaffingPositionDto,
  UpdateWorkScheduleDto,
} from './dto/hr.dto';
import { HrCtx, HrRequestContext } from './hr-context.decorator';
import { HrEventService } from './hr-event.service';
import { HrHealthService } from './hr-health.service';
import { HrPolicyService } from './hr-policy.service';
import { HrReportingService } from './hr-reporting.service';
import { HrMasterDataService, StaffingService } from './staffing.service';
import { PhysicalPersonService } from './physical-person.service';

/** Positions, schedules, staffing tables, catalogs, policy, HR periods and
 * the outbox (spec 13-18, 32, 39, 44, 119-125). */
@Controller('hr')
export class HrConfigController {
  constructor(
    private readonly master: HrMasterDataService,
    private readonly staffing: StaffingService,
    private readonly policy: HrPolicyService,
    private readonly events: HrEventService,
  ) {}

  @RequirePermissions(P.HR_STAFFING_VIEW)
  @Get('positions')
  listPositions(@HrCtx() c: HrRequestContext, @Query('active') active?: string) {
    return this.master.listPositions(c.tenantId, active);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Post('positions')
  createPosition(@HrCtx() c: HrRequestContext, @Body() dto: CreatePositionDto) {
    return this.master.createPosition(c.tenantId, c.userId, dto);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Patch('positions/:id')
  updatePosition(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.master.updatePosition(c.tenantId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_STAFFING_VIEW)
  @Get('work-schedules')
  listSchedules(@HrCtx() c: HrRequestContext) {
    return this.master.listSchedules(c.tenantId);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Post('work-schedules')
  createSchedule(@HrCtx() c: HrRequestContext, @Body() dto: CreateWorkScheduleDto) {
    return this.master.createSchedule(c.tenantId, c.userId, dto);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Patch('work-schedules/:id')
  updateSchedule(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: UpdateWorkScheduleDto) {
    return this.master.updateSchedule(c.tenantId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_STAFFING_VIEW)
  @Get('staffing-tables')
  listTables(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId: string) {
    return this.staffing.listTables(c.tenantId, c.membershipId, organizationId);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Post('staffing-tables')
  createTable(@HrCtx() c: HrRequestContext, @Body() dto: CreateStaffingTableDto) {
    return this.staffing.createTable(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_STAFFING_VIEW)
  @Get('staffing-tables/:id')
  getTable(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.staffing.getTable(c.tenantId, c.membershipId, id);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Post('staffing-tables/:id/activate')
  activateTable(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.staffing.activateTable(c.tenantId, c.membershipId, c.userId, id);
  }

  @RequirePermissions(P.HR_STAFFING_VIEW)
  @Get('staffing-positions')
  listStaffingPositions(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId: string, @Query('asOf') asOf?: string) {
    return this.staffing.listPositions(c.tenantId, c.membershipId, organizationId, asOf);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Post('staffing-positions')
  createStaffingPosition(@HrCtx() c: HrRequestContext, @Body() dto: CreateStaffingPositionDto) {
    return this.staffing.createPosition(c.tenantId, c.membershipId, c.userId, dto);
  }

  @RequirePermissions(P.HR_STAFFING_EDIT)
  @Patch('staffing-positions/:id')
  updateStaffingPosition(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: UpdateStaffingPositionDto) {
    return this.staffing.updatePosition(c.tenantId, c.membershipId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('catalogs/:type')
  catalog(@HrCtx() c: HrRequestContext, @Param('type') type: string) {
    return this.policy.listCatalog(c.tenantId, type.toUpperCase());
  }

  @RequirePermissions(P.HR_CONFIG_MANAGE)
  @Post('catalogs/:type')
  addCatalogItem(@HrCtx() c: HrRequestContext, @Param('type') type: string, @Body() dto: CatalogItemDto) {
    return this.policy.addCatalogItem(c.tenantId, c.userId, type.toUpperCase(), dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('policies')
  getPolicy(@HrCtx() c: HrRequestContext) {
    return this.policy.getPolicy(c.tenantId);
  }

  @RequirePermissions(P.HR_CONFIG_MANAGE)
  @Put('policies')
  updatePolicy(@HrCtx() c: HrRequestContext, @Body() dto: UpdateHrPolicyDto) {
    return this.policy.updatePolicy(c.tenantId, c.userId, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('periods')
  listPeriods(@HrCtx() c: HrRequestContext) {
    return this.policy.listPeriods(c.tenantId);
  }

  @RequirePermissions(P.HR_CONFIG_MANAGE)
  @Post('periods')
  createPeriod(@HrCtx() c: HrRequestContext, @Body() dto: HrPeriodDto) {
    return this.policy.createPeriod(c.tenantId, c.userId, dto);
  }

  @RequirePermissions(P.HR_CONFIG_MANAGE)
  @Post('periods/:id/close')
  closePeriod(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.policy.setPeriodStatus(c.tenantId, c.userId, id, 'CLOSED');
  }

  @RequirePermissions(P.HR_CONFIG_MANAGE)
  @Post('periods/:id/reopen')
  reopenPeriod(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.policy.setPeriodStatus(c.tenantId, c.userId, id, 'OPEN');
  }

  /** Outbox read for downstream consumers (Phase 18/19/22). */
  @RequirePermissions(P.HR_VIEW_HISTORY)
  @Get('events')
  listEvents(@HrCtx() c: HrRequestContext, @Query('status') status?: string, @Query('eventType') eventType?: string, @Query('employmentId') employmentId?: string, @Query('employeeId') employeeId?: string, @Query('limit') limit?: string) {
    return this.events.list(c.tenantId, { status, eventType, employmentId, employeeId, limit: limit ? Number(limit) : undefined });
  }

  @RequirePermissions(P.HR_CONFIG_MANAGE)
  @Post('events/ack')
  ackEvents(@HrCtx() c: HrRequestContext, @Body() dto: AckEventsDto) {
    return this.events.acknowledge(c.tenantId, dto.ids);
  }
}

/** HR reports, org chart, headcount, staffing, health and import validation
 * (spec 52-54, 86-99, 112). */
@Controller('hr')
export class HrReportsController {
  constructor(
    private readonly reports: HrReportingService,
    private readonly health: HrHealthService,
    private readonly persons: PhysicalPersonService,
  ) {}

  @RequirePermissions(P.HR_STAFFING_VIEW)
  @Get('staffing')
  staffing(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId: string, @Query('asOf') asOf?: string) {
    return this.reports.staffing(c.tenantId, c.membershipId, { organizationId, asOf });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('headcount')
  headcount(@HrCtx() c: HrRequestContext, @Query('asOf') asOf?: string, @Query('organizationId') organizationId?: string, @Query('groupBy') groupBy?: string) {
    return this.reports.headcount(c.tenantId, c.membershipId, { asOf, organizationId, groupBy });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('org-chart')
  orgChart(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId: string, @Query('asOf') asOf?: string) {
    return this.reports.orgChart(c.tenantId, c.membershipId, { organizationId, asOf });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('reports/movement')
  movement(@HrCtx() c: HrRequestContext, @Query('from') from: string, @Query('to') to: string, @Query('organizationId') organizationId?: string, @Query('departmentId') departmentId?: string) {
    return this.reports.movement(c.tenantId, c.membershipId, { from, to, organizationId, departmentId });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('reports/hires')
  hires(@HrCtx() c: HrRequestContext, @Query('from') from?: string, @Query('to') to?: string, @Query('organizationId') organizationId?: string) {
    return this.reports.hires(c.tenantId, c.membershipId, { from, to, organizationId });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('reports/terminations')
  terminations(@HrCtx() c: HrRequestContext, @Query('from') from?: string, @Query('to') to?: string, @Query('organizationId') organizationId?: string) {
    return this.reports.terminations(c.tenantId, c.membershipId, { from, to, organizationId });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('reports/transfers')
  transfers(@HrCtx() c: HrRequestContext, @Query('from') from?: string, @Query('to') to?: string, @Query('organizationId') organizationId?: string, @Query('employmentId') employmentId?: string) {
    return this.reports.transfers(c.tenantId, c.membershipId, { from, to, organizationId, employmentId });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW, P.HR_CONTRACT_VIEW)
  @Get('reports/contract-expiry')
  contractExpiry(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('days') days?: string) {
    return this.reports.contractExpiry(c.tenantId, c.membershipId, { organizationId, days });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('reports/probation')
  probation(@HrCtx() c: HrRequestContext, @Query('organizationId') organizationId?: string, @Query('days') days?: string) {
    return this.reports.probation(c.tenantId, c.membershipId, { organizationId, days });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW, P.HR_LEAVE_VIEW, P.HR_ABSENCE_VIEW)
  @Get('reports/leave-absence')
  leaveAbsence(@HrCtx() c: HrRequestContext, @Query('from') from?: string, @Query('to') to?: string, @Query('organizationId') organizationId?: string) {
    return this.reports.leaveAbsence(c.tenantId, c.membershipId, { from, to, organizationId });
  }

  @RequirePermissions(P.HR_REPORTS_VIEW)
  @Get('health')
  healthReport(@HrCtx() c: HrRequestContext, @Query('asOf') asOf?: string, @Query('organizationId') organizationId?: string) {
    return this.health.run(c.tenantId, c.membershipId, { asOf, organizationId });
  }

  @RequirePermissions(P.HR_PERSON_CREATE, P.HR_EMPLOYEE_CREATE)
  @Post('import/validate')
  validateImport(@HrCtx() c: HrRequestContext, @Body() dto: ImportValidateDto) {
    return this.reports.validateImport(c.tenantId, this.persons, dto.rows);
  }
}
