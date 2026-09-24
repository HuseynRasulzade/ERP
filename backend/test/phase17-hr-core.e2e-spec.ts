/**
 * Phase 17 — HR Core / Kadr uçotu E2E tests (docs/PHASE17_HR_CORE.md).
 *
 * Covers the spec's test scenarios 127-143 and the end-to-end business
 * scenario 149: PhysicalPerson / Employee / Employment separation,
 * effective-dated hire (future hire = PLANNED), staffing capacity, transfer
 * & future transfer, schedule change, circular manager, overlapping
 * assignment, headcount vs FTE, backdated recalculation event, idempotency,
 * concurrency, contract versioning, termination + rehire, multiple
 * employments, suspension / leave, tenant isolation, field-level security,
 * segregation of duties, HR period lock, reports and HR health.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HrEventService } from '../src/hr/hr-event.service';
import { HrHistoryService } from '../src/hr/hr-history.service';

describe('Phase 17 — HR Core (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now();

  let token: string;
  let tenantId: string;
  let orgA: string;
  let orgB: string;
  const dep: Record<string, string> = {};
  const pos: Record<string, string> = {};
  const ws: Record<string, string> = {};
  const sp: Record<string, string> = {};
  let staffingTableId: string;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const plusDays = (n: number) => iso(new Date(today.getTime() + n * 86400000));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const t = await setupTenant(`hr17-${run}@e2e.test`, `hr17-${run}`);
    token = t.token;
    tenantId = t.tenantId;
    orgA = (await api('post', '/organizations', { code: 'HRA', name: 'Company A' }).expect(201)).body.id;
    orgB = (await api('post', '/organizations', { code: 'HRB', name: 'Company B' }).expect(201)).body.id;

    for (const [key, code, name, org] of [
      ['fin', 'FIN', 'Finance', orgA],
      ['aud', 'AUD', 'Internal Audit', orgA],
      ['ops', 'FOPS', 'Finance Operations', orgA],
      ['whs', 'WHS', 'Warehouse', orgA],
      ['closed', 'CLS', 'Closed Dept', orgA],
      ['bSales', 'BSL', 'Sales B', orgB],
    ] as const) {
      dep[key] = (await api('post', `/organizations/${org}/departments`, { code, name }).expect(201)).body.id;
    }
    await api('post', `/organizations/${orgA}/departments/${dep.closed}/deactivate`, { expectedVersion: 1 }).expect(201);

    for (const [key, code, name] of [
      ['ja', 'JA', 'Junior Accountant'],
      ['sa', 'SA', 'Senior Accountant'],
      ['aud', 'AUDITOR', 'Internal Auditor'],
      ['clerk', 'CLERK', 'Clerk'],
      ['old', 'OLD', 'Obsolete Position'],
    ] as const) {
      pos[key] = (await api('post', '/hr/positions', { code, name }).expect(201)).body.id;
    }
    await api('patch', `/hr/positions/${pos.old}`, { active: false }).expect(200);

    ws.std = (await api('post', '/hr/work-schedules', { code: '5DAY', name: '5-Day Standard', scheduleType: 'STANDARD_WEEK', weeklyHours: 40 }).expect(201)).body.id;
    ws.flex = (await api('post', '/hr/work-schedules', { code: 'FLEX', name: 'Flexible Schedule', scheduleType: 'FLEXIBLE', weeklyHours: 40 }).expect(201)).body.id;
    ws.shift = (await api('post', '/hr/work-schedules', { code: 'SHIFT', name: 'Shift 2/2', scheduleType: 'SHIFT' }).expect(201)).body.id;

    staffingTableId = (await api('post', '/hr/staffing-tables', { organizationId: orgA, name: 'Company A structure', effectiveFrom: '2025-01-01' }).expect(201)).body.id;
    for (const [key, code, d, p, hc, fte] of [
      ['finJa', 'FIN-JA-01', 'fin', 'ja', 3, 3],
      ['finSa', 'FIN-SA-01', 'fin', 'sa', 3, 3],
      ['aud', 'AUD-01', 'aud', 'aud', 5, 5],
      ['cap', 'FIN-ACC-02', 'fin', 'clerk', 3, 2],
    ] as const) {
      sp[key] = (await api('post', '/hr/staffing-positions', { staffingTableId, code, departmentId: dep[d], positionId: pos[p], headcountLimit: hc, fteLimit: fte, defaultWorkScheduleId: ws.std }).expect(201)).body.id;
    }
    await api('post', `/hr/staffing-tables/${staffingTableId}/activate`).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // ----------------------------------------------------------------- helpers

  async function setupTenant(email: string, code: string) {
    const reg = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'Test1234!', displayName: 'HR Admin' }).expect(201);
    const tn = await request(app.getHttpServer()).post('/tenants').set('Authorization', `Bearer ${reg.body.accessToken}`).send({ code, name: `${code} Corp`, baseCurrencyCode: 'AZN' }).expect(201);
    return { token: reg.body.accessToken as string, tenantId: tn.body.id as string, userId: reg.body.userId as string };
  }

  function api(method: 'get' | 'post' | 'patch' | 'put', path: string, body?: unknown, as?: { token: string; tenantId: string }) {
    const r = (request(app.getHttpServer()) as any)[method](path).set('Authorization', `Bearer ${as?.token ?? token}`).set('X-Tenant-Id', as?.tenantId ?? tenantId);
    return body !== undefined ? r.send(body) : r;
  }

  let personSeq = 0;
  async function newEmployee(first: string, last: string, extra: Record<string, unknown> = {}) {
    personSeq++;
    const res = await api('post', '/hr/employees', { person: { firstName: first, lastName: `${last}${personSeq}`, birthDate: '1990-01-01', ...extra } }).expect(201);
    return res.body as { id: string; personnelNumber: string; physicalPersonId: string };
  }

  async function createHire(employeeId: string, hireDate: string, extra: Record<string, unknown> = {}) {
    return (
      await api('post', '/hr/hires', {
        organizationId: orgA,
        employeeId,
        hireDate,
        employmentType: 'FULL_TIME',
        departmentId: dep.fin,
        positionId: pos.ja,
        workScheduleId: ws.std,
        fte: 1,
        contract: { contractType: 'INDEFINITE', signedStatus: 'SIGNED' },
        ...extra,
      }).expect(201)
    ).body;
  }

  async function hire(employeeId: string, hireDate: string, extra: Record<string, unknown> = {}) {
    const doc = await createHire(employeeId, hireDate, extra);
    const posted = await api('post', `/hr/hires/${doc.id}/post`, {}).expect(201);
    return { doc, employmentId: posted.body.employment.id as string, posted: posted.body };
  }

  async function state(employmentId: string, asOf: string) {
    return (await api('get', `/hr/employments/${employmentId}/state?asOf=${asOf}`).expect(200)).body;
  }

  async function transfer(employmentId: string, effectiveDate: string, changes: Record<string, unknown>, transferType = 'COMBINED_TRANSFER') {
    const doc = (await api('post', '/hr/transfers', { employmentId, effectiveDate, transferType, ...changes }).expect(201)).body;
    return doc;
  }

  async function postTransfer(id: string, expect = 201) {
    return api('post', `/hr/transfers/${id}/post`, {}).expect(expect);
  }

  async function terminate(employmentId: string, terminationDate: string, reason = 'RESIGNATION') {
    const doc = (await api('post', '/hr/terminations', { employmentId, terminationDate, terminationReasonCode: reason }).expect(201)).body;
    const posted = await api('post', `/hr/terminations/${doc.id}/post`, {});
    return { doc, posted };
  }

  // ------------------------------------------------------------------ tests

  describe('Person vs Employee vs Employment (spec 1-7, 55, 128)', () => {
    it('creates a physical person, hard-blocks a duplicate legal ID and warns on fuzzy duplicates', async () => {
      const p1 = await api('post', '/hr/persons', { firstName: 'Fərid', lastName: 'Məmmədov', birthDate: '1988-05-10', personalId: `FIN${String(run).slice(-7)}`, personalPhone: '+994501112233' }).expect(201);
      expect(p1.body.fullName).toBe('Məmmədov Fərid');
      expect(p1.body.personalId).toBe(`FIN${String(run).slice(-7)}`);

      const dup = await api('post', '/hr/persons', { firstName: 'Other', lastName: 'Name', personalId: `fin${String(run).slice(-7)}` }).expect(409);
      expect(dup.body.code).toBe('HR_DUPLICATE_PERSON');

      const fuzzy = await api('post', '/hr/persons', { firstName: 'Fərid', lastName: 'Məmmədov', birthDate: '1988-05-10' }).expect(201);
      expect(fuzzy.body.duplicateWarnings.map((w: any) => w.signal)).toContain('NAME_BIRTH_DATE');

      const emp = await api('post', '/hr/employees', { physicalPersonId: p1.body.id }).expect(201);
      expect(emp.body.personnelNumber).toMatch(/^EMP-/);
      const again = await api('post', '/hr/employees', { physicalPersonId: p1.body.id }).expect(409);
      expect(again.body.code).toBe('CONFLICT');
    });
  });

  describe('Hire (spec 19-21, 127, 131, 140)', () => {
    it('future-dated hire is PLANNED before the hire date and ACTIVE from it, with the initial assignment', async () => {
      const e = await newEmployee('Future', 'Hire');
      const hireDate = plusDays(30);
      const { employmentId, posted } = await hire(e.id, hireDate, { staffingPositionId: sp.finJa, departmentId: undefined, positionId: undefined });
      expect(posted.employment.employmentStatus).toBe('PLANNED');
      expect((await state(employmentId, plusDays(0))).status).toBe('PLANNED');
      const s = await state(employmentId, hireDate);
      expect(s.status).toBe('ACTIVE');
      expect(s.assignment.departmentId).toBe(dep.fin);
      expect(s.assignment.positionId).toBe(pos.ja);
      expect(s.assignment.staffingPositionCode).toBe('FIN-JA-01');
      expect(s.workSchedule.code).toBe('5DAY');
      const events = (await api('get', `/hr/events?employmentId=${employmentId}`).expect(200)).body.map((x: any) => x.eventType);
      expect(events).toEqual(expect.arrayContaining(['EMPLOYMENT_PLANNED', 'EMPLOYEE_HIRED']));
    });

    it('blocks posting without a contract with a specific message', async () => {
      const e = await newEmployee('No', 'Contract');
      const doc = await createHire(e.id, '2026-03-01', { contract: undefined });
      const res = await api('post', `/hr/hires/${doc.id}/post`, {}).expect(422);
      expect(res.body.code).toBe('HR_CONTRACT_REQUIRED');
      expect(res.body.message).toBe('Hire cannot be posted because no employment contract is attached.');
    });

    it('preview shows the new state and issues without writing anything', async () => {
      const e = await newEmployee('Preview', 'Only');
      const doc = await createHire(e.id, '2026-02-01', { contract: undefined });
      const pv = await api('post', `/hr/hires/${doc.id}/preview`).expect(201);
      expect(pv.body.valid).toBe(false);
      expect(pv.body.issues.map((i: any) => i.code)).toContain('HR_CONTRACT_REQUIRED');
      expect(pv.body.newState.department.name).toBe('Finance');
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(0);
    });

    it('is idempotent: posting the same hire twice (and with an Idempotency-Key) creates one employment', async () => {
      const e = await newEmployee('Idem', 'Potent');
      const doc = await createHire(e.id, '2026-02-01');
      const key = `hire-${run}`;
      const first = await api('post', `/hr/hires/${doc.id}/post`, {}).set('Idempotency-Key', key).expect(201);
      const replay = await api('post', `/hr/hires/${doc.id}/post`, {}).set('Idempotency-Key', key).expect(201);
      const again = await api('post', `/hr/hires/${doc.id}/post`, {}).expect(201);
      expect(replay.body.employment.id).toBe(first.body.employment.id);
      expect(again.body.alreadyPosted).toBe(true);
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(1);
      expect(await prisma.hrEvent.count({ where: { tenantId, eventType: 'EMPLOYEE_HIRED', employeeId: e.id } })).toBe(1);
    });

    it('staffing capacity: 2 FTE slot, 1.5 occupied, a new 1.0 hire is blocked (BLOCK policy); override needs permission', async () => {
      const a = await newEmployee('Cap', 'One');
      const b = await newEmployee('Cap', 'Two');
      const c = await newEmployee('Cap', 'Three');
      await hire(a.id, '2026-01-01', { staffingPositionId: sp.cap, departmentId: undefined, positionId: undefined, fte: 1 });
      await hire(b.id, '2026-01-01', { staffingPositionId: sp.cap, departmentId: undefined, positionId: undefined, fte: 0.5, employmentType: 'PART_TIME' });
      const doc = await createHire(c.id, '2026-02-01', { staffingPositionId: sp.cap, departmentId: undefined, positionId: undefined, fte: 1 });
      const res = await api('post', `/hr/hires/${doc.id}/post`, {}).expect(422);
      expect(res.body.code).toBe('HR_STAFFING_CAPACITY_EXCEEDED');
      expect(res.body.message).toContain('Staffing Position FIN-ACC-02 has no available FTE');

      const report = (await api('get', `/hr/staffing?organizationId=${orgA}&asOf=2026-02-01`).expect(200)).body;
      const row = report.rows.find((r: any) => r.code === 'FIN-ACC-02');
      expect(row).toMatchObject({ approvedFte: 2, occupiedFte: 1.5, vacantFte: 0.5, occupiedHeadcount: 2 });
      expect(row.plannedFte).toBe(1);

      const overridden = await createHire(c.id, '2026-02-01', { staffingPositionId: sp.cap, departmentId: undefined, positionId: undefined, fte: 1, overrideStaffingLimit: true });
      await api('post', `/hr/hires/${doc.id}/cancel`, {}).expect(201);
      const ok = await api('post', `/hr/hires/${overridden.id}/post`, {}).expect(201);
      expect(ok.body.warnings.map((w: any) => w.code)).toContain('HR_STAFFING_LIMIT_OVERRIDDEN');
    });

    it('blocks inactive department and inactive position', async () => {
      const e = await newEmployee('Inactive', 'Refs');
      const d1 = await createHire(e.id, '2026-02-01', { departmentId: dep.closed });
      const r1 = await api('post', `/hr/hires/${d1.id}/post`, {}).expect(422);
      expect(r1.body.code).toBe('HR_INACTIVE_REFERENCE');
      await api('post', `/hr/hires/${d1.id}/cancel`, {}).expect(201);
      const d2 = await createHire(e.id, '2026-02-01', { positionId: pos.old });
      const r2 = await api('post', `/hr/hires/${d2.id}/post`, {}).expect(422);
      expect(r2.body.code).toBe('HR_INACTIVE_REFERENCE');
    });
  });

  describe('Transfers, schedule, manager hierarchy (spec 24-35, 132-137, 141)', () => {
    it('transfer effective 1 April: as-of 15 March shows A/X, as-of 10 April shows B/Y; old assignment closed 31 March', async () => {
      const e = await newEmployee('Trans', 'Fer');
      const { employmentId } = await hire(e.id, '2026-01-01');
      const t = await transfer(employmentId, '2026-04-01', { newDepartmentId: dep.aud, newPositionId: pos.aud });
      const pv = await api('post', `/hr/transfers/${t.id}/preview`).expect(201);
      expect(pv.body.before.departmentName).toBe('Finance');
      expect(pv.body.after.departmentName).toBe('Internal Audit');
      await postTransfer(t.id);
      const march = await state(employmentId, '2026-03-15');
      const april = await state(employmentId, '2026-04-10');
      expect([march.assignment.departmentId, march.assignment.positionId]).toEqual([dep.fin, pos.ja]);
      expect([april.assignment.departmentId, april.assignment.positionId]).toEqual([dep.aud, pos.aud]);
      const rows = await prisma.employeeAssignment.findMany({ where: { employmentId }, orderBy: { sequence: 'asc' } });
      expect(iso(rows[0].effectiveTo!)).toBe('2026-03-31');
      expect(rows[1].effectiveTo).toBeNull();

      const hist = (await api('get', `/hr/history/${employmentId}`).expect(200)).body;
      expect(hist.timeline.map((x: any) => x.eventType)).toEqual(['HIRE', 'COMBINED_TRANSFER']);
      expect(hist.timeline[1].sourceDocumentNumber).toBe(t.number);
    });

    it('future transfer leaves the current state unchanged until its effective date', async () => {
      const e = await newEmployee('Future', 'Transfer');
      const { employmentId } = await hire(e.id, '2026-01-01');
      const eff = plusDays(40);
      const t = await transfer(employmentId, eff, { newDepartmentId: dep.aud }, 'DEPARTMENT_TRANSFER');
      await postTransfer(t.id);
      expect((await state(employmentId, plusDays(0))).assignment.departmentId).toBe(dep.fin);
      expect((await state(employmentId, eff)).assignment.departmentId).toBe(dep.aud);
      const emp = await prisma.employment.findUnique({ where: { id: employmentId } });
      expect(emp!.departmentId).toBe(dep.fin); // projection = today
    });

    it('schedule S1 until 31 May, S2 from 1 June', async () => {
      const e = await newEmployee('Sched', 'Change');
      const { employmentId } = await hire(e.id, '2026-01-01');
      await api('post', `/hr/employments/${employmentId}/schedule-changes`, { workScheduleId: ws.shift, effectiveFrom: '2026-06-01', reason: '5-day -> shift' }).expect(201);
      expect((await state(employmentId, '2026-05-31')).workSchedule.code).toBe('5DAY');
      expect((await state(employmentId, '2026-06-01')).workSchedule.code).toBe('SHIFT');
      const events = (await api('get', `/hr/events?employmentId=${employmentId}&eventType=EMPLOYEE_SCHEDULE_CHANGED`).expect(200)).body;
      expect(events).toHaveLength(1);
    });

    it('blocks self-management and a circular reporting line (A->B->C, C manages A)', async () => {
      const a = await hire((await newEmployee('Mgr', 'A')).id, '2026-01-01');
      const b = await hire((await newEmployee('Mgr', 'B')).id, '2026-01-01', { managerEmploymentId: a.employmentId });
      const c = await hire((await newEmployee('Mgr', 'C')).id, '2026-01-01', { managerEmploymentId: b.employmentId });
      const self = await transfer(a.employmentId, '2026-03-01', { newManagerEmploymentId: a.employmentId }, 'MANAGER_CHANGE');
      expect((await postTransfer(self.id, 422)).body.code).toBe('HR_CIRCULAR_MANAGER');
      await api('post', `/hr/transfers/${self.id}/cancel`, {}).expect(201);
      const circ = await transfer(a.employmentId, '2026-03-01', { newManagerEmploymentId: c.employmentId }, 'MANAGER_CHANGE');
      const res = await postTransfer(circ.id, 422);
      expect(res.body.code).toBe('HR_CIRCULAR_MANAGER');
      expect(res.body.message).toBe('Manager assignment would create a circular reporting hierarchy');

      const chart = (await api('get', `/hr/org-chart?organizationId=${orgA}&asOf=2026-03-01`).expect(200)).body;
      const findNode = (nodes: any[], id: string): any => nodes.map((n) => (n.employmentId === id ? n : findNode(n.reports, id))).find(Boolean);
      const nodeA = findNode(chart.reportingTree, a.employmentId);
      expect(nodeA.reports[0].employmentId).toBe(b.employmentId);
      expect(nodeA.reports[0].reports[0].employmentId).toBe(c.employmentId);
    });

    it('blocks an overlapping primary employment and a change before an already posted later change', async () => {
      const e = await newEmployee('Over', 'Lap');
      const { employmentId } = await hire(e.id, '2026-01-01');
      const second = await createHire(e.id, '2026-04-01', { employmentType: 'PART_TIME', fte: 0.5 });
      const r = await api('post', `/hr/hires/${second.id}/post`, {}).expect(409);
      expect(r.body.code).toBe('HR_PRIMARY_EMPLOYMENT_CONFLICT');
      const dup = await createHire(e.id, '2026-04-01', { primaryEmployment: false, fte: 0.5 });
      expect((await api('post', `/hr/hires/${dup.id}/post`, {}).expect(409)).body.code).toBe('HR_DUPLICATE_EMPLOYMENT');

      const later = await transfer(employmentId, '2026-06-01', { newPositionId: pos.sa }, 'PROMOTION');
      await postTransfer(later.id);
      const earlier = await transfer(employmentId, '2026-04-01', { newDepartmentId: dep.aud });
      const res = await postTransfer(earlier.id, 409);
      expect(res.body.code).toBe('HR_EFFECTIVE_DATE_CONFLICT');
      expect(res.body.message).toContain('01.04.2026');
    });

    it('two parallel transfers for the same employment/date: exactly one state transition', async () => {
      const e = await newEmployee('Con', 'Current');
      const { employmentId } = await hire(e.id, '2026-01-01');
      const t1 = await transfer(employmentId, '2026-05-01', { newDepartmentId: dep.aud });
      const t2 = await transfer(employmentId, '2026-05-01', { newDepartmentId: dep.ops });
      const [r1, r2] = await Promise.all([api('post', `/hr/transfers/${t1.id}/post`, {}), api('post', `/hr/transfers/${t2.id}/post`, {})]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      const covering = await prisma.employeeAssignment.findMany({
        where: { employmentId, recordStatus: 'ACTIVE', effectiveFrom: { lte: new Date('2026-05-01') }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date('2026-05-01') } }] },
      });
      expect(covering).toHaveLength(1);
    });

    it('same-day changes keep a deterministic sequence', async () => {
      const e = await newEmployee('Same', 'Day');
      const { employmentId } = await hire(e.id, '2026-01-01');
      await postTransfer((await transfer(employmentId, '2026-01-01', { newCostCenter: 'CC-1' })).id);
      await postTransfer((await transfer(employmentId, '2026-01-01', { newCostCenter: 'CC-2' })).id);
      const rows = await prisma.employeeAssignment.findMany({ where: { employmentId, recordStatus: 'ACTIVE' }, orderBy: { sequence: 'asc' } });
      expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
      expect((await state(employmentId, '2026-01-01')).assignment.costCenter).toBe('CC-2');
    });

    it('bulk transfer validates each line separately', async () => {
      const x = await hire((await newEmployee('Bulk', 'X')).id, '2026-01-01');
      const res = await api('post', '/hr/transfers/bulk', {
        effectiveDate: '2026-07-01',
        transferType: 'DEPARTMENT_TRANSFER',
        post: true,
        lines: [{ employmentId: x.employmentId, newDepartmentId: dep.aud }, { employmentId: x.employmentId, newDepartmentId: dep.closed }],
      }).expect(201);
      expect(res.body.succeeded).toBe(1);
      expect(res.body.failed).toBe(1);
      expect(res.body.batchNumber).toMatch(/^BTRF-/);
    });
  });

  describe('Headcount, FTE, backdated changes (spec 52-54, 122-124, 138, 139)', () => {
    it('two 0.5 FTE employees: headcount 2, FTE 1.0', async () => {
      await hire((await newEmployee('Half', 'One')).id, '2026-01-01', { departmentId: dep.whs, positionId: pos.clerk, fte: 0.5, employmentType: 'PART_TIME' });
      await hire((await newEmployee('Half', 'Two')).id, '2026-01-01', { departmentId: dep.whs, positionId: pos.clerk, fte: 0.5, employmentType: 'PART_TIME' });
      const hc = (await api('get', `/hr/headcount?organizationId=${orgA}&asOf=2026-02-01&groupBy=department`).expect(200)).body;
      const row = hc.rows.find((r: any) => r.key === dep.whs);
      expect(row.headcount).toBe(2);
      expect(row.fte).toBe(1);
    });

    it('backdated transfer after downstream data exists emits HR_RECALCULATION_REQUIRED from the effective date', async () => {
      const events = app.get(HrEventService);
      events.registerDownstreamProvider({ name: 'PAYROLL_TEST', hasDerivedData: async () => true, isFinalized: async () => false });
      try {
        const e = await newEmployee('Back', 'Dated');
        const { employmentId } = await hire(e.id, '2026-01-01');
        const t = await transfer(employmentId, '2026-08-15', { newDepartmentId: dep.aud });
        await postTransfer(t.id);
        const rec = (await api('get', `/hr/events?employmentId=${employmentId}&eventType=HR_RECALCULATION_REQUIRED`).expect(200)).body;
        const forTransfer = rec.find((r: any) => r.sourceDocumentId === t.id);
        expect(forTransfer).toBeDefined();
        expect(forTransfer.payload.affected_from).toBe('2026-08-15');
        expect(forTransfer.payload.affected_consumers).toContain('PAYROLL_TEST');
      } finally {
        events.unregisterDownstreamProvider('PAYROLL_TEST');
      }
    });

    it('a finalized downstream period blocks HR changes effective in it', async () => {
      const events = app.get(HrEventService);
      const e = await newEmployee('Final', 'Ized');
      const { employmentId } = await hire(e.id, '2026-01-01');
      events.registerDownstreamProvider({ name: 'PAYROLL_FINAL', hasDerivedData: async () => true, isFinalized: async (_t, id) => id === employmentId });
      try {
        const t = await transfer(employmentId, '2026-03-01', { newDepartmentId: dep.aud });
        expect((await postTransfer(t.id, 409)).body.code).toBe('HR_DOWNSTREAM_DEPENDENCY');
      } finally {
        events.unregisterDownstreamProvider('PAYROLL_FINAL');
      }
    });

    it('a closed HR period blocks changes effective inside it', async () => {
      const e = await newEmployee('Closed', 'Period');
      const { employmentId } = await hire(e.id, '2025-01-01');
      const p = (await api('post', '/hr/periods', { organizationId: orgA, periodStart: '2025-02-01', periodEnd: '2025-02-28' }).expect(201)).body;
      await api('post', `/hr/periods/${p.id}/close`).expect(201);
      const t = await transfer(employmentId, '2025-02-10', { newDepartmentId: dep.aud });
      expect((await postTransfer(t.id, 409)).body.code).toBe('HR_PERIOD_CLOSED');
      await api('post', `/hr/periods/${p.id}/reopen`).expect(201);
      await postTransfer(t.id);
    });
  });

  describe('Contract versioning (spec 11/12, 142)', () => {
    it('June query reads the original version, August the amendment effective 1 July', async () => {
      const e = await newEmployee('Con', 'Tract');
      const { employmentId, doc } = await hire(e.id, '2026-01-01', { contract: { contractType: 'INDEFINITE', workLocation: 'Baku HQ', baseCompensationReference: 'GRADE-5' } });
      const contractId = doc.contractId;
      await api('post', `/hr/contracts/${contractId}/amendments`, { effectiveFrom: '2026-07-01', changes: { workLocation: 'Ganja Branch', baseCompensationReference: 'GRADE-6' }, reason: 'Relocation' }).expect(201);
      const june = (await api('get', `/hr/contracts/${contractId}/version?asOf=2026-06-15`).expect(200)).body;
      const august = (await api('get', `/hr/contracts/${contractId}/version?asOf=2026-08-15`).expect(200)).body;
      expect(june.versionNumber).toBe(1);
      expect(june.terms.workLocation).toBe('Baku HQ');
      expect(august.versionNumber).toBe(2);
      expect(august.terms.workLocation).toBe('Ganja Branch');
      const header = (await api('get', `/hr/contracts/${contractId}`).expect(200)).body;
      expect(header.workLocation).toBe('Baku HQ'); // original never overwritten
      expect((await state(employmentId, '2026-06-15')).contract.versionNumber).toBe(1);
      expect((await state(employmentId, '2026-08-15')).contract.versionNumber).toBe(2);
      await api('post', `/hr/contracts/${contractId}/amendments`, { effectiveFrom: '2026-05-01', changes: { conditions: 'x' } }).expect(422);
    });
  });

  describe('Termination, rehire, multiple employment (spec 29/30, 43-49, 128-130, 135, 143)', () => {
    it('termination closes history without deleting person/employee; rehire creates a new employment', async () => {
      const e = await newEmployee('Term', 'Rehire');
      const { employmentId } = await hire(e.id, '2026-01-15');

      const early = (await api('post', '/hr/terminations', { employmentId, terminationDate: '2026-01-10', terminationReasonCode: 'RESIGNATION' }).expect(201)).body;
      const bad = await api('post', `/hr/terminations/${early.id}/post`, {}).expect(422);
      expect(bad.body.message).toBe('Employee cannot be terminated on 10.01.2026 because employment starts on 15.01.2026.');
      await api('post', `/hr/terminations/${early.id}/cancel`, {}).expect(201);

      const { posted, doc } = await terminate(employmentId, '2026-06-30');
      expect(posted.status).toBe(201);
      const again = await api('post', `/hr/terminations/${doc.id}/post`, {}).expect(201);
      expect(again.body.alreadyPosted).toBe(true);

      expect((await state(employmentId, '2026-06-30')).status).toBe('ACTIVE');
      const july = await state(employmentId, '2026-07-01');
      expect(july.status).toBe('TERMINATED');
      expect(july.assignment).toBeNull();
      expect(july.workSchedule).toBeNull();
      expect(await prisma.physicalPerson.count({ where: { id: e.physicalPersonId } })).toBe(1);
      expect(await prisma.employee.count({ where: { id: e.id } })).toBe(1);

      const afterEnd = await api('post', '/hr/transfers', { employmentId, effectiveDate: '2026-08-01', transferType: 'DEPARTMENT_TRANSFER', newDepartmentId: dep.aud }).expect(422);
      expect(afterEnd.body.code).toBe('HR_EMPLOYMENT_NOT_ACTIVE');

      const tooEarly = (await api('post', '/hr/rehires', { previousEmploymentId: employmentId, hireDate: '2026-06-15', employmentType: 'FULL_TIME', departmentId: dep.ops, positionId: pos.ja, contract: { contractType: 'INDEFINITE' } }).expect(201)).body;
      expect((await api('post', `/hr/rehires/${tooEarly.id}/post`, {}).expect(422)).body.message).toContain('must be after the previous employment end date 30.06.2026');
      await api('post', `/hr/hires/${tooEarly.id}/cancel`, {}).expect(201);

      const rehire = (await api('post', '/hr/rehires', { previousEmploymentId: employmentId, hireDate: '2026-09-01', employmentType: 'FULL_TIME', departmentId: dep.ops, positionId: pos.ja, workScheduleId: ws.std, contract: { contractType: 'INDEFINITE' } }).expect(201)).body;
      const rp = await api('post', `/hr/rehires/${rehire.id}/post`, {}).expect(201);
      const newEmploymentId = rp.body.employment.id;
      expect(newEmploymentId).not.toBe(employmentId);
      expect(rp.body.employment.employeeId).toBe(e.id);
      expect(rp.body.employment.rehireOfEmploymentId).toBe(employmentId);
      const old = await prisma.employment.findUnique({ where: { id: employmentId } });
      expect(iso(old!.employmentEndDate!)).toBe('2026-06-30');
      expect(await prisma.employment.count({ where: { employeeId: e.id } })).toBe(2);

      const card = (await api('get', `/hr/employees/${e.id}?asOf=2026-09-15`).expect(200)).body;
      expect(card.employments).toHaveLength(2);
      expect(card.timeline.map((x: any) => x.eventType)).toEqual(['HIRE', 'TERMINATION', 'REHIRE']);

      // Reversal of the old termination is blocked by the rehire built on it.
      expect((await api('post', `/hr/terminations/${doc.id}/reverse`, { reason: 'x' }).expect(409)).body.code).toBe('HR_DOWNSTREAM_DEPENDENCY');
    });

    it('termination reversal reopens the history; finalized payroll blocks it', async () => {
      const e = await newEmployee('Term', 'Reverse');
      const { employmentId } = await hire(e.id, '2026-01-01');
      const { doc } = await terminate(employmentId, '2026-05-31', 'REDUNDANCY');
      const events = app.get(HrEventService);
      events.registerDownstreamProvider({ name: 'FINAL_SETTLEMENT', hasDerivedData: async () => false, isFinalized: async (_t, id) => id === employmentId });
      try {
        expect((await api('post', `/hr/terminations/${doc.id}/reverse`, { reason: 'Mistake' }).expect(409)).body.code).toBe('HR_DOWNSTREAM_DEPENDENCY');
      } finally {
        events.unregisterDownstreamProvider('FINAL_SETTLEMENT');
      }
      await api('post', `/hr/terminations/${doc.id}/reverse`, { reason: 'Mistake' }).expect(201);
      const s = await state(employmentId, '2026-07-01');
      expect(s.status).toBe('ACTIVE');
      expect(s.assignment.departmentId).toBe(dep.fin);
      expect(s.workSchedule.code).toBe('5DAY');
      const reversed = await prisma.employmentStatusHistory.findMany({ where: { employmentId, recordStatus: 'REVERSED' } });
      expect(reversed.map((r) => r.status)).toEqual(['TERMINATED']);
    });

    it('primary full-time in A + secondary part-time in B are both active with separate assignments and contracts', async () => {
      const e = await newEmployee('Multi', 'Emp');
      const a = await hire(e.id, '2026-01-01');
      const b = await hire(e.id, '2026-02-01', { organizationId: orgB, departmentId: dep.bSales, positionId: pos.clerk, employmentType: 'SECONDARY_EMPLOYMENT', primaryEmployment: false, fte: 0.5 });
      const active = await app.get(HrHistoryService).getActiveEmployments(tenantId, e.id, new Date('2026-03-01'));
      expect(active.map((s) => s.organizationId).sort()).toEqual([orgA, orgB].sort());
      expect(active.every((s) => s.assignment && s.contract)).toBe(true);
      expect(new Set(active.map((s) => s.contract!.contractId)).size).toBe(2);
      expect(a.employmentId).not.toBe(b.employmentId);
      // aggregate FTE policy (max 1.5): another 0.5 is refused
      const c = await createHire(e.id, '2026-03-01', { organizationId: orgB, departmentId: dep.bSales, positionId: pos.clerk, employmentType: 'CONTRACT', primaryEmployment: false, fte: 0.5 });
      expect((await api('post', `/hr/hires/${c.id}/post`, {}).expect(422)).body.code).toBe('HR_FTE_INVALID');
    });
  });

  describe('Suspension, leave, absence (spec 37-41)', () => {
    it('suspension and return to work; approved leave shows ON_LEAVE without terminating', async () => {
      const e = await newEmployee('Susp', 'Ension');
      const { employmentId } = await hire(e.id, '2026-01-01');
      await api('post', `/hr/employments/${employmentId}/suspend`, { effectiveFrom: '2026-03-01', reasonCode: 'MILITARY_SERVICE' }).expect(201);
      await api('post', `/hr/employments/${employmentId}/return-to-work`, { effectiveFrom: '2026-04-01' }).expect(201);
      expect((await state(employmentId, '2026-03-15')).status).toBe('SUSPENDED');
      expect((await state(employmentId, '2026-04-02')).status).toBe('ACTIVE');

      const leave = (await api('post', '/hr/leaves', { employmentId, leaveTypeCode: 'ANNUAL', startDate: '2026-05-10', endDate: '2026-05-20' }).expect(201)).body;
      expect((await state(employmentId, '2026-05-12')).status).toBe('ACTIVE');
      await api('post', `/hr/leaves/${leave.id}/approve`).expect(201);
      const s = await state(employmentId, '2026-05-12');
      expect(s.status).toBe('ON_LEAVE');
      expect(s.isEmployed).toBe(true);
      expect(s.leave[0].leaveTypeCode).toBe('ANNUAL');
      await api('post', '/hr/leaves', { employmentId, leaveTypeCode: 'ANNUAL', startDate: '2026-05-15', endDate: '2026-05-25' }).expect(409);
      await api('post', '/hr/leaves', { employmentId, leaveTypeCode: 'NOPE', startDate: '2026-06-15', endDate: '2026-06-25' }).expect(400);

      await api('post', '/hr/absences', { employmentId, absenceTypeCode: 'SICK', startDate: '2026-06-03', endDate: '2026-06-03', hours: 4 }).expect(201);
      expect((await state(employmentId, '2026-06-03')).absences).toHaveLength(1);
      await api('post', '/hr/business-trips', { employmentId, destination: 'Ganja', startDate: '2026-06-10', endDate: '2026-06-12' }).expect(201);
      expect((await state(employmentId, '2026-06-11')).businessTrips[0].destination).toBe('Ganja');

      const segments = (await api('get', `/hr/employments/${employmentId}/segments?from=2026-03-01&to=2026-05-31`).expect(200)).body;
      expect(segments.map((x: any) => x.status)).toEqual(['SUSPENDED', 'ACTIVE', 'ON_LEAVE', 'ACTIVE']);
    });
  });

  describe('Security, isolation, approvals (spec 61/62, 80/81, tenant isolation)', () => {
    let limited: { token: string; tenantId: string };
    let approver: { token: string; tenantId: string };

    beforeAll(async () => {
      limited = { token: await addUser('viewer', ['hr.person.view', 'hr.employee.view', 'organization.view']), tenantId };
      approver = { token: await addUser('approver', ['hr.employee.view', 'hr.document.approve', 'hr.hire.post']), tenantId };
    });

    async function addUser(tag: string, codes: string[]) {
      const reg = await request(app.getHttpServer()).post('/auth/register').send({ email: `hr17-${tag}-${run}@e2e.test`, password: 'Test1234!', displayName: tag }).expect(201);
      const membership = await prisma.tenantMembership.create({ data: { tenantId, userId: reg.body.userId, status: 'ACTIVE' } });
      await prisma.organizationAccess.create({ data: { tenantMembershipId: membership.id, organizationId: orgA, accessLevel: 'FULL' } });
      const role = await prisma.role.create({ data: { tenantId, code: `HR17_${tag.toUpperCase()}_${run}`, name: tag } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
      return reg.body.accessToken as string;
    }

    it('field-level security: without personal-data permission IDs are redacted; bank data needs its own permission', async () => {
      const p = (await api('post', '/hr/persons', { firstName: 'Secret', lastName: 'Person', personalId: `S${String(run).slice(-7)}`, address: 'Private street 1' }).expect(201)).body;
      const full = (await api('get', `/hr/persons/${p.id}`).expect(200)).body;
      expect(full.address).toBe('Private street 1');
      const redacted = (await api('get', `/hr/persons/${p.id}`, undefined, limited).expect(200)).body;
      expect(redacted.fullName).toBe('Person Secret');
      expect(redacted.personalId).toBeNull();
      expect(redacted.address).toBeNull();
      const emp = (await api('post', '/hr/employees', { physicalPersonId: p.id }).expect(201)).body;
      await api('post', `/hr/employees/${emp.id}/bank-accounts`, { bankName: 'Kapital', iban: 'AZ21NABZ00000000137010001944' }).expect(201);
      await api('get', `/hr/employees/${emp.id}/bank-accounts`, undefined, limited).expect(403);
      await api('post', '/hr/hires', { organizationId: orgA, employeeId: emp.id, hireDate: '2026-01-01', employmentType: 'FULL_TIME', departmentId: dep.fin, positionId: pos.ja }, limited).expect(403);
      const viewed = await prisma.auditEvent.count({ where: { tenantId, eventType: 'HR_SENSITIVE_DATA_VIEWED', entityId: p.id } });
      expect(viewed).toBe(1);
    });

    it('segregation of duties: with requireApproval the creator cannot approve; another user can, then post', async () => {
      await api('put', '/hr/policies', { requireApproval: true }).expect(200);
      try {
        const e = await newEmployee('Sod', 'Check');
        const doc = await createHire(e.id, '2026-02-01');
        expect((await api('post', `/hr/hires/${doc.id}/post`, {}).expect(409)).body.code).toBe('HR_APPROVAL_REQUIRED');
        await api('post', `/hr/hires/${doc.id}/submit`, {}).expect(201);
        expect((await api('post', `/hr/hires/${doc.id}/approve`, {}).expect(403)).body.code).toBe('HR_SEGREGATION_OF_DUTIES');
        const approved = await api('post', `/hr/hires/${doc.id}/approve`, {}, approver).expect(201);
        expect(approved.body.status).toBe('APPROVED');
        const posted = await api('post', `/hr/hires/${doc.id}/post`, {}).expect(201);
        expect(posted.body.document.status).toBe('POSTED');
      } finally {
        await api('put', '/hr/policies', { requireApproval: false }).expect(200);
      }
    });

    it('tenant isolation: another tenant cannot see this tenant\'s HR data', async () => {
      const other = await setupTenant(`hr17-other-${run}@e2e.test`, `hr17o-${run}`);
      const as = { token: other.token, tenantId: other.tenantId };
      const anyEmployment = await prisma.employment.findFirst({ where: { tenantId } });
      await api('get', `/hr/employments/${anyEmployment!.id}`, undefined, as).expect(404);
      await api('get', `/hr/employees/${anyEmployment!.employeeId}`, undefined, as).expect(404);
      expect((await api('get', '/hr/persons', undefined, as).expect(200)).body).toHaveLength(0);
      expect((await api('get', '/hr/employments', undefined, as).expect(200)).body).toHaveLength(0);
    });
  });

  describe('Reports, health, import (spec 86-99)', () => {
    it('movement, hire/termination/transfer, contract expiry, probation and leave reports', async () => {
      const e = await newEmployee('Rep', 'Orts');
      const { employmentId } = await hire(e.id, '2026-01-01', { departmentId: dep.ops, positionId: pos.clerk, contract: { contractType: 'FIXED_TERM', effectiveTo: plusDays(20), probationPeriodDays: 90 }, probationEndDate: plusDays(10) });
      const mv = (await api('get', `/hr/reports/movement?organizationId=${orgA}&departmentId=${dep.ops}&from=2026-01-01&to=2026-01-31`).expect(200)).body;
      expect(mv.hires).toBeGreaterThanOrEqual(1);
      expect(mv.closingHeadcount).toBe(mv.openingHeadcount + mv.hires + mv.transfersIn - mv.transfersOut - mv.terminations);
      const expiry = (await api('get', `/hr/reports/contract-expiry?organizationId=${orgA}&days=30`).expect(200)).body;
      expect(expiry.find((r: any) => r.employmentId === employmentId).daysRemaining).toBe(20);
      const prob = (await api('get', `/hr/reports/probation?organizationId=${orgA}&days=30`).expect(200)).body;
      expect(prob.find((r: any) => r.employmentId === employmentId).daysRemaining).toBe(10);
      const hires = (await api('get', `/hr/reports/hires?organizationId=${orgA}&from=2026-01-01&to=2026-01-01`).expect(200)).body;
      expect(hires.length).toBeGreaterThan(0);
      await api('get', `/hr/reports/terminations?organizationId=${orgA}`).expect(200);
      await api('get', `/hr/reports/transfers?organizationId=${orgA}`).expect(200);
      await api('get', `/hr/reports/leave-absence?organizationId=${orgA}`).expect(200);
      const list = (await api('get', `/hr/employments?organizationId=${orgA}&asOf=2026-02-01`).expect(200)).body;
      expect(list.find((r: any) => r.employmentId === employmentId)).toMatchObject({ departmentName: 'Finance Operations', positionName: 'Clerk', status: 'ACTIVE' });
    });

    it('HR health report returns severities and flags duplicates', async () => {
      const health = (await api('get', `/hr/health?organizationId=${orgA}`).expect(200)).body;
      expect(Object.keys(health.summary)).toEqual(['INFO', 'WARNING', 'ERROR', 'BLOCKING']);
      expect(health.issues.some((i: any) => i.check === 'DUPLICATE_PHYSICAL_PERSONS')).toBe(true);
      expect(health.issues.some((i: any) => i.check === 'OVERLAPPING_ASSIGNMENTS')).toBe(false);
    });

    it('import validation detects duplicates against the database and inside the file, without writing', async () => {
      const before = await prisma.physicalPerson.count({ where: { tenantId } });
      const res = await api('post', '/hr/import/validate', {
        rows: [
          { firstName: 'Fərid', lastName: 'Məmmədov', birthDate: '1988-05-10' },
          { firstName: 'New', lastName: 'Person', birthDate: '1999-01-01', personalId: 'IMP0001' },
          { firstName: 'New2', lastName: 'Person2', personalId: 'imp0001' },
          { lastName: 'NoFirst', birthDate: '1-1-1999' },
        ],
      }).expect(201);
      expect(res.body.rows[0].warnings.join(' ')).toContain('Possible duplicate');
      expect(res.body.rows[1].valid).toBe(true);
      expect(res.body.rows[2].valid).toBe(false);
      expect(res.body.rows[3].errors).toEqual(expect.arrayContaining(['firstName is required', 'birthDate must be YYYY-MM-DD']));
      expect(await prisma.physicalPerson.count({ where: { tenantId } })).toBe(before);
    });
  });

  describe('End-to-end business scenario (spec 149)', () => {
    it('Aysel Məmmədova: hire, promotion, schedule change, leave, transfer, termination, rehire — every date answers correctly', async () => {
      const Y = 2025;
      const emp = (await api('post', '/hr/employees', { person: { firstName: 'Aysel', lastName: 'Məmmədova', birthDate: '1995-03-03', personalId: `AYS${String(run).slice(-7)}` } }).expect(201)).body;
      const manager1 = await hire((await newEmployee('Fin', 'Manager')).id, `${Y}-01-01`, { departmentId: dep.fin, positionId: pos.sa, staffingPositionId: sp.finSa });
      const manager2 = await hire((await newEmployee('Audit', 'Manager')).id, `${Y}-01-01`, { departmentId: dep.aud, positionId: pos.aud, staffingPositionId: sp.aud });

      const hireDoc = await createHire(emp.id, `${Y}-02-01`, { staffingPositionId: sp.finJa, departmentId: undefined, positionId: undefined, managerEmploymentId: manager1.employmentId, workScheduleId: ws.std, costCenter: 'CC-FIN', contract: { contractType: 'INDEFINITE', signedStatus: 'SIGNED' } });
      const posted = await api('post', `/hr/hires/${hireDoc.id}/post`, {}).expect(201);
      const e1 = posted.body.employment.id;
      expect((await state(e1, `${Y}-01-31`)).status).toBe('PLANNED');
      expect((await state(e1, `${Y}-02-01`)).status).toBe('ACTIVE');

      const promo = await transfer(e1, `${Y}-08-01`, { newStaffingPositionId: sp.finSa }, 'PROMOTION');
      await postTransfer(promo.id);
      await api('post', `/hr/employments/${e1}/schedule-changes`, { workScheduleId: ws.flex, effectiveFrom: `${Y}-10-01` }).expect(201);
      const leave = (await api('post', '/hr/leaves', { employmentId: e1, leaveTypeCode: 'ANNUAL', startDate: `${Y}-11-10`, endDate: `${Y}-11-20` }).expect(201)).body;
      await api('post', `/hr/leaves/${leave.id}/approve`).expect(201);
      const move = await transfer(e1, `${Y + 1}-01-01`, { newStaffingPositionId: sp.aud, newManagerEmploymentId: manager2.employmentId, newCostCenter: 'CC-AUD' }, 'DEPARTMENT_TRANSFER');
      await postTransfer(move.id);
      await terminate(e1, `${Y + 1}-03-31`);
      const rh = (await api('post', '/hr/rehires', { previousEmploymentId: e1, hireDate: `${Y + 1}-09-01`, employmentType: 'FULL_TIME', departmentId: dep.ops, positionId: pos.ja, workScheduleId: ws.std, contract: { contractType: 'INDEFINITE' } }).expect(201)).body;
      const e2 = (await api('post', `/hr/rehires/${rh.id}/post`, {}).expect(201)).body.employment.id;

      const feb = await state(e1, `${Y}-02-15`);
      expect(feb.assignment.positionName).toBe('Junior Accountant');
      expect(feb.workSchedule.name).toBe('5-Day Standard');
      const aug = await state(e1, `${Y}-08-15`);
      expect(aug.assignment.positionName).toBe('Senior Accountant');
      expect(aug.assignment.departmentName).toBe('Finance');
      expect(aug.assignment.staffingPositionCode).toBe('FIN-SA-01');
      expect((await state(e1, `${Y}-10-15`)).workSchedule.name).toBe('Flexible Schedule');
      expect((await state(e1, `${Y}-11-15`)).status).toBe('ON_LEAVE');
      const jan = await state(e1, `${Y + 1}-01-15`);
      expect(jan.assignment.departmentName).toBe('Internal Audit');
      expect(jan.assignment.managerEmploymentId).toBe(manager2.employmentId);
      expect(jan.assignment.costCenter).toBe('CC-AUD');
      const april = await app.get(HrHistoryService).getActiveEmployments(tenantId, emp.id, new Date(Date.UTC(Y + 1, 3, 15)));
      expect(april).toHaveLength(0);
      const sept = await app.get(HrHistoryService).getActiveEmployments(tenantId, emp.id, new Date(Date.UTC(Y + 1, 8, 15)));
      expect(sept.map((s) => s.employmentId)).toEqual([e2]);
      expect(sept[0].assignment!.departmentName).toBe('Finance Operations');

      // Headcount as of each date (Internal Audit dept): only while she was there.
      const hcAud = async (d: string) => ((await api('get', `/hr/headcount?organizationId=${orgA}&asOf=${d}&groupBy=department`).expect(200)).body.rows.find((r: any) => r.key === dep.aud)?.headcount ?? 0);
      expect(await hcAud(`${Y + 1}-01-01`)).toBe((await hcAud(`${Y}-12-31`)) + 1);
      const listed = async (d: string) => (await api('get', `/hr/employments?organizationId=${orgA}&asOf=${d}`).expect(200)).body.find((r: any) => r.employmentId === e1);
      expect((await listed(`${Y + 1}-01-15`)).departmentName).toBe('Internal Audit');
      expect(await listed(`${Y + 1}-04-15`)).toBeUndefined();

      // Payroll-period contract: segments for January next year are one slice.
      const segs = (await api('get', `/hr/employments/${e1}/segments?from=${Y + 1}-01-01&to=${Y + 1}-01-31`).expect(200)).body;
      expect(segs).toHaveLength(1);
      expect(segs[0]).toMatchObject({ departmentId: dep.aud, fte: 1, costCenter: 'CC-AUD', workScheduleId: ws.flex, status: 'ACTIVE' });
      const period = (await api('get', `/hr/employments-in-period?organizationId=${orgA}&from=${Y + 1}-03-01&to=${Y + 1}-03-31`).expect(200)).body;
      expect(period.find((p: any) => p.employmentId === e1).terminatedInPeriod).toBe(true);

      // Drill-down: person -> employee -> employments -> documents / audit.
      const card = (await api('get', `/hr/employees/${emp.id}?asOf=${Y + 1}-09-15`).expect(200)).body;
      expect(card.timeline.map((x: any) => x.eventType)).toEqual(['HIRE', 'PROMOTION', 'SCHEDULE_CHANGE', 'LEAVE_START', 'LEAVE_END', 'DEPARTMENT_TRANSFER', 'TERMINATION', 'REHIRE']);
      const links = (await api('get', `/document-links?documentType=HR_HIRE&documentId=${hireDoc.id}`).expect(200)).body;
      expect(links.map((l: any) => l.targetDocumentType)).toEqual(expect.arrayContaining(['HR_CONTRACT', 'HR_EMPLOYMENT']));
      const audit = await prisma.auditEvent.findMany({ where: { tenantId, entityId: { in: [hireDoc.id, promo.id, move.id] } } });
      expect(audit.map((a) => a.eventType)).toEqual(expect.arrayContaining(['HR_HIRE_POSTED', 'HR_TRANSFER_POSTED']));
    });
  });
});
