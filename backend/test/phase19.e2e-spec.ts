/**
 * Phase 19 — Payroll / Gross-to-Net Engine.
 *
 * Same direct-service testing style as test/phase18.e2e-spec.ts. Rather
 * than re-running the full Phase 18 attendance pipeline, this test seeds
 * `EmployeeDailyWorkPlan` (monthly norm) and `PayrollTimeInput`
 * (APPROVED/LOCKED regular + overtime hours) directly — Payroll's own
 * calculation boundary starts at those two tables (spec section 20: it
 * never re-interprets attendance itself), so seeding them directly tests
 * exactly that boundary. Covers: rate bracket seeding, compensation +
 * tax profile assignment, a full month's gross-to-net calculation
 * (base salary + overtime, progressive income tax, employee/employer
 * social/unemployment/medical insurance), GL posting, liability payment
 * allocation, and payroll close.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DocumentPostingService } from '../src/document-framework/document-posting.service';
import { PhysicalPersonService } from '../src/hr/physical-person.service';
import { EmployeeService } from '../src/hr/employee.service';
import { PositionService } from '../src/hr/position.service';
import { HireService } from '../src/hr/hire.service';
import { HR_HIRE_TYPE } from '../src/hr/hire.repository';
import { PayrollRateBracketService } from '../src/payroll/payroll-rate-bracket.service';
import { PayrollDefinitionsService } from '../src/payroll/payroll-definitions.service';
import { EmployeeCompensationService } from '../src/payroll/employee-compensation.service';
import { EmployeeTaxProfileService } from '../src/payroll/employee-tax-profile.service';
import { PayrollPeriodService } from '../src/payroll/payroll-period.service';
import { PayrollCalculationService } from '../src/payroll/payroll-calculation.service';
import { PayrollPostingService } from '../src/payroll/payroll-posting.service';
import { PayrollLiabilityService } from '../src/payroll/payroll-liability.service';
import { PayrollCloseService } from '../src/payroll/payroll-close.service';

describe('Phase 19 — Payroll Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: DocumentPostingService;
  let persons: PhysicalPersonService;
  let employees: EmployeeService;
  let positions: PositionService;
  let hires: HireService;
  let brackets: PayrollRateBracketService;
  let definitions: PayrollDefinitionsService;
  let compensation: EmployeeCompensationService;
  let taxProfiles: EmployeeTaxProfileService;
  let periods: PayrollPeriodService;
  let calculation: PayrollCalculationService;
  let payrollPosting: PayrollPostingService;
  let liabilities: PayrollLiabilityService;
  let close: PayrollCloseService;

  const run = Date.now();
  const REGIME = 'AZ_NON_OIL_PRIVATE_2026';
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let membershipId: string;
  let userId: string;
  let employmentId: string;
  const NORM_HOURS = 168; // 21 workdays × 8h — an approximate January norm, good enough for this test

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
    brackets = app.get(PayrollRateBracketService);
    definitions = app.get(PayrollDefinitionsService);
    compensation = app.get(EmployeeCompensationService);
    taxProfiles = app.get(EmployeeTaxProfileService);
    periods = app.get(PayrollPeriodService);
    calculation = app.get(PayrollCalculationService);
    payrollPosting = app.get(PayrollPostingService);
    liabilities = app.get(PayrollLiabilityService);
    close = app.get(PayrollCloseService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p19-${run}`, name: 'Phase 19 tenant' } });
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A19${String(run).slice(-6)}`, name: 'Phase 19 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG19-${run}`, name: 'Phase 19 org', baseCurrencyId: currencyId } });
    const departmentId = randomUUID();
    await prisma.department.create({ data: { id: departmentId, tenantId, organizationId, code: `DEPT-${run}`, name: 'Finance' } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p19-${run}@e2e.test`, passwordHash: 'x', displayName: 'P19 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);

    const position = await positions.create(tenantId, userId, { code: `ACCT-${run}`, name: 'Accountant' });
    const person = await persons.create(tenantId, userId, { firstName: 'Nigar', lastName: 'Aliyeva', personalId: `PID19-${run}` });
    const employee = await employees.create(tenantId, userId, { physicalPersonId: person.id });
    const { employment, hire } = await hires.create(tenantId, membershipId, organizationId, userId, { employeeId: employee.id, employmentType: 'FULL_TIME', hireDate: '2025-06-01', documentDate: '2025-05-25', departmentId, positionId: position.id, contractType: 'PERMANENT' });
    await posting.post(tenantId, HR_HIRE_TYPE, hire.id, 1, userId);
    employmentId = employment.id;

    // Seed daily work plan rows for January 2026's norm (weekdays only).
    for (let day = 1; day <= 31; day++) {
      const date = new Date(Date.UTC(2026, 0, day));
      const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
      await prisma.employeeDailyWorkPlan.create({ data: { tenantId, employmentId, date, plannedHours: isWeekend ? '0' : '8', plannedWorkdayFraction: isWeekend ? '0' : '1', plannedDayType: isWeekend ? 'WEEKEND' : 'WORKDAY', fte: '1' } });
    }

    await brackets.seedAzerbaijan2026(tenantId, userId);
    await definitions.seedDefaults(tenantId, userId);
    await compensation.assign(tenantId, userId, { employmentId, effectiveFrom: '2025-06-01', payBasis: 'MONTHLY_SALARY', baseSalary: 3000, currencyId });
    await taxProfiles.assign(tenantId, userId, { employmentId, effectiveFrom: '2025-06-01', sectorCategory: 'NON_OIL_PRIVATE' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('calculates gross-to-net for a full month with overtime, posts GL, allocates a payment, and closes the period', async () => {
    const period = await periods.open(tenantId, membershipId, organizationId, userId, { year: 2026, month: 1, paymentDate: '2026-02-05' });

    // Seed the LOCKED payroll time input directly (Payroll's real
    // boundary with Phase 18, spec section 20 — see file docstring).
    const timesheetStub = await prisma.timesheet.create({ data: { tenantId, organizationId, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), status: 'LOCKED' } });
    await prisma.payrollTimeInput.createMany({
      data: [
        { tenantId, organizationId, employmentId, payrollPeriod: new Date('2026-01-01'), timeCode: 'REGULAR_WORK', hours: NORM_HOURS.toString(), days: '21', sourceTimesheetId: timesheetStub.id, status: 'LOCKED', effectiveDate: new Date('2026-01-31') },
        { tenantId, organizationId, employmentId, payrollPeriod: new Date('2026-01-01'), timeCode: 'OVERTIME', hours: '10', sourceTimesheetId: timesheetStub.id, status: 'LOCKED', effectiveDate: new Date('2026-01-31') },
      ],
    });

    const calcRun = await calculation.calculate(tenantId, membershipId, organizationId, userId, period.id, 'REGULAR', REGIME);
    expect(calcRun.status).toBe('CALCULATED');
    expect(calcRun.employeesProcessed).toBe(1);
    expect(calcRun.employeesFailed).toBe(0);

    const results = await calculation.listResults(tenantId, period.id);
    expect(results).toHaveLength(1);
    const result = await calculation.getResult(tenantId, results[0].id);
    const gross = new Decimal(result.gross.toString());
    const net = new Decimal(result.net.toString());
    expect(gross.gt(3000)).toBe(true); // base salary + overtime premium
    expect(net.gt(0)).toBe(true);
    expect(net.lt(gross)).toBe(true);

    const baseSalaryLine = result.lines.find((l) => l.calculationCode === 'BASE_SALARY');
    expect(new Decimal(baseSalaryLine!.amount.toString()).toString()).toBe('3000');
    const overtimeLine = result.lines.find((l) => l.calculationCode === 'OVERTIME_PAY');
    expect(overtimeLine).toBeDefined();
    expect(new Decimal(overtimeLine!.amount.toString()).gt(0)).toBe(true);
    const incomeTaxLine = result.lines.find((l) => l.calculationCode === 'INCOME_TAX');
    expect(incomeTaxLine).toBeDefined();
    expect(new Decimal(incomeTaxLine!.amount.toString()).gt(0)).toBe(true);
    const employerSocialLine = result.lines.find((l) => l.calculationCode === 'EMPLOYER_SOCIAL_INSURANCE');
    expect(employerSocialLine).toBeDefined();

    // Reconciliation invariant (spec section 81): Σ earnings - Σ deductions = net.
    const earningsSum = result.lines.filter((l) => l.lineType === 'EARNING').reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    const deductionsSum = result.lines.filter((l) => l.lineType === 'DEDUCTION').reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    expect(earningsSum.minus(deductionsSum).toDecimalPlaces(2).toString()).toBe(net.toString());

    await periods.transition(tenantId, period.id, userId, 'REVIEW');
    await periods.approve(tenantId, membershipId, organizationId, userId, period.id);
    const posted = await payrollPosting.post(tenantId, membershipId, organizationId, userId, calcRun.id);
    expect(posted.status).toBe('POSTED');

    const netLiability = (await liabilities.list(tenantId, membershipId, organizationId, employmentId, 'EMPLOYEE_NET_PAY'))[0];
    expect(netLiability).toBeDefined();
    expect(new Decimal(netLiability.outstanding.toString()).toString()).toBe(net.toDecimalPlaces(2).toString());

    const { liability: partiallyPaid } = await liabilities.allocate(tenantId, membershipId, organizationId, userId, netLiability.id, { paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: randomUUID(), amount: Number(net.toDecimalPlaces(2).toString()), allocationDate: '2026-02-05' });
    expect(partiallyPaid.status).toBe('PAID');

    const checks = await close.runChecks(tenantId, membershipId, organizationId, period.id);
    const blocking = checks.filter((c) => !c.passed);
    expect(blocking.map((c) => c.code)).not.toContain('CALCULATION_COMPLETE');
    expect(blocking.map((c) => c.code)).not.toContain('ACCOUNTING_POSTED');
  });
});
