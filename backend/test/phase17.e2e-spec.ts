/**
 * Phase 17 — HR Core Engine.
 *
 * Same direct-service testing style as test/phase16.e2e-spec.ts. Covers:
 * physical person + employee creation, hire posting (opens the initial
 * assignment), a department transfer (as-of-date state before/after), a
 * termination, and a rehire creating a brand-new employment.
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
import { EmployeeTransferService } from '../src/hr/employee-transfer.service';
import { HR_TRANSFER_TYPE } from '../src/hr/employee-transfer.repository';
import { TerminationService } from '../src/hr/termination.service';
import { HR_TERMINATION_TYPE } from '../src/hr/termination.repository';
import { EmployeeAssignmentService } from '../src/hr/employee-assignment.service';

describe('Phase 17 — HR Core Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: DocumentPostingService;
  let persons: PhysicalPersonService;
  let employees: EmployeeService;
  let positions: PositionService;
  let hires: HireService;
  let transfers: EmployeeTransferService;
  let terminations: TerminationService;
  let assignments: EmployeeAssignmentService;

  const run = Date.now();
  let tenantId: string;
  let organizationId: string;
  let membershipId: string;
  let userId: string;
  let departmentAId: string;
  let departmentBId: string;
  let positionId: string;

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
    transfers = app.get(EmployeeTransferService);
    terminations = app.get(TerminationService);
    assignments = app.get(EmployeeAssignmentService);

    tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, code: `p17-${run}`, name: 'Phase 17 tenant' } });
    const currencyId = randomUUID();
    await prisma.currency.create({ data: { id: currencyId, code: `A17${String(run).slice(-6)}`, name: 'Phase 17 AZN', symbol: 'm', decimalPlaces: 2 } });
    await prisma.tenant.update({ where: { id: tenantId }, data: { baseCurrencyId: currencyId } });
    organizationId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, tenantId, code: `ORG17-${run}`, name: 'Phase 17 org', baseCurrencyId: currencyId } });

    departmentAId = randomUUID();
    await prisma.department.create({ data: { id: departmentAId, tenantId, organizationId, code: `DEPT-A-${run}`, name: 'Finance' } });
    departmentBId = randomUUID();
    await prisma.department.create({ data: { id: departmentBId, tenantId, organizationId, code: `DEPT-B-${run}`, name: 'Operations' } });

    userId = randomUUID();
    await prisma.user.create({ data: { id: userId, email: `p17-${run}@e2e.test`, passwordHash: 'x', displayName: 'P17 User' } });
    const membership = await prisma.tenantMembership.create({ data: { tenantId, userId, status: 'ACTIVE' } });
    membershipId = membership.id;
    await prisma.organizationAccess.create({ data: { tenantMembershipId: membershipId, organizationId } }).catch(() => undefined);

    const position = await positions.create(tenantId, userId, { code: `ACCOUNTANT-${run}`, name: 'Senior Accountant' });
    positionId = position.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('hire -> transfer -> termination -> rehire, with as-of-date assignment history throughout', async () => {
    const person = await persons.create(tenantId, userId, { firstName: 'Farid', lastName: 'Mammadov', personalId: `PID-${run}` });
    const employee = await employees.create(tenantId, userId, { physicalPersonId: person.id });

    const { employment, hire } = await hires.create(tenantId, membershipId, organizationId, userId, {
      employeeId: employee.id,
      employmentType: 'FULL_TIME',
      hireDate: '2026-01-10',
      documentDate: '2026-01-05',
      departmentId: departmentAId,
      positionId,
      contractType: 'PERMANENT',
    });
    expect(employment.employmentStatus).toBe('PLANNED');

    await posting.post(tenantId, HR_HIRE_TYPE, hire.id, 1, userId);
    let refreshed = await prisma.employment.findUniqueOrThrow({ where: { id: employment.id } });
    expect(refreshed.employmentStatus).toBe('ACTIVE'); // hireDate is in the past relative to "today"

    const stateAtHire = await assignments.getStateAsOf(tenantId, employment.id, new Date('2026-01-15'));
    expect(stateAtHire?.departmentId).toBe(departmentAId);

    // Transfer to Operations effective 2026-03-01
    const transfer = await transfers.create(tenantId, membershipId, organizationId, userId, { employmentId: employment.id, transferType: 'DEPARTMENT_TRANSFER', effectiveDate: '2026-03-01', newDepartmentId: departmentBId, reason: 'Reorg', documentDate: '2026-02-20' });
    await posting.post(tenantId, HR_TRANSFER_TYPE, transfer.id, 1, userId);

    const stateBeforeTransfer = await assignments.getStateAsOf(tenantId, employment.id, new Date('2026-02-28'));
    expect(stateBeforeTransfer?.departmentId).toBe(departmentAId);
    const stateAfterTransfer = await assignments.getStateAsOf(tenantId, employment.id, new Date('2026-03-01'));
    expect(stateAfterTransfer?.departmentId).toBe(departmentBId);

    // Termination
    const termination = await terminations.create(tenantId, membershipId, organizationId, userId, { employmentId: employment.id, terminationDate: '2026-06-30', terminationReason: 'resignation', documentDate: '2026-06-15' });
    await posting.post(tenantId, HR_TERMINATION_TYPE, termination.id, 1, userId);
    refreshed = await prisma.employment.findUniqueOrThrow({ where: { id: employment.id } });
    expect(refreshed.employmentStatus).toBe('TERMINATED');
    const openAssignment = await prisma.employeeAssignment.findFirst({ where: { tenantId, employmentId: employment.id, effectiveTo: null } });
    expect(openAssignment).toBeNull();

    // Rehire — a brand-new Employment, never reopening the terminated one
    const { employment: rehiredEmployment, hire: rehireDoc } = await hires.create(tenantId, membershipId, organizationId, userId, {
      employeeId: employee.id,
      employmentType: 'FULL_TIME',
      hireDate: '2026-09-01',
      documentDate: '2026-08-20',
      departmentId: departmentAId,
      positionId,
      contractType: 'PERMANENT',
      isRehire: true,
      previousEmploymentId: employment.id,
    });
    expect(rehiredEmployment.id).not.toBe(employment.id);
    await posting.post(tenantId, HR_HIRE_TYPE, rehireDoc.id, 1, userId);
    const finalEmployments = await prisma.employment.findMany({ where: { tenantId, employeeId: employee.id } });
    expect(finalEmployments).toHaveLength(2);
  });
});
