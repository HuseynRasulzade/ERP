import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentPostingService } from '../document-framework/document-posting.service';
import { PhysicalPersonService } from './physical-person.service';
import { EmployeeService } from './employee.service';
import { PositionService } from './position.service';
import { StaffingService } from './staffing.service';
import { EmployeeAssignmentService } from './employee-assignment.service';
import { EmploymentContractService } from './employment-contract.service';
import { HireService } from './hire.service';
import { HR_HIRE_TYPE } from './hire.repository';
import { EmployeeTransferService } from './employee-transfer.service';
import { HR_TRANSFER_TYPE } from './employee-transfer.repository';
import { TerminationService } from './termination.service';
import { HR_TERMINATION_TYPE } from './termination.repository';
import { WorkScheduleAssignmentService } from './work-schedule-assignment.service';
import { LeaveService } from './leave.service';
import { EmployeeAttributeHistoryService } from './employee-attribute-history.service';
import { HRReportingService } from './hr-reporting.service';
import { HRHealthService } from './hr-health.service';
import {
  CreatePhysicalPersonDto,
  CheckDuplicatesDto,
  CreateEmployeeDto,
  CreatePositionDto,
  CreateStaffingTableDto,
  AddStaffingPositionDto,
  CreateHireDto,
  AmendContractDto,
  CreateTransferDto,
  CreateTerminationDto,
  ChangeScheduleDto,
  RequestLeaveDto,
  RecordAbsenceDto,
  SetAttributeDto,
} from './dto/hr.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

/**
 * HR Core API (docx spec Phase 17). See docs/HR_CORE.md. `PhysicalPerson`/
 * `Employee` are tenant-wide concepts (spec section 1) — every route
 * still nests under `:organizationId` for the same access-gate every
 * other controller in this codebase uses, but the underlying service
 * calls carry no organization scoping for those two entities.
 */
@Controller('organizations/:organizationId/hr')
export class HRController {
  constructor(
    private readonly access: OrganizationAccessService,
    private readonly persons: PhysicalPersonService,
    private readonly employees: EmployeeService,
    private readonly positions: PositionService,
    private readonly staffing: StaffingService,
    private readonly assignments: EmployeeAssignmentService,
    private readonly contracts: EmploymentContractService,
    private readonly hires: HireService,
    private readonly transfers: EmployeeTransferService,
    private readonly terminations: TerminationService,
    private readonly schedules: WorkScheduleAssignmentService,
    private readonly leave: LeaveService,
    private readonly attributes: EmployeeAttributeHistoryService,
    private readonly reporting: HRReportingService,
    private readonly health: HRHealthService,
    private readonly posting: DocumentPostingService,
  ) {}

  // --- Physical persons (tenant-wide) ---
  @RequirePermissions(PermissionCodes.HR_PERSON_VIEW)
  @Post('persons/check-duplicates')
  async checkDuplicates(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Body() dto: CheckDuplicatesDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.persons.checkDuplicates(tenantId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_PERSON_CREATE)
  @Post('persons')
  async createPerson(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreatePhysicalPersonDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.persons.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_PERSON_VIEW)
  @Get('persons')
  async listPersons(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('search') search?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.persons.list(tenantId, search);
  }

  // --- Employees (tenant-wide) ---
  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_CREATE)
  @Post('employees')
  async createEmployee(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateEmployeeDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.employees.create(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('employees')
  async listEmployees(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.employees.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('employees/:id')
  async getEmployee(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.employees.get(tenantId, id);
  }

  // --- Positions ---
  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get('positions')
  async listPositions(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.positions.list(tenantId);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post('positions')
  async createPosition(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreatePositionDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.positions.create(tenantId, user.userId, dto);
  }

  // --- Staffing ---
  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post('staffing-tables')
  createStaffingTable(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateStaffingTableDto) {
    return this.staffing.createTable(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_EDIT)
  @Post('staffing-positions')
  addStaffingPosition(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: AddStaffingPositionDto) {
    return this.staffing.addPosition(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get('staffing-positions')
  listStaffingPositions(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.staffing.list(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_STAFFING_VIEW)
  @Get('staffing-positions/:id/capacity')
  staffingCapacity(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Param('id') id: string) {
    return this.staffing.capacity(tenantId, membershipId, organizationId, id);
  }

  // --- Hire ---
  @RequirePermissions(PermissionCodes.HR_HIRE_CREATE)
  @Post('hire')
  createHire(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateHireDto) {
    return this.hires.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_HIRE_POST)
  @Post('hire/:id/post')
  postHire(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, HR_HIRE_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.HR_HIRE_POST)
  @Post('hire/:id/unpost')
  unpostHire(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.unpost(tenantId, HR_HIRE_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYMENT_CREATE)
  @Get('hire')
  listHires(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.hires.list(tenantId, membershipId, organizationId);
  }

  // --- Contracts ---
  @RequirePermissions(PermissionCodes.HR_CONTRACT_EDIT)
  @Post('contracts/:id/amend')
  amendContract(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body() dto: AmendContractDto) {
    return this.contracts.amend(tenantId, user.userId, id, dto);
  }

  @RequirePermissions(PermissionCodes.HR_CONTRACT_VIEW)
  @Get('employments/:employmentId/contracts')
  contractHistory(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string) {
    return this.contracts.history(tenantId, employmentId);
  }

  // --- Transfer ---
  @RequirePermissions(PermissionCodes.HR_TRANSFER_CREATE)
  @Post('transfers')
  createTransfer(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateTransferDto) {
    return this.transfers.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_TRANSFER_POST)
  @Post('transfers/:id/post')
  postTransfer(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, HR_TRANSFER_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.HR_TRANSFER_POST)
  @Post('transfers/:id/unpost')
  unpostTransfer(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.unpost(tenantId, HR_TRANSFER_TYPE, id, expectedVersion, user.userId);
  }

  // --- Termination ---
  @RequirePermissions(PermissionCodes.HR_TERMINATE_CREATE)
  @Post('terminations')
  createTermination(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @CurrentUser() user: { userId: string }, @Body() dto: CreateTerminationDto) {
    return this.terminations.create(tenantId, membershipId, organizationId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_TERMINATE_POST)
  @Post('terminations/:id/post')
  postTermination(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.post(tenantId, HR_TERMINATION_TYPE, id, expectedVersion, user.userId);
  }

  @RequirePermissions(PermissionCodes.HR_TERMINATE_POST)
  @Post('terminations/:id/unpost')
  unpostTermination(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }, @Body('expectedVersion') expectedVersion: number) {
    return this.posting.unpost(tenantId, HR_TERMINATION_TYPE, id, expectedVersion, user.userId);
  }

  // --- Schedule / leave / absence ---
  @RequirePermissions(PermissionCodes.HR_EMPLOYMENT_CREATE)
  @Post('schedule-assignments')
  changeSchedule(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: ChangeScheduleDto) {
    return this.schedules.change(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_VIEW)
  @Post('leave-requests')
  requestLeave(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: RequestLeaveDto) {
    return this.leave.requestLeave(tenantId, user.userId, dto);
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_VIEW)
  @Post('leave-requests/:id/approve')
  approveLeave(@CurrentTenantId() tenantId: string, @Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.leave.approveLeave(tenantId, user.userId, id);
  }

  @RequirePermissions(PermissionCodes.HR_ABSENCE_VIEW)
  @Post('absence-records')
  recordAbsence(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: RecordAbsenceDto) {
    return this.leave.recordAbsence(tenantId, user.userId, dto);
  }

  // --- Attribute history ---
  @RequirePermissions(PermissionCodes.HR_VIEW_SENSITIVE_DATA)
  @Post('attributes')
  setAttribute(@CurrentTenantId() tenantId: string, @CurrentUser() user: { userId: string }, @Body() dto: SetAttributeDto) {
    return this.attributes.set(tenantId, user.userId, dto);
  }

  // --- Employment history / as-of-date ---
  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get('employments/:employmentId/assignments')
  assignmentHistory(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string) {
    return this.assignments.history(tenantId, employmentId);
  }

  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get('employments/:employmentId/state-as-of')
  stateAsOf(@CurrentTenantId() tenantId: string, @Param('employmentId') employmentId: string, @Query('asOfDate') asOfDate: string) {
    return this.assignments.getStateAsOf(tenantId, employmentId, new Date(asOfDate));
  }

  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get('org-chart')
  orgChart(@CurrentTenantId() tenantId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate?: string) {
    return this.assignments.orgChartAsOf(tenantId, organizationId, asOfDate ? new Date(asOfDate) : new Date());
  }

  // --- Reports ---
  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('reports/headcount')
  headcountReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('asOfDate') asOfDate: string) {
    return this.reporting.headcountReport(tenantId, membershipId, organizationId, asOfDate);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('reports/employee-list')
  employeeList(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.employeeList(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('reports/movements')
  movementReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.reporting.movementReport(tenantId, membershipId, organizationId, periodStart, periodEnd);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('reports/hires')
  hireReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.hireReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('reports/terminations')
  terminationReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.terminationReport(tenantId, membershipId, organizationId);
  }

  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get('reports/transfer-history')
  transferHistoryReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('employmentId') employmentId?: string) {
    return this.reporting.transferHistoryReport(tenantId, membershipId, organizationId, employmentId);
  }

  @RequirePermissions(PermissionCodes.HR_CONTRACT_VIEW)
  @Get('reports/contract-expiry')
  contractExpiryReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('withinDays') withinDays?: string) {
    return this.reporting.contractExpiryReport(tenantId, membershipId, organizationId, withinDays ? Number(withinDays) : undefined);
  }

  @RequirePermissions(PermissionCodes.HR_EMPLOYEE_VIEW)
  @Get('reports/probation')
  probationReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string, @Query('withinDays') withinDays?: string) {
    return this.reporting.probationReport(tenantId, membershipId, organizationId, withinDays ? Number(withinDays) : undefined);
  }

  @RequirePermissions(PermissionCodes.HR_LEAVE_VIEW)
  @Get('reports/leave-absence')
  leaveAbsenceReport(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    return this.reporting.leaveAbsenceReport(tenantId, membershipId, organizationId);
  }

  // --- Health ---
  @RequirePermissions(PermissionCodes.HR_VIEW_HISTORY)
  @Get('health')
  async healthCheck(@CurrentTenantId() tenantId: string, @CurrentMembershipId() membershipId: string, @Param('organizationId') organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.health.check(tenantId, organizationId);
  }
}
