/**
 * Phase 18 — Work Time / Timesheet Engine.
 *
 * Same direct-service testing style as test/phase17.e2e-spec.ts. Covers
 * the full pipeline for one worked day: schedule template + pattern ->
 * daily work plan -> attendance events -> interpreted interval -> time
 * entry (regular hours, break auto-deducted) -> generated timesheet ->
 * approve -> lock -> payroll time input (validate/approve/lock).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentPostingService } from '../src/document-framework/document-posting.service';
import { PhysicalPersonService } from '../src/hr/physical-person.service';
import { EmployeeService } from '../src/hr/employee.service';
import { PositionService } from '../src/hr/position.service';
import { HireService } from '../src/hr/hire.service';
import { HR_HIRE_TYPE } from '../src/hr/hire.repository';
import { WorkScheduleAssignmentService } from '../src/hr/work-schedule-assignment.service';
import { TimeCodeService } from '../src/work-time/time-code.service';
import { WorkScheduleService } from '../src/work-time/work-schedule.service';
import { DailyWorkPlanService } from '../src/work-time/daily-work-plan.service';
import { AttendanceService } from '../src/work-time/attendance.service';
import { TimeEntryService } from '../src/work-time/time-entry.service';
import { TimesheetService } from '../src/work-time/timesheet.service';
import { PayrollTimeInputService } from '../src/work-time/payroll-time-input.service';

describe('Phase 18 — Work Time Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: DocumentPostingService;
  let persons: PhysicalPersonService;
  let employees: EmployeeService;
  let positions: PositionService;
  let hires: HireService;
  let scheduleAssignments: WorkScheduleAssignmentService;
  let timeCodes: TimeCodeService;
  let schedules: WorkScheduleService;
  let dailyPlans: DailyWorkPlanService;
  let attendance: AttendanceService;
  let timeEntries: TimeEntryService;
  let timesheets: TimesheetService;
  let payrollInputs: PayrollTimeInputService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let membershipId: string;
  let userId: string;
  let employmentId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    posting = app.get(DocumentPostingService);
    persons = app.get(PhysicalPersonService);
    employees = app.get(EmployeeService);
    positions = app.get(PositionService);
    hires = app.get(HireService);
    scheduleAssignments = app.get(WorkScheduleAssignmentService);
    timeCodes = app.get(TimeCodeService);
    schedules = app.get(WorkScheduleService);
    dailyPlans = app.get(DailyWorkPlanService);
    attendance = app.get(AttendanceService);
    timeEntries = app.get(TimeEntryService);
    timesheets = app.get(TimesheetService);
    payrollInputs = app.get(PayrollTimeInputService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p18-${run}`, name: 'Phase 18 tenant' } });
    const currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A18${String(run).slice(-6)}`, name: 'Phase 18 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG18-${run}`, name: 'Phase 18 org', baseCurrencyId: currencyId } });
    const departmentId = randomUUID();
    await prisma.department.create({ data: { id: departmentId, tenantId, organizationId, code: `DEPT-${run}`, name: 'Operations' } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p18-${run}@e2e.test`, passwordHash: 'x', displayName: 'P18 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);

    const position = await positions.create(tenantId, userId, { code: `CLERK-${run}`, name: 'Clerk' });
    const person = await persons.create(tenantId, userId, { firstName: 'Aysel', lastName: 'Huseynova', personalId: `PID18-${run}` });
    const employee = await employees.create(tenantId, userId, { physicalPersonId: person.id });
    const { employment, hire } = await hires.create(tenantId, membershipId, organizationId, userId, { employeeId: employee.id, employmentType: 'FULL_TIME', hireDate: '2025-12-01', documentDate: '2025-11-25', departmentId, positionId: position.id, contractType: 'PERMANENT' });
    await posting.post(tenantId, HR_HIRE_TYPE, hire.id, 1, userId);
    employmentId = employment.id;

    await timeCodes.seedDefaults(tenantId, userId);
    const shift = await schedules.createShiftTemplate(tenantId, userId, { code: `SHIFT-${run}`, name: '9-to-6', startTime: '09:00', endTime: '18:00', breakMinutes: 60, plannedHours: 8 });
    const template = await schedules.createTemplate(tenantId, userId, { code: `STD-${run}`, name: 'Standard 5-day week', scheduleType: 'STANDARD_WEEK', cycleLengthDays: 7 });
    for (let cycleDay = 1; cycleDay <= 5; cycleDay++) await schedules.addPattern(tenantId, userId, template.id, { cycleDay, plannedHours: 8, shiftTemplateId: shift.id, dayType: 'WORKDAY' });
    for (let cycleDay = 6; cycleDay <= 7; cycleDay++) await schedules.addPattern(tenantId, userId, template.id, { cycleDay, plannedHours: 0, dayType: 'OFF' });

    await scheduleAssignments.change(tenantId, userId, { employmentId, workScheduleId: template.id, effectiveFrom: '2026-01-05' }); // a Monday
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates a daily plan, interprets attendance, produces a locked timesheet, and generates payroll time input', async () => {
    await dailyPlans.generate(tenantId, userId, employmentId, new Date('2026-01-05'), new Date('2026-01-09'));
    const monday = await prisma.employeeDailyWorkPlan.findUniqueOrThrow({ where: { employmentId_date: { employmentId, date: new Date('2026-01-05') } } });
    expect(monday.plannedHours.toString()).toBe('8');
    const saturday = await dailyPlans.getPlan(tenantId, employmentId, new Date('2026-01-10'), new Date('2026-01-10'));
    expect(saturday[0]?.plannedDayType).toBe('WEEKEND');

    await attendance.recordEvent(tenantId, userId, { employmentId, eventTimestamp: '2026-01-05T09:00:00.000Z', eventType: 'CLOCK_IN', sourceSystem: 'MANUAL' });
    await attendance.recordEvent(tenantId, userId, { employmentId, eventTimestamp: '2026-01-05T18:00:00.000Z', eventType: 'CLOCK_OUT', sourceSystem: 'MANUAL' });
    const intervals = await attendance.interpretDay(tenantId, userId, employmentId, new Date('2026-01-05'));
    expect(intervals).toHaveLength(1);
    expect(intervals[0].status).toBe('COMPLETE');

    const entries = await timeEntries.generateFromAttendance(tenantId, userId, employmentId, new Date('2026-01-05'));
    expect(entries).toHaveLength(1);
    expect(entries[0].hours.toString()).toBe('8'); // 9h attendance - 1h break = 8h, capped at the 8h plan

    const timesheet = await timesheets.generate(tenantId, membershipId, organizationId, userId, { periodStart: '2026-01-05', periodEnd: '2026-01-09' });
    const mondayLine = timesheet.lines.find((l) => l.workDate.toISOString().slice(0, 10) === '2026-01-05');
    expect(mondayLine?.regularHours.toString()).toBe('8');
    expect(mondayLine?.validationStatus).toBe('OK');

    await timesheets.submit(tenantId, membershipId, organizationId, userId, timesheet.id);
    await timesheets.approve(tenantId, membershipId, organizationId, userId, timesheet.id);
    const locked = await timesheets.lock(tenantId, membershipId, organizationId, userId, timesheet.id);
    expect(locked.status).toBe('LOCKED');

    const inputRows = await payrollInputs.generate(tenantId, membershipId, organizationId, userId, timesheet.id);
    const regularRow = inputRows.find((r) => r.timeCode === 'REGULAR_WORK');
    expect(regularRow?.hours.toString()).toBe('8');
    expect(regularRow?.status).toBe('DRAFT');

    const payrollPeriod = '2026-01-01';
    await payrollInputs.validate(tenantId, membershipId, organizationId, userId, payrollPeriod);
    await payrollInputs.approve(tenantId, membershipId, organizationId, userId, payrollPeriod);
    const lockResult = await payrollInputs.lock(tenantId, membershipId, organizationId, userId, payrollPeriod);
    expect(lockResult.count).toBeGreaterThan(0);

    const forPayroll = await payrollInputs.forPayroll(tenantId, organizationId, new Date(payrollPeriod));
    expect(forPayroll.every((r) => r.status === 'LOCKED')).toBe(true);
  });
});
