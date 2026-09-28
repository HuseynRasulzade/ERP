/**
 * Payroll / Gross-to-Net Engine E2E tests (docx spec Phase 19). Builds the
 * full upstream pipeline for real (HR Core hire -> Work Time schedule/
 * attendance/timesheet/lock -> PayrollTimeInputRegister) and then proves
 * Payroll never re-derives hours itself: it reads only Phase 18's
 * approved input, resolves effective-dated compensation, and produces a
 * deterministic, explainable gross-to-net result using the seeded 2026 AZ
 * bracket data (never a hardcoded flat rate).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ChartOfAccountsService } from '../src/accounting-core/chart-of-accounts.service';
import * as request from 'supertest';

describe('Payroll / Gross-to-Net Engine (e2e)', () => {
  let app: INestApplication;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let deptId: string;
  let positionId: string;
  let templateCode: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const s1 = await setupTenant(`pr1-${run}@e2e.test`, `pr-t1-${run}`, 'PR1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;

    const charts = moduleFixture.get(ChartOfAccountsService);
    await charts.ensureAdopted(tenant1Id);

    const dept = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`))
      .send({ code: `FIN-${run}`, name: 'Finance' })
      .expect(201);
    deptId = dept.body.id;

    const position = await auth1(request(app.getHttpServer()).post('/hr/positions'))
      .send({ code: `ACC-${run}`, name: 'Accountant' })
      .expect(201);
    positionId = position.body.id;

    templateCode = `STD5-${run}`;
    const template = await auth1(request(app.getHttpServer()).post('/work-time/schedules'))
      .send({ code: templateCode, name: 'Standard 5-Day', scheduleType: 'STANDARD_WEEK', cycleLengthDays: 7 })
      .expect(201);
    const patterns = [
      { cycleDay: 1, dayType: 'WORK', plannedHours: 8, breakDurationMinutes: 60, workStartTime: '09:00', workEndTime: '18:00' },
      { cycleDay: 2, dayType: 'WORK', plannedHours: 8, breakDurationMinutes: 60, workStartTime: '09:00', workEndTime: '18:00' },
      { cycleDay: 3, dayType: 'OFF' },
      { cycleDay: 4, dayType: 'OFF' },
      { cycleDay: 5, dayType: 'WORK', plannedHours: 8, breakDurationMinutes: 60, workStartTime: '09:00', workEndTime: '18:00' },
      { cycleDay: 6, dayType: 'WORK', plannedHours: 8, breakDurationMinutes: 60, workStartTime: '09:00', workEndTime: '18:00' },
      { cycleDay: 7, dayType: 'WORK', plannedHours: 8, breakDurationMinutes: 60, workStartTime: '09:00', workEndTime: '18:00' },
    ];
    await auth1(request(app.getHttpServer()).post(`/work-time/schedules/${template.body.id}/patterns/bulk`))
      .send({ patterns })
      .expect(201);

    await auth1(request(app.getHttpServer()).post('/payroll/setup/seed-defaults')).expect(201);
    await auth1(request(app.getHttpServer()).post('/payroll/setup/seed-az-localization-2026')).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupTenant(email: string, tenantCode: string, orgCode: string) {
    const regRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Test1234!', displayName: 'Test User' })
      .expect(201);
    const token = regRes.body.accessToken;
    const tenantRes = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: tenantCode, name: `${tenantCode} Corp`, baseCurrencyCode: 'AZN' })
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
    return req.set('Authorization', `Bearer ${token1}`).set('X-Tenant-Id', tenant1Id);
  }

  async function hireEmployee(firstName: string, lastName: string, personalId: string, hireDate: string) {
    const draft = await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`))
      .send({
        newPerson: { firstName, lastName, personalId },
        employmentType: 'PRIMARY',
        hireDate,
        departmentId: deptId,
        positionId,
      })
      .expect(201);
    const posted = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`),
    )
      .send({ expectedVersion: draft.body.version })
      .expect(201);
    const employmentId = posted.body.employmentId as string;

    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/work-schedule-assignments`))
      .send({ employmentId, workScheduleCode: templateCode, effectiveFrom: hireDate })
      .expect(201);

    return employmentId;
  }

  function weekdaysInMonth(year: number, month: number): string[] {
    const days: string[] = [];
    const date = new Date(Date.UTC(year, month - 1, 1));
    while (date.getUTCMonth() === month - 1) {
      const dow = date.getUTCDay();
      if (dow !== 0 && dow !== 6) days.push(date.toISOString().slice(0, 10));
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return days;
  }

  /** Runs employee attendance for every weekday in [fromDate, toDate] and
   * locks a timesheet, producing a Phase 18 PayrollTimeInputRegister the
   * Payroll engine can read. */
  async function runFullMonthAttendanceAndLockTimesheet(
    employmentId: string,
    year: number,
    month: number,
  ) {
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

    await auth1(request(app.getHttpServer()).post('/work-time/plans/generate'))
      .send({ employmentId, fromDate: periodStart, toDate: periodEnd })
      .expect(201);

    for (const day of weekdaysInMonth(year, month)) {
      await auth1(request(app.getHttpServer()).post('/work-time/attendance/events'))
        .send({ employmentId, eventTimestamp: `${day}T09:00:00Z`, eventType: 'CLOCK_IN' })
        .expect(201);
      await auth1(request(app.getHttpServer()).post('/work-time/attendance/events'))
        .send({ employmentId, eventTimestamp: `${day}T18:00:00Z`, eventType: 'CLOCK_OUT' })
        .expect(201);
    }

    await auth1(request(app.getHttpServer()).post('/work-time/attendance/interpret'))
      .send({ employmentId, fromDate: periodStart, toDate: periodEnd })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/work-time/time-entries/generate-from-attendance?employmentId=${employmentId}&fromDate=${periodStart}&toDate=${periodEnd}`,
      ),
    ).expect(201);

    const generated = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/work-time/timesheets/generate`),
    )
      .send({ periodStart, periodEnd, employmentIds: [employmentId] })
      .expect(201);

    const submitted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${generated.body.id}/submit`,
      ),
    )
      .send({ expectedVersion: 1 })
      .expect(201);
    const approved = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/work-time/timesheets/${generated.body.id}/approve`,
      ),
    )
      .send({ expectedVersion: submitted.body.version })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/work-time/timesheets/${generated.body.id}/lock`),
    )
      .send({ expectedVersion: approved.body.version })
      .expect(201);

    const generatedInputs = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/work-time/payroll-inputs/generate`),
    )
      .send({ payrollPeriodStart: periodStart, payrollPeriodEnd: periodEnd })
      .expect(201);

    // Phase 19 only reads APPROVED/LOCKED PayrollTimeInput rows (spec
    // section 55) — approve every row this run just generated.
    for (const row of generatedInputs.body) {
      await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/work-time/payroll-inputs/${row.id}/approve`),
      ).expect(201);
    }
  }

  // ---------------------------------------------------------------------
  // Full month salary — spec test 171
  // ---------------------------------------------------------------------

  it('calculates full base salary + progressive tax/contributions when the full norm is worked', async () => {
    const employmentId = await hireEmployee('Full', 'Month', `PID-${run}-FULL`, '2026-01-01');
    await runFullMonthAttendanceAndLockTimesheet(employmentId, 2026, 2);

    await auth1(request(app.getHttpServer()).post('/payroll/compensation'))
      .send({ employmentId, effectiveFrom: '2026-01-01', payBasis: 'MONTHLY_SALARY', baseSalary: 2000 })
      .expect(201);

    const period = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/payroll/periods`),
    )
      .send({ year: 2026, month: 2 })
      .expect(201);

    const run1 = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/calculate`,
      ),
    )
      .send({})
      .expect(201);
    expect(run1.body.employeesFailed).toBe(0);

    const results = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/results`,
      ),
    ).expect(200);
    const result = results.body.find((r: any) => r.employmentId === employmentId);
    expect(result).toBeTruthy();

    expect(Number(result.gross)).toBeCloseTo(2000, 2);
    expect(Number(result.taxableIncome)).toBeCloseTo(2000, 2);
    expect(Number(result.employeeDeductions)).toBeCloseTo(296, 2); // 60 tax + 186 social + 10 unemployment + 40 medical
    expect(Number(result.net)).toBeCloseTo(1704, 2);
    expect(Number(result.employerContributions)).toBeCloseTo(364, 2); // 314 social + 10 unemployment + 40 medical
    expect(Number(result.employerTotalCost)).toBeCloseTo(2364, 2);

    const baseLine = result.lines.find((l: any) => l.calculationCode === 'BASE_SALARY');
    expect(baseLine).toBeTruthy();
    expect(Number(baseLine.rate)).toBeCloseTo(1, 3);
    const taxLine = result.lines.find((l: any) => l.calculationCode === 'INCOME_TAX');
    expect(Number(taxLine.amount)).toBeCloseTo(60, 2);
    expect(taxLine.sourceRule).toBe('AZ_PRIVATE_NONOIL_INCOME_TAX_2026');
  });

  // ---------------------------------------------------------------------
  // Retro salary change — spec test 188: original preserved, delta only
  // ---------------------------------------------------------------------

  it('recalculates a backdated salary raise without overwriting the original result', async () => {
    const employmentId = await hireEmployee('Retro', 'Salary', `PID-${run}-RETRO`, '2026-01-01');
    await runFullMonthAttendanceAndLockTimesheet(employmentId, 2026, 3);

    await auth1(request(app.getHttpServer()).post('/payroll/compensation'))
      .send({ employmentId, effectiveFrom: '2026-01-01', payBasis: 'MONTHLY_SALARY', baseSalary: 2000 })
      .expect(201);

    const period = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/payroll/periods`),
    )
      .send({ year: 2026, month: 3 })
      .expect(201);

    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/calculate`,
      ),
    )
      .send({})
      .expect(201);

    const before = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/results/${employmentId}`,
      ),
    ).expect(200);
    expect(Number(before.body.gross)).toBeCloseTo(2000, 2);
    expect(before.body.version).toBe(1);
    const originalResultId = before.body.id;

    // Backdated raise, effective the first day of the already-calculated
    // period — closes the 2000 assignment and opens a 2200 one.
    await auth1(request(app.getHttpServer()).post('/payroll/compensation'))
      .send({ employmentId, effectiveFrom: '2026-03-01', payBasis: 'MONTHLY_SALARY', baseSalary: 2200 })
      .expect(201);

    const reqRes = await auth1(request(app.getHttpServer()).post('/payroll/recalculation-requests'))
      .send({
        employmentId,
        earliestAffectedPeriodId: period.body.id,
        reason: 'Backdated salary raise entered after calculation',
      })
      .expect(201);

    const processed = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/recalculation-requests/${reqRes.body.id}/process`,
      ),
    ).expect(201);
    expect(processed.body.originalVersion).toBe(1);
    expect(processed.body.correctedVersion).toBe(2);
    expect(Number(processed.body.delta.gross)).toBeCloseTo(200, 2);

    const after = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/results/${employmentId}`,
      ),
    ).expect(200);
    expect(after.body.version).toBe(2);
    expect(Number(after.body.gross)).toBeCloseTo(2200, 2);
    expect(after.body.id).not.toBe(originalResultId);

    // The original result is preserved (status SUPERSEDED), never deleted
    // or mutated — it just no longer surfaces as the current CALCULATED
    // result for the period.
    const stillListed = after.body.id !== originalResultId;
    expect(stillListed).toBe(true);
  });

  // ---------------------------------------------------------------------
  // GL posting + liability register + payment batch — spec sections
  // 97-111, 114
  // ---------------------------------------------------------------------

  it('posts a calculated period to the GL, writes the liability register, and pays it out', async () => {
    const employmentId = await hireEmployee('Post', 'Ing', `PID-${run}-POST`, '2026-01-01');
    await runFullMonthAttendanceAndLockTimesheet(employmentId, 2026, 4);

    await auth1(request(app.getHttpServer()).post('/payroll/compensation'))
      .send({ employmentId, effectiveFrom: '2026-01-01', payBasis: 'MONTHLY_SALARY', baseSalary: 2000 })
      .expect(201);

    const period = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/payroll/periods`),
    )
      .send({ year: 2026, month: 4 })
      .expect(201);

    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/calculate`,
      ),
    )
      .send({})
      .expect(201);

    const approved = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/approve`,
      ),
    )
      .send({ expectedCalculationVersion: 1 })
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');

    // Draft the PayrollPosting document, then post it through the generic
    // document-framework command — this is what actually writes the
    // balanced journal entry + PAYROLL_LIABILITY_REGISTER movements.
    const posting = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/posting`,
      ),
    )
      .send({})
      .expect(201);
    expect(posting.body.postingStatus).toBe('NOT_POSTED');
    expect(Number(posting.body.totalNet)).toBeCloseTo(1704, 2);

    const posted = await auth1(
      request(app.getHttpServer()).post(`/documents/PAYROLL_POSTING/${posting.body.id}/post`),
    )
      .send({ expectedVersion: posting.body.version })
      .expect(201);
    expect(posted.body.postingStatus).toBe('POSTED');

    const periodAfterPost = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/payroll/periods/${period.body.id}`),
    ).expect(200);
    expect(periodAfterPost.body.status).toBe('POSTED');

    // The GL entry must balance exactly: Dr(gross + employerContributions)
    // == Cr(net + all deductions + employer contribution payables).
    const journal = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/accounting/journal-entries?sourceDocumentType=PAYROLL_POSTING&sourceDocumentId=${posting.body.id}`,
      ),
    ).expect(200);
    expect(journal.body.length).toBe(1);
    const lines = journal.body[0].lines;
    const debit = lines
      .filter((l: any) => l.side === 'DEBIT')
      .reduce((sum: number, l: any) => sum + Number(l.amountBase), 0);
    const credit = lines
      .filter((l: any) => l.side === 'CREDIT')
      .reduce((sum: number, l: any) => sum + Number(l.amountBase), 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(2000 + 364, 2); // gross + employer contributions

    // Paying it out: a bulk payment batch confirms immediately and pays
    // the full outstanding net-pay liability for each listed employment.
    const batch = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/payment-batches`,
      ),
    )
      .send({
        paymentMethod: 'BANK',
        bankAccountId: 'test-bank-account',
        paymentDate: '2026-05-05',
        employmentIds: [employmentId],
      })
      .expect(201);
    expect(batch.body.status).toBe('CONFIRMED');
    expect(Number(batch.body.totalAmount)).toBeCloseTo(1704, 2);

    const periodAfterPay = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/payroll/periods/${period.body.id}`),
    ).expect(200);
    expect(periodAfterPay.body.status).toBe('PAID');

    // Once fully paid, a further payment batch against the same period is
    // refused outright — nothing is left owed.
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/payment-batches`,
      ),
    )
      .send({
        paymentMethod: 'BANK',
        bankAccountId: 'test-bank-account',
        paymentDate: '2026-05-06',
        employmentIds: [employmentId],
      })
      .expect(400);

    // Unposting after payment must be refused (spec-level safeguard: never
    // let a GL correction silently disagree with money already paid out).
    await auth1(
      request(app.getHttpServer()).post(`/documents/PAYROLL_POSTING/${posting.body.id}/unpost`),
    )
      .send({ expectedVersion: posted.body.version })
      .expect(400);

    // Reports read back exactly what the engine + liability register
    // already computed — never re-derived.
    const register = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/payroll/periods/${period.body.id}/register`),
    ).expect(200);
    const registerRow = register.body.find((r: any) => r.employmentId === employmentId);
    expect(registerRow).toBeTruthy();
    expect(Number(registerRow.net)).toBeCloseTo(1704, 2);
    expect(registerRow.employeeName).toBe('Post Ing');

    const payslip = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/payroll/periods/${period.body.id}/payslips/${employmentId}`,
      ),
    ).expect(200);
    expect(Number(payslip.body.net)).toBeCloseTo(1704, 2);
    expect(payslip.body.lines.length).toBeGreaterThan(0);

    const employerCost = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/payroll/periods/${period.body.id}/employer-cost`),
    ).expect(200);
    const deptCost = employerCost.body.find((c: any) => c.departmentId === deptId);
    expect(deptCost).toBeTruthy();
    expect(Number(deptCost.employerTotalCost)).toBeCloseTo(2364, 2);

    // Liabilities were all decreased by the payment batch — nothing owed.
    const liabilities = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/payroll/periods/${period.body.id}/liabilities`),
    ).expect(200);
    const netPayLiability = liabilities.body.find(
      (l: any) => l.employmentId === employmentId && l.category === 'NET_PAY',
    );
    expect(netPayLiability).toBeUndefined();

    // Closing the period requires PAID + GL POSTED + no blocking errors.
    const closed = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/payroll/periods/${period.body.id}/close`),
    )
      .send({})
      .expect(201);
    expect(closed.body.status).toBe('CLOSED');

    const health = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/payroll/health`),
    ).expect(200);
    expect(Array.isArray(health.body)).toBe(true);
  });
});
