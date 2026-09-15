/**
 * Phase 20 — Expenses / Cost Centers / Employee Expenses.
 *
 * Same direct-service testing style as test/phase19.e2e-spec.ts. Covers:
 * an employee cash advance (Phase 15's own AccountablePersonMovement,
 * seeded directly here), an expense claim drawing down that advance,
 * partial-line approval, posting (which reduces the advance balance via
 * EXPENSE_REPORTED), and the live settlement register.
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
import { AccountablePersonService } from '../src/cash/accountable-person.service';
import { CostCenterService } from '../src/expenses/cost-center.service';
import { ExpenseCategoryService } from '../src/expenses/expense-category.service';
import { ExpenseClaimService } from '../src/expenses/expense-claim.service';
import { EXPENSE_CLAIM_TYPE } from '../src/expenses/expense-claim.repository';
import { ExpenseSettlementService } from '../src/expenses/expense-settlement.service';

describe('Phase 20 — Expenses Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: DocumentPostingService;
  let persons: PhysicalPersonService;
  let employees: EmployeeService;
  let positions: PositionService;
  let hires: HireService;
  let accountablePersons: AccountablePersonService;
  let costCenters: CostCenterService;
  let categories: ExpenseCategoryService;
  let claims: ExpenseClaimService;
  let settlement: ExpenseSettlementService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let currencyId: string;
  let membershipId: string;
  let userId: string;
  let employeeId: string;
  let employmentId: string;
  let costCenterId: string;
  let categoryId: string;

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
    accountablePersons = app.get(AccountablePersonService);
    costCenters = app.get(CostCenterService);
    categories = app.get(ExpenseCategoryService);
    claims = app.get(ExpenseClaimService);
    settlement = app.get(ExpenseSettlementService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p20-${run}`, name: 'Phase 20 tenant' } });
    currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A20${String(run).slice(-6)}`, name: 'Phase 20 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG20-${run}`, name: 'Phase 20 org', baseCurrencyId: currencyId } });
    const departmentId = randomUUID();
    await prisma.department.create({ data: { id: departmentId, tenantId, organizationId, code: `DEPT-${run}`, name: 'Sales' } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p20-${run}@e2e.test`, passwordHash: 'x', displayName: 'P20 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);

    const position = await positions.create(tenantId, userId, { code: `SALES-${run}`, name: 'Sales Rep' });
    const person = await persons.create(tenantId, userId, { firstName: 'Tural', lastName: 'Ismayilov', personalId: `PID20-${run}` });
    const employee = await employees.create(tenantId, userId, { physicalPersonId: person.id });
    employeeId = employee.id;
    const { employment, hire } = await hires.create(tenantId, membershipId, organizationId, userId, { employeeId, employmentType: 'FULL_TIME', hireDate: '2025-01-01', documentDate: '2024-12-20', departmentId, positionId: position.id, contractType: 'PERMANENT' });
    await posting.post(tenantId, HR_HIRE_TYPE, hire.id, 1, userId);
    employmentId = employment.id;

    const costCenter = await costCenters.create(tenantId, membershipId, organizationId, userId, { code: `CC-TRAVEL-${run}`, name: 'Travel', departmentId });
    costCenterId = costCenter.id;
    const category = await categories.create(tenantId, membershipId, organizationId, userId, { code: `HOTEL-${run}`, name: 'Hotel', receiptRequirement: 'REQUIRED_ABOVE_THRESHOLD', receiptThreshold: 100 });
    categoryId = category.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues an advance, claims expenses against it, approves, posts, and reflects the live settlement register', async () => {
    // Employee advance issued directly (Phase 15's own register — no new
    // ledger built for Phase 20, see docs/EXPENSES.md).
    await prisma.runInTransaction((tx) => accountablePersons.record(tenantId, { organizationId, employeeId, currencyId, movementType: 'ISSUE', amount: new Decimal(1000), sourceDocumentType: 'OPENING_BALANCE', sourceDocumentId: randomUUID(), effectiveDate: new Date('2026-03-01') }, tx));

    const claim = await claims.create(tenantId, membershipId, organizationId, userId, {
      employeeId,
      employmentId,
      documentDate: '2026-03-15',
      expensePeriodStart: '2026-03-01',
      expensePeriodEnd: '2026-03-15',
      currencyId,
      lines: [
        { expenseDate: '2026-03-10', expenseCategoryId: categoryId, merchant: 'Grand Hotel', description: 'Client visit', transactionCurrencyId: currencyId, transactionAmount: 600, baseAmount: 600, paymentSourceType: 'EMPLOYEE_ADVANCE', costCenterId, receiptAttached: true },
      ],
    });
    expect(claim.totalClaimedAmount.toString()).toBe('600');
    expect(claim.lines[0].policyStatus).toBe('OK');

    await claims.approveLine(tenantId, userId, claim.lines[0].id, 600);
    const finalized = await claims.finalizeApproval(tenantId, membershipId, organizationId, userId, claim.id);
    expect(finalized.approvalStatus).toBe('APPROVED');
    expect(new Decimal(finalized.advanceAmount.toString()).toString()).toBe('1000');
    expect(new Decimal(finalized.reimbursementDue.toString()).toString()).toBe('0'); // advance covers it fully

    await posting.post(tenantId, EXPENSE_CLAIM_TYPE, claim.id, 1, userId);

    const outstandingAdvance = await accountablePersons.getOutstanding(tenantId, organizationId, employeeId, currencyId);
    expect(outstandingAdvance.toString()).toBe('400'); // 1000 issued - 600 expensed

    const register = await settlement.register(tenantId, membershipId, organizationId, employeeId);
    expect(register.advanceIssued).toBe('1000');
    expect(register.expenseApproved).toBe('600');
    expect(register.outstandingEmployeeDebt).toBe('400');
  });
});
