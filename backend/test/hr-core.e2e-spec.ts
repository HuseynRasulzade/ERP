/**
 * HR Core / Employment Lifecycle Engine E2E tests (docx spec Phase 17) —
 * physical person duplicate detection, hire lifecycle (new person + post),
 * as-of-date employment state queries, contract create/amend, transfer
 * (incl. manager-hierarchy cycle detection), staffing capacity limits
 * (incl. override), termination + employee status rollup, rehire, and
 * multiple concurrent employments (primary + secondary).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';

describe('HR Core (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = Date.now();
  let token1: string;
  let tenant1Id: string;
  let org1Id: string;
  let departmentId: string;
  let department2Id: string;
  let positionId: string;

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
    prisma = app.get(PrismaService);

    const s1 = await setupTenant(`hr1-${run}@e2e.test`, `hr-t1-${run}`, 'HR1');
    token1 = s1.token;
    tenant1Id = s1.tenantId;
    org1Id = s1.orgId;

    const dept = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
    )
      .send({ code: `DEPT-${run}`, name: 'Engineering' })
      .expect(201);
    departmentId = dept.body.id;

    const dept2 = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
    )
      .send({ code: `DEPT2-${run}`, name: 'Sales' })
      .expect(201);
    department2Id = dept2.body.id;

    const position = await auth1(
      request(app.getHttpServer()).post('/hr/positions'),
    )
      .send({ code: `ENG-${run}`, name: 'Engineer' })
      .expect(201);
    positionId = position.body.id;
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

  // ---------------------------------------------------------------------
  // PhysicalPerson duplicate detection
  // ---------------------------------------------------------------------

  it('blocks creating a duplicate personalId without confirmDuplicate', async () => {
    const personalId = `PID-${run}-DUP`;
    await auth1(request(app.getHttpServer()).post('/hr/physical-persons'))
      .send({ firstName: 'Ali', lastName: 'Aliyev', personalId })
      .expect(201);

    await auth1(request(app.getHttpServer()).post('/hr/physical-persons'))
      .send({ firstName: 'Ali', lastName: 'Aliyev', personalId })
      .expect(400);

    const confirmed = await auth1(request(app.getHttpServer()).post('/hr/physical-persons'))
      .send({ firstName: 'Ali', lastName: 'Aliyev', personalId, confirmDuplicate: true })
      .expect(201);
    expect(confirmed.body.personalId).toBe(personalId);
  });

  // ---------------------------------------------------------------------
  // Hire lifecycle (new person path) + as-of-date state
  // ---------------------------------------------------------------------

  let employmentId: string;
  let employeeId: string;

  it('hires a new employee via HireDocument (new person path) and posts it', async () => {
    const draft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        newPerson: { firstName: 'Elvin', lastName: 'Mammadov', personalId: `PID-${run}-1` },
        employmentType: 'PRIMARY',
        hireDate: '2026-01-15',
        departmentId,
        positionId,
        fte: 1,
      })
      .expect(201);
    expect(draft.body.status).toBe('DRAFT');

    const posted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: draft.body.version })
      .expect(201);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.employmentId).toBeTruthy();
    employmentId = posted.body.employmentId;
    employeeId = posted.body.employeeId;

    const employment = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}`,
      ),
    ).expect(200);
    expect(employment.body.status).toBe('ACTIVE');
    expect(employment.body.departmentId).toBe(departmentId);
  });

  it('resolves employment state as of a given date via the as-of-date query engine', async () => {
    const beforeHire = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}/state?asOfDate=2026-01-01`,
      ),
    ).expect(200);
    expect(beforeHire.body.status).toBeNull();

    const afterHire = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}/state?asOfDate=2026-02-01`,
      ),
    ).expect(200);
    expect(afterHire.body.status).toBe('ACTIVE');
    expect(afterHire.body.departmentId).toBe(departmentId);
  });

  // ---------------------------------------------------------------------
  // Employment Contract create + amend
  // ---------------------------------------------------------------------

  it('creates and amends an employment contract with versioned history', async () => {
    const contract = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/employments/${employmentId}/contract`,
      ),
    )
      .send({
        contractNumber: `C-${run}`,
        contractDate: '2026-01-15',
        effectiveFrom: '2026-01-15',
        contractType: 'PERMANENT',
      })
      .expect(201);
    expect(contract.body.contractNumber).toBe(`C-${run}`);

    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/employments/${employmentId}/contract/amend`,
      ),
    )
      .send({ effectiveFrom: '2026-06-01', changes: 'Salary adjustment', newWorkLocation: 'HQ' })
      .expect(201);

    const fetched = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}/contract`,
      ),
    ).expect(200);
    expect(fetched.body.versions).toHaveLength(2);
    expect(fetched.body.workLocation).toBe('HQ');
  });

  // ---------------------------------------------------------------------
  // Transfer + manager hierarchy cycle detection
  // ---------------------------------------------------------------------

  let managerEmploymentId: string;

  it('hires a manager and transfers the employee under them', async () => {
    const managerHire = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        newPerson: { firstName: 'Nigar', lastName: 'Huseynova', personalId: `PID-${run}-MGR` },
        employmentType: 'PRIMARY',
        hireDate: '2026-01-01',
        departmentId,
        positionId,
      })
      .expect(201);
    const managerPosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${managerHire.body.id}/post`,
      ),
    )
      .send({ expectedVersion: managerHire.body.version })
      .expect(201);
    managerEmploymentId = managerPosted.body.employmentId;

    const transferDraft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/transfers`),
    )
      .send({
        employmentId,
        transferType: 'MANAGER_CHANGE',
        effectiveDate: '2026-02-01',
        newManagerEmploymentId: managerEmploymentId,
      })
      .expect(201);

    const transferPosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/transfers/${transferDraft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: transferDraft.body.version })
      .expect(201);
    expect(transferPosted.body.status).toBe('POSTED');

    const employment = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}`,
      ),
    ).expect(200);
    expect(employment.body.managerEmploymentId).toBe(managerEmploymentId);
  });

  it('rejects a transfer that would create a circular reporting hierarchy', async () => {
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/transfers`))
      .send({
        employmentId: managerEmploymentId,
        transferType: 'MANAGER_CHANGE',
        effectiveDate: '2026-02-01',
        newManagerEmploymentId: employmentId,
      })
      .expect(400);
  });

  it("splits EmployeeAssignment history at the transfer's effective date", async () => {
    const deptTransferDraft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/transfers`),
    )
      .send({
        employmentId,
        transferType: 'DEPARTMENT_TRANSFER',
        effectiveDate: '2026-03-01',
        newDepartmentId: department2Id,
      })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/transfers/${deptTransferDraft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: deptTransferDraft.body.version })
      .expect(201);

    const history = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}/history`,
      ),
    ).expect(200);
    const assignments = history.body.assignments.sort(
      (a: any, b: any) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime(),
    );
    expect(assignments.length).toBeGreaterThanOrEqual(2);
    expect(assignments[0].departmentId).toBe(departmentId);
    expect(assignments[0].effectiveTo).toBeTruthy();
    expect(assignments[assignments.length - 1].departmentId).toBe(department2Id);
    expect(assignments[assignments.length - 1].effectiveTo).toBeNull();

    const stateBefore = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}/state?asOfDate=2026-02-15`,
      ),
    ).expect(200);
    expect(stateBefore.body.departmentId).toBe(departmentId);

    const stateAfter = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${employmentId}/state?asOfDate=2026-03-15`,
      ),
    ).expect(200);
    expect(stateAfter.body.departmentId).toBe(department2Id);
  });

  // ---------------------------------------------------------------------
  // Staffing capacity limit + override
  // ---------------------------------------------------------------------

  it('enforces staffing position capacity and allows override with permission', async () => {
    const tableDraft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/staffing-tables`),
    )
      .send({ effectiveFrom: '2026-01-01' })
      .expect(201);

    const spRes = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/staffing-tables/${tableDraft.body.id}/positions`,
      ),
    )
      .send({
        departmentId,
        positionId,
        headcountLimit: 1,
        fteLimit: 1,
        activeFrom: '2026-01-01',
      })
      .expect(201);
    const staffingPositionId = spRes.body.id;

    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/staffing-tables/${tableDraft.body.id}/activate`,
      ),
    )
      .send({ expectedVersion: tableDraft.body.version })
      .expect(201);

    const hire1 = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        newPerson: { firstName: 'Kamran', lastName: 'Aslanov', personalId: `PID-${run}-CAP1` },
        employmentType: 'SECONDARY',
        hireDate: '2026-04-01',
        departmentId,
        positionId,
        staffingPositionId,
      })
      .expect(201);
    const hire1Posted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${hire1.body.id}/post`,
      ),
    )
      .send({ expectedVersion: hire1.body.version })
      .expect(201);
    expect(hire1Posted.body.status).toBe('POSTED');

    // Second hire into the same 1/1 capacity staffing position — blocked.
    await auth1(request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`))
      .send({
        newPerson: { firstName: 'Leyla', lastName: 'Qasimova', personalId: `PID-${run}-CAP2` },
        employmentType: 'SECONDARY',
        hireDate: '2026-04-01',
        departmentId,
        positionId,
        staffingPositionId,
      })
      .expect(400);

    // With overrideStaffingLimit — the tenant owner holds
    // HR_OVERRIDE_STAFFING_LIMIT, so it succeeds.
    const overrideHire = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        newPerson: { firstName: 'Leyla', lastName: 'Qasimova', personalId: `PID-${run}-CAP2` },
        employmentType: 'SECONDARY',
        hireDate: '2026-04-01',
        departmentId,
        positionId,
        staffingPositionId,
        overrideStaffingLimit: true,
      })
      .expect(201);
    expect(overrideHire.body.status).toBe('DRAFT');
  });

  // ---------------------------------------------------------------------
  // Termination + status rollup + rehire
  // ---------------------------------------------------------------------

  it('terminates an employment and rolls the employee status up correctly', async () => {
    const singleHire = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        newPerson: { firstName: 'Farid', lastName: 'Karimov', personalId: `PID-${run}-TERM` },
        employmentType: 'PRIMARY',
        hireDate: '2026-01-01',
        departmentId,
        positionId,
      })
      .expect(201);
    const singlePosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${singleHire.body.id}/post`,
      ),
    )
      .send({ expectedVersion: singleHire.body.version })
      .expect(201);
    const singleEmploymentId = singlePosted.body.employmentId;
    const singleEmployeeId = singlePosted.body.employeeId;

    const termDraft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/terminations`),
    )
      .send({
        employmentId: singleEmploymentId,
        terminationDate: '2026-06-30',
        lastWorkingDate: '2026-06-30',
        terminationReason: 'Resignation',
      })
      .expect(201);
    const termPosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/terminations/${termDraft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: termDraft.body.version })
      .expect(201);
    expect(termPosted.body.status).toBe('POSTED');

    const employment = await auth1(
      request(app.getHttpServer()).get(
        `/organizations/${org1Id}/hr/employments/${singleEmploymentId}`,
      ),
    ).expect(200);
    expect(employment.body.status).toBe('TERMINATED');

    const employee = await auth1(
      request(app.getHttpServer()).get(`/hr/employees/${singleEmployeeId}`),
    ).expect(200);
    expect(employee.body.status).toBe('TERMINATED');

    // Rehire: reuses the same Employee, opens a new Employment.
    const rehireDraft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        rehireOfEmployeeId: singleEmployeeId,
        employmentType: 'PRIMARY',
        hireDate: '2026-08-01',
        departmentId,
        positionId,
      })
      .expect(201);
    expect(rehireDraft.body.employeeId).toBe(singleEmployeeId);
    const rehirePosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${rehireDraft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: rehireDraft.body.version })
      .expect(201);
    expect(rehirePosted.body.employmentId).not.toBe(singleEmploymentId);

    const employeeAfterRehire = await auth1(
      request(app.getHttpServer()).get(`/hr/employees/${singleEmployeeId}`),
    ).expect(200);
    expect(employeeAfterRehire.body.status).toBe('ACTIVE');
  });

  it('keeps the employee ACTIVE when only a secondary employment is terminated', async () => {
    const primaryHire = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        newPerson: { firstName: 'Sabina', lastName: 'Rzayeva', personalId: `PID-${run}-MULTI` },
        employmentType: 'PRIMARY',
        hireDate: '2026-01-01',
        departmentId,
        positionId,
      })
      .expect(201);
    const primaryPosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${primaryHire.body.id}/post`,
      ),
    )
      .send({ expectedVersion: primaryHire.body.version })
      .expect(201);
    const multiEmployeeId = primaryPosted.body.employeeId;

    const secondaryHire = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
    )
      .send({
        employeeId: multiEmployeeId,
        employmentType: 'SECONDARY',
        hireDate: '2026-01-01',
        departmentId: department2Id,
        positionId,
        fte: 0.5,
      })
      .expect(201);
    const secondaryPosted = await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/hire-documents/${secondaryHire.body.id}/post`,
      ),
    )
      .send({ expectedVersion: secondaryHire.body.version })
      .expect(201);
    const secondaryEmploymentId = secondaryPosted.body.employmentId;

    const termDraft = await auth1(
      request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/terminations`),
    )
      .send({
        employmentId: secondaryEmploymentId,
        terminationDate: '2026-05-01',
        lastWorkingDate: '2026-05-01',
        terminationReason: 'End of secondary assignment',
      })
      .expect(201);
    await auth1(
      request(app.getHttpServer()).post(
        `/organizations/${org1Id}/hr/terminations/${termDraft.body.id}/post`,
      ),
    )
      .send({ expectedVersion: termDraft.body.version })
      .expect(201);

    const employee = await auth1(
      request(app.getHttpServer()).get(`/hr/employees/${multiEmployeeId}`),
    ).expect(200);
    expect(employee.body.status).toBe('ACTIVE');
  });

  // ---------------------------------------------------------------------
  // Reports + health
  // ---------------------------------------------------------------------

  it('produces org chart, headcount, staffing capacity, and health reports', async () => {
    const orgChart = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/hr/reports/org-chart`),
    ).expect(200);
    expect(Array.isArray(orgChart.body)).toBe(true);
    expect(orgChart.body.length).toBeGreaterThan(0);

    const headcount = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/hr/reports/headcount`),
    ).expect(200);
    expect(Array.isArray(headcount.body)).toBe(true);

    const staffing = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/hr/reports/staffing-capacity`),
    ).expect(200);
    expect(Array.isArray(staffing.body)).toBe(true);

    const health = await auth1(
      request(app.getHttpServer()).get(`/organizations/${org1Id}/hr/reports/health`),
    ).expect(200);
    expect(Array.isArray(health.body)).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Approval workflow for Hire/Transfer/Termination (Phase 17 continuation)
  //
  // The DEPARTMENT_HEAD step is only planned when a head is actually
  // resolvable for the document's department (see the three
  // *ApprovalPlanProvider header comments) — so this uses its OWN,
  // dedicated department with an appointed head, never `departmentId`/
  // `department2Id` above, which every earlier test in this file relies on
  // being able to hire/transfer/terminate into WITHOUT approval.
  // ---------------------------------------------------------------------

  describe('Approval workflow for Hire/Transfer/Termination', () => {
    let approverDeptId: string;
    let approverToken: string;

    beforeAll(async () => {
      const dept = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/departments`),
      )
        .send({ code: `DEPT-APPR-${run}`, name: 'Approved Department' })
        .expect(201);
      approverDeptId = dept.body.id;
      approverToken = await setupDepartmentHeadApprover(approverDeptId);
    });

    /** Registers a second tenant1 user holding the DEPARTMENT_HEAD role,
     * scoped to `departmentId` via OrganizationAccess — distinct from
     * token1 (the creator of every fixture document below), since
     * approval requires an approver who isn't the document's own creator.
     * Same no-invite-API-yet, straight-through-Prisma pattern as
     * procurement.e2e-spec.ts's own `setupApprover`. */
    async function setupDepartmentHeadApprover(departmentId: string): Promise<string> {
      const email = `hr-approver-${run}@e2e.test`;
      const reg = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Test1234!', displayName: 'HR Approver' })
        .expect(201);
      const membership = await prisma.tenantMembership.create({
        data: { tenantId: tenant1Id, userId: reg.body.userId, status: 'ACTIVE' },
      });
      await prisma.organizationAccess.create({
        data: { tenantMembershipId: membership.id, organizationId: org1Id, accessLevel: 'FULL', departmentId },
      });
      const permissions = await prisma.permission.findMany({
        where: {
          code: {
            in: [
              'hr.employee.view',
              'hr.hire.approve',
              'hr.hire.reject',
              'hr.transfer.approve',
              'hr.transfer.reject',
              'hr.terminate.approve',
              'hr.terminate.reject',
            ],
          },
        },
      });
      const role = await prisma.role.create({
        data: { tenantId: tenant1Id, code: 'DEPARTMENT_HEAD', name: 'DEPARTMENT_HEAD' },
      });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
      return reg.body.accessToken;
    }

    function approverAuth(req: request.Test) {
      return req.set('Authorization', `Bearer ${approverToken}`).set('X-Tenant-Id', tenant1Id);
    }

    it('a hire into a department with an appointed head starts PENDING, blocks posting, and posts once approved', async () => {
      const draft = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
      )
        .send({
          newPerson: { firstName: 'Rashad', lastName: 'Nabiyev', personalId: `PID-${run}-APR1` },
          employmentType: 'SECONDARY',
          hireDate: '2026-06-01',
          departmentId: approverDeptId,
          positionId,
        })
        .expect(201);
      expect(draft.body.approvalStatus).toBe('PENDING');

      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: draft.body.version })
        .expect(400);

      const approved = await approverAuth(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/approve`,
        ),
      )
        .send({})
        .expect(201);
      expect(approved.body.approvalStatus).toBe('APPROVED');

      const posted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: draft.body.version })
        .expect(201);
      expect(posted.body.status).toBe('POSTED');
    });

    it('rejects a hire document, permanently blocking it from posting', async () => {
      const draft = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
      )
        .send({
          newPerson: { firstName: 'Sabina', lastName: 'Karimova', personalId: `PID-${run}-APR2` },
          employmentType: 'SECONDARY',
          hireDate: '2026-06-01',
          departmentId: approverDeptId,
          positionId,
        })
        .expect(201);

      const rejected = await approverAuth(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/reject`,
        ),
      )
        .send({ comment: 'Headcount frozen' })
        .expect(201);
      expect(rejected.body.approvalStatus).toBe('REJECTED');

      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${draft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: rejected.body.version })
        .expect(400);
    });

    it('an employee transfer out of an approver-headed department requires approval before posting', async () => {
      const hireDraft = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
      )
        .send({
          newPerson: { firstName: 'Tural', lastName: 'Sultanov', personalId: `PID-${run}-APR3` },
          employmentType: 'SECONDARY',
          hireDate: '2026-06-01',
          departmentId: approverDeptId,
          positionId,
        })
        .expect(201);
      await approverAuth(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${hireDraft.body.id}/approve`,
        ),
      )
        .send({})
        .expect(201);
      const hirePosted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${hireDraft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: hireDraft.body.version })
        .expect(201);
      const transferEmploymentId = hirePosted.body.employmentId;

      const transferDraft = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/transfers`),
      )
        .send({
          employmentId: transferEmploymentId,
          transferType: 'DEPARTMENT_TRANSFER',
          effectiveDate: '2026-07-01',
          newDepartmentId: department2Id,
        })
        .expect(201);
      expect(transferDraft.body.approvalStatus).toBe('PENDING');

      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/transfers/${transferDraft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: transferDraft.body.version })
        .expect(400);

      await approverAuth(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/transfers/${transferDraft.body.id}/approve`,
        ),
      )
        .send({})
        .expect(201);

      const transferPosted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/transfers/${transferDraft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: transferDraft.body.version })
        .expect(201);
      expect(transferPosted.body.status).toBe('POSTED');
    });

    it('a termination out of an approver-headed department requires approval before posting', async () => {
      const hireDraft = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/hire-documents`),
      )
        .send({
          newPerson: { firstName: 'Aygun', lastName: 'Mansurova', personalId: `PID-${run}-APR4` },
          employmentType: 'SECONDARY',
          hireDate: '2026-06-01',
          departmentId: approverDeptId,
          positionId,
        })
        .expect(201);
      await approverAuth(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${hireDraft.body.id}/approve`,
        ),
      )
        .send({})
        .expect(201);
      const hirePosted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/hire-documents/${hireDraft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: hireDraft.body.version })
        .expect(201);
      const terminationEmploymentId = hirePosted.body.employmentId;

      const termDraft = await auth1(
        request(app.getHttpServer()).post(`/organizations/${org1Id}/hr/terminations`),
      )
        .send({
          employmentId: terminationEmploymentId,
          terminationDate: '2026-08-01',
          lastWorkingDate: '2026-08-01',
          terminationReason: 'Resignation',
        })
        .expect(201);
      expect(termDraft.body.approvalStatus).toBe('PENDING');

      await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/terminations/${termDraft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: termDraft.body.version })
        .expect(400);

      await approverAuth(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/terminations/${termDraft.body.id}/approve`,
        ),
      )
        .send({})
        .expect(201);

      const termPosted = await auth1(
        request(app.getHttpServer()).post(
          `/organizations/${org1Id}/hr/terminations/${termDraft.body.id}/post`,
        ),
      )
        .send({ expectedVersion: termDraft.body.version })
        .expect(201);
      expect(termPosted.body.status).toBe('POSTED');
    });
  });
});
