/**
 * Work Time / Timesheet Engine E2E tests (docx spec Phase 18) — the spec's
 * own final end-to-end scenario (section 172): production calendar
 * (holiday + shortened day), standard schedule, daily plan generation,
 * regular attendance with break deduction, partial absence, approved
 * overtime, night-shift crossing midnight, holiday work, mid-month
 * department transfer, annual leave, timesheet generate/submit/approve/
 * lock, WorkTimeRegister + PayrollTimeInputRegister generation — plus
 * duplicate/missing-punch detection, an unapproved-overtime exception that
 * blocks approval, locked-period/timesheet protection, and a backdated
 * correction against an already-locked timesheet.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('Work Time / Timesheet Engine (e2e)', () => {
  let app: INestApplication;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let deptAId: string;
  let deptBId: string;
  let positionId: string;
  let templateId: string;
  let employmentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const s1 = await setupTenant(`wt1-${run}@e2e.test`, `wt-t1-${run}`, 'WT1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;

    const deptA = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
    )
      .send({ code: `FIN-${run}`, name: 'Finance' })
      .expect(201);
    deptAId = deptA.body.id;
    const deptB = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
    )
      .send({ code: `TRE-${run}`, name: 'Treasury' })
      .expect(201);
    deptBId = deptB.body.id;

    const position = await auth1(
      request(app.getHttpServer()).post('/hr/positions'),
    )
      .send({ code: `ACC-${run}`, name: 'Accountant' })
      .expect(201);
    positionId = position.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(
    email: string,
    tenantCode: string,
    orgCode: string,
  ) {
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Test1234!', displayName: 'Test User' })
      .expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: tenantCode,
        name: `${tenantCode} Corp`,
        baseCurrencyCode: 'AZN',
      })
      .expect(201);
    const tenantId = tenantRes.body.id;
    const orgRes = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', tenantId)
      .send({ code: orgCode, name: `${orgCode} Org` })
      .expect(201);
    return { token, tenantId, orgId: orgRes.body.id };
  }

  function auth1(req: request.Test) {
    return req
      .set('Authorization', `Bearer ${token1}`)
      .set('X-Tenant-Id', tenant1Id);
  }

  async function hireEmployee(
    firstName: string,
    lastName: string,
    personalId: string,
    departmentId: string,
  ) {
    const draft = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents`,
      ),
    )
      .send({
        newPerson: { firstName, lastName, personalId },
        employmentType: 'PRIMARY',
        hireDate: '2026-01-01',
        departmentId,
        positionId,
      })
      .expect(201);
    const posted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: draft.body.version })
      .expect(201);
    return posted.body.employmentId as string;
  }

  function clockEvent(empId: string, timestamp: string, eventType: string) {
    return auth1(
      request(app.getHttpServer()).post('/work-time/attendance/events'),
    )
      .send({ employmentId: empId, eventTimestamp: timestamp, eventType })
      .expect(201);
  }

  // ---------------------------------------------------------------------
  // Attendance idempotency + missing/duplicate punch detection
  // ---------------------------------------------------------------------

  it('is idempotent on (sourceSystem, externalEventId) re-import', async () => {
    const emp = await hireEmployee(
      'Idem',
      'Potent',
      `PID-${run}-IDEM`,
      deptAId,
    );
    const first = await auth1(
      request(app.getHttpServer()).post('/work-time/attendance/events'),
    )
      .send({
        employmentId: emp,
        eventTimestamp: '2026-02-01T09:00:00Z',
        eventType: 'CLOCK_IN',
        sourceSystem: 'BIOMETRIC',
        externalEventId: `EXT-${run}-1`,
      })
      .expect(201);
    const second = await auth1(
      request(app.getHttpServer()).post('/work-time/attendance/events'),
    )
      .send({
        employmentId: emp,
        eventTimestamp: '2026-02-01T09:00:00Z',
        eventType: 'CLOCK_IN',
        sourceSystem: 'BIOMETRIC',
        externalEventId: `EXT-${run}-1`,
      })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const events = await auth1(
      request(app.getHttpServer()).get(
        `/work-time/attendance/events?employmentId=${emp}&fromDate=2026-02-01&toDate=2026-02-01`,
      ),
    ).expect(200);
    expect(events.body).toHaveLength(1);
  });

  it('detects a missing clock-out and a duplicate punch', async () => {
    const emp = await hireEmployee(
      'Missing',
      'Punch',
      `PID-${run}-MISS`,
      deptAId,
    );
    await clockEvent(emp, '2026-02-02T09:00:00Z', 'CLOCK_IN');
    // No CLOCK_OUT for this day.
    await clockEvent(emp, '2026-02-03T09:00:00Z', 'CLOCK_IN');
    await clockEvent(emp, '2026-02-03T09:00:30Z', 'CLOCK_IN'); // duplicate within 2 min
    await clockEvent(emp, '2026-02-03T18:00:00Z', 'CLOCK_OUT');

    const intervals = await auth1(
      request(app.getHttpServer()).post('/work-time/attendance/interpret'),
    )
      .send({ employmentId: emp, fromDate: '2026-02-01', toDate: '2026-02-04' })
      .expect(201);

    const statuses = intervals.body.map((i: any) => i.status);
    expect(statuses).toContain('MISSING_CLOCK_OUT');
    expect(statuses).toContain('DUPLICATE_FLAGGED');
  });

  // ---------------------------------------------------------------------
  // Main end-to-end scenario (spec section 172)
  // ---------------------------------------------------------------------

  it('generates a production calendar with a holiday and a shortened day', async () => {
    const calendar = await auth1(
      request(app.getHttpServer()).post('/work-time/calendars'),
    )
      .send({
        organizationId: org1Id,
        year: 2026,
        name: `Calendar ${run}`,
        effectiveFrom: '2026-01-01',
      })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/calendars/${calendar.body.id}/days`,
      ),
    )
      .send({
        days: [
          { date: '2026-09-15', dayType: 'HOLIDAY', holidayCode: 'H1' },
          {
            date: '2026-09-30',
            dayType: 'SHORTENED_WORKDAY',
            shortenedByHours: 1,
          },
        ],
      })
      .expect(201);
  });

  it('creates a standard 5-day work schedule template', async () => {
    const template = await auth1(
      request(app.getHttpServer()).post('/work-time/schedules'),
    )
      .send({
        code: `STD5-${run}`,
        name: 'Standard 5-Day',
        scheduleType: 'STANDARD_WEEK',
        cycleLengthDays: 7,
      })
      .expect(201);
    templateId = template.body.id;

    // cycleDay: 1=Thu 2=Fri 3=Sat 4=Sun 5=Mon 6=Tue 7=Wed (epoch-anchored).
    const patterns = [
      {
        cycleDay: 1,
        dayType: 'WORK',
        plannedHours: 8,
        breakDurationMinutes: 0,
        workStartTime: '09:00',
        workEndTime: '18:00',
      },
      {
        cycleDay: 2,
        dayType: 'WORK',
        plannedHours: 8,
        breakDurationMinutes: 0,
        workStartTime: '09:00',
        workEndTime: '18:00',
      },
      { cycleDay: 3, dayType: 'OFF' },
      { cycleDay: 4, dayType: 'OFF' },
      {
        cycleDay: 5,
        dayType: 'WORK',
        plannedHours: 8,
        breakDurationMinutes: 60,
        workStartTime: '09:00',
        workEndTime: '18:00',
      },
      {
        cycleDay: 6,
        dayType: 'WORK',
        plannedHours: 8,
        breakDurationMinutes: 60,
        workStartTime: '09:00',
        workEndTime: '18:00',
      },
      {
        cycleDay: 7,
        dayType: 'WORK',
        plannedHours: 8,
        breakDurationMinutes: 60,
        workStartTime: '09:00',
        workEndTime: '18:00',
      },
    ];
    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/schedules/${templateId}/patterns/bulk`,
      ),
    )
      .send({ patterns })
      .expect(201);
  });

  it('hires the employee, assigns the schedule, transfers mid-month, and requests annual leave', async () => {
    employmentId = await hireEmployee(
      'Sabina',
      'Valiyeva',
      `PID-${run}-MAIN`,
      deptAId,
    );

    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/work-schedule-assignments`,
      ),
    )
      .send({
        employmentId,
        workScheduleCode: `STD5-${run}`,
        effectiveFrom: '2026-01-01',
      })
      .expect(201);

    const transferDraft = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/transfers`,
      ),
    )
      .send({
        employmentId,
        transferType: 'DEPARTMENT_TRANSFER',
        effectiveDate: '2026-09-16',
        newDepartmentId: deptBId,
      })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/transfers/${transferDraft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: transferDraft.body.version })
      .expect(201);

    const leaveDraft = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/leave-records`,
      ),
    )
      .send({
        employmentId,
        leaveType: 'ANNUAL',
        startDate: '2026-09-20',
        endDate: '2026-09-22',
      })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/leave-records/${leaveDraft.body.id}/approve`,
      ),
    )
      .send({ expectedVersion: leaveDraft.body.version })
      .expect(201);

    const overtimeDraft = await auth1(
      request(app.getHttpServer()).post('/work-time/overtime'),
    )
      .send({ employmentId, date: '2026-09-17', requestedHours: 2 })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/overtime/${overtimeDraft.body.id}/approve`,
      ),
    )
      .send({ approvedHours: 2 })
      .expect(201);
  });

  it('generates the daily work plan for September and reflects calendar + transfer', async () => {
    await auth1(request(app.getHttpServer()).post('/work-time/plans/generate'))
      .send({ employmentId, fromDate: '2026-09-01', toDate: '2026-09-30' })
      .expect(201);

    const plans = await auth1(
      request(app.getHttpServer()).get(
        `/work-time/plans?employmentId=${employmentId}&fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(200);
    const byDate = (d: string) =>
      plans.body.find((p: any) => p.date.startsWith(d));

    expect(Number(byDate('2026-09-01').plannedHours)).toBe(8);
    expect(byDate('2026-09-01').plannedDayType).toBe('WORKDAY');
    expect(Number(byDate('2026-09-15').plannedHours)).toBe(0);
    expect(byDate('2026-09-15').plannedDayType).toBe('HOLIDAY');
    expect(Number(byDate('2026-09-30').plannedHours)).toBe(7);
    expect(byDate('2026-09-30').plannedDayType).toBe('SHORTENED_WORKDAY');
    expect(byDate('2026-09-01').departmentId).toBe(deptAId);
    expect(byDate('2026-09-16').departmentId).toBe(deptBId);
    expect(Number(byDate('2026-09-05').plannedHours)).toBe(0); // Saturday
  });

  it('records attendance for the test days and interprets it', async () => {
    await clockEvent(employmentId, '2026-09-01T09:00:00Z', 'CLOCK_IN'); // regular, break 60
    await clockEvent(employmentId, '2026-09-01T18:00:00Z', 'CLOCK_OUT');

    await clockEvent(employmentId, '2026-09-02T09:00:00Z', 'CLOCK_IN'); // partial absence day
    await clockEvent(employmentId, '2026-09-02T16:00:00Z', 'CLOCK_OUT');

    await clockEvent(employmentId, '2026-09-10T20:00:00Z', 'CLOCK_IN'); // night shift, crosses midnight
    await clockEvent(employmentId, '2026-09-11T04:00:00Z', 'CLOCK_OUT');

    await clockEvent(employmentId, '2026-09-15T09:00:00Z', 'CLOCK_IN'); // holiday work
    await clockEvent(employmentId, '2026-09-15T16:00:00Z', 'CLOCK_OUT');

    await clockEvent(employmentId, '2026-09-16T09:00:00Z', 'CLOCK_IN'); // first day in Treasury
    await clockEvent(employmentId, '2026-09-16T18:00:00Z', 'CLOCK_OUT');

    await clockEvent(employmentId, '2026-09-17T09:00:00Z', 'CLOCK_IN'); // approved overtime
    await clockEvent(employmentId, '2026-09-17T19:00:00Z', 'CLOCK_OUT');

    await auth1(
      request(app.getHttpServer()).post('/work-time/attendance/interpret'),
    )
      .send({ employmentId, fromDate: '2026-09-01', toDate: '2026-09-30' })
      .expect(201);
  });

  it('normalizes attendance and leave/absence into TimeEntry rows', async () => {
    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/time-entries/generate-from-attendance?employmentId=${employmentId}&fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(201);

    await auth1(request(app.getHttpServer()).post('/work-time/time-entries'))
      .send({
        employmentId,
        workDate: '2026-09-02',
        hours: 2,
        timeCode: 'ABSENCE',
      })
      .expect(201);

    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/time-entries/generate-from-leave-absence?employmentId=${employmentId}&fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(201);

    const entries = await auth1(
      request(app.getHttpServer()).get(
        `/work-time/time-entries?employmentId=${employmentId}&fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(200);
    expect(entries.body.length).toBeGreaterThan(5);
  });

  let timesheetId: string;

  it('generates the timesheet with correct plan-vs-actual, overtime, night, and holiday classification', async () => {
    const generated = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/generate`,
      ),
    )
      .send({
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        employmentIds: [employmentId],
      })
      .expect(201);
    timesheetId = generated.body.id;
    expect(generated.body.status).toBe('GENERATED');

    const byDate = (d: string) =>
      generated.body.lines.find((l: any) => l.workDate.startsWith(d));

    const sept1 = byDate('2026-09-01');
    expect(Number(sept1.regularHours)).toBe(8);
    expect(sept1.validationStatus).toBe('OK');

    const sept2 = byDate('2026-09-02');
    expect(Number(sept2.regularHours)).toBe(6);
    expect(Number(sept2.absenceHours)).toBe(2);
    expect(sept2.validationStatus).toBe('OK');

    const sept10 = byDate('2026-09-10');
    expect(Number(sept10.regularHours)).toBe(8);
    expect(Number(sept10.overtimeHours)).toBe(0);
    expect(Number(sept10.nightHours)).toBe(6);

    const sept15 = byDate('2026-09-15');
    expect(Number(sept15.regularHours)).toBe(6);
    expect(Number(sept15.holidayHours)).toBe(6);

    const sept16 = byDate('2026-09-16');
    expect(sept16.departmentId).toBe(deptBId);
    expect(Number(sept16.regularHours)).toBe(8);

    const sept17 = byDate('2026-09-17');
    expect(Number(sept17.regularHours)).toBe(8);
    expect(Number(sept17.overtimeHours)).toBe(2);
    expect(sept17.validationStatus).toBe('OK');

    const sept21 = byDate('2026-09-21');
    expect(Number(sept21.leaveHours)).toBe(8);
  });

  it('submits, approves, and locks the timesheet, writing the Work Time Register', async () => {
    const submitted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${timesheetId}/submit`,
      ),
    )
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(submitted.body.status).toBe('PENDING_APPROVAL');

    const approved = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${timesheetId}/approve`,
      ),
    )
      .send({ expectedVersion: submitted.body.version })
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');

    const locked = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${timesheetId}/lock`,
      ),
    )
      .send({ expectedVersion: approved.body.version })
      .expect(201);
    expect(locked.body.status).toBe('LOCKED');
  });

  it('generates the Payroll Time Input Register from the locked timesheet, no money calculations', async () => {
    const inputs = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/payroll-inputs/generate`,
      ),
    )
      .send({
        payrollPeriodStart: '2026-09-01',
        payrollPeriodEnd: '2026-09-30',
      })
      .expect(201);

    const byCode = (c: string) =>
      inputs.body.find(
        (i: any) => i.timeCode === c && i.employmentId === employmentId,
      );
    expect(byCode('REGULAR_WORK')).toBeTruthy();
    expect(byCode('OVERTIME')).toBeTruthy();
    expect(Number(byCode('OVERTIME').hours)).toBe(2);
    expect(byCode('NIGHT_WORK')).toBeTruthy();
    expect(Number(byCode('NIGHT_WORK').hours)).toBe(6);
    expect(byCode('HOLIDAY_WORK')).toBeTruthy();
    expect(byCode('ANNUAL_LEAVE')).toBeTruthy();
    expect(byCode('NORM_HOURS')).toBeTruthy();
    expect(byCode('WORKED_DAYS')).toBeTruthy();

    for (const row of inputs.body) {
      expect(row).not.toHaveProperty('amount');
      expect(row).not.toHaveProperty('rate');
    }
  });

  it('blocks a direct TimeEntry edit against a locked timesheet date and requires a Time Correction', async () => {
    const period = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/periods`,
      ),
    )
      .send({ periodStart: '2026-09-01', periodEnd: '2026-09-30' })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/periods/${period.body.id}/lock`,
      ),
    ).expect(201);

    await auth1(request(app.getHttpServer()).post('/work-time/time-entries'))
      .send({
        employmentId,
        workDate: '2026-09-01',
        hours: 1,
        timeCode: 'OTHER',
      })
      .expect(400);

    const originalEntry = (
      await auth1(
        request(app.getHttpServer()).get(
          `/work-time/time-entries?employmentId=${employmentId}&fromDate=2026-09-01&toDate=2026-09-01`,
        ),
      ).expect(200)
    ).body.find((e: any) => e.timeCode === 'REGULAR_WORK');

    const correction = await auth1(
      request(app.getHttpServer()).post('/work-time/corrections'),
    )
      .send({
        employmentId,
        workDate: '2026-09-01',
        originalTimeEntryId: originalEntry.id,
        correctedHours: 7.5,
        reason: 'Late-arriving manager adjustment',
      })
      .expect(201);
    const applied = await auth1(
      request(app.getHttpServer()).post(
        `/work-time/corrections/${correction.body.id}/apply`,
      ),
    ).expect(201);
    expect(applied.body.status).toBe('APPLIED');
    expect(applied.body.requiresRecalculation).toBe(true);

    const health = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/work-time/reports/health`,
      ),
    ).expect(200);
    expect(
      health.body.some((i: any) => i.code === 'RECALCULATION_REQUIRED'),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Unapproved overtime → exception blocks approval
  // ---------------------------------------------------------------------

  it('flags unapproved excess hours as an exception and blocks approval until resolved', async () => {
    const emp = await hireEmployee(
      'Kamran',
      'Ismayilov',
      `PID-${run}-UNAPP`,
      deptAId,
    );
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/work-schedule-assignments`,
      ),
    )
      .send({
        employmentId: emp,
        workScheduleCode: `STD5-${run}`,
        effectiveFrom: '2026-01-01',
      })
      .expect(201);
    await auth1(request(app.getHttpServer()).post('/work-time/plans/generate'))
      .send({ employmentId: emp, fromDate: '2026-10-01', toDate: '2026-10-01' })
      .expect(201);

    await clockEvent(emp, '2026-10-01T09:00:00Z', 'CLOCK_IN');
    await clockEvent(emp, '2026-10-01T19:00:00Z', 'CLOCK_OUT'); // 10h, no overtime approval
    await auth1(
      request(app.getHttpServer()).post('/work-time/attendance/interpret'),
    )
      .send({ employmentId: emp, fromDate: '2026-10-01', toDate: '2026-10-01' })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/time-entries/generate-from-attendance?employmentId=${emp}&fromDate=2026-10-01&toDate=2026-10-01`,
      ),
    ).expect(201);

    const generated = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/generate`,
      ),
    )
      .send({
        periodStart: '2026-10-01',
        periodEnd: '2026-10-01',
        employmentIds: [emp],
      })
      .expect(201);
    const line = generated.body.lines[0];
    expect(Number(line.regularHours)).toBe(8);
    expect(Number(line.overtimeHours)).toBe(0);
    expect(line.validationStatus).toBe('EXCEPTION');

    const submitted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${generated.body.id}/submit`,
      ),
    )
      .send({ expectedVersion: 1 })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${generated.body.id}/approve`,
      ),
    )
      .send({ expectedVersion: submitted.body.version })
      .expect(400);
  });

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------

  it('produces plan-vs-actual, overtime, night, and holiday/weekend reports', async () => {
    const planVsActual = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/work-time/reports/plan-vs-actual?fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(200);
    expect(Array.isArray(planVsActual.body)).toBe(true);

    const overtime = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/work-time/reports/overtime?fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(200);
    expect(
      overtime.body.some((r: any) => r.employmentId === employmentId),
    ).toBe(true);

    const night = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/work-time/reports/night-work?fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(200);
    expect(night.body.length).toBeGreaterThan(0);

    const holidayWeekend = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/work-time/reports/holiday-weekend-work?fromDate=2026-09-01&toDate=2026-09-30`,
      ),
    ).expect(200);
    expect(holidayWeekend.body.length).toBeGreaterThan(0);
  });
});
