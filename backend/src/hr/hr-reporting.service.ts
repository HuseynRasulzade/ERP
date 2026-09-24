import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationAppError } from '../common/errors/app-error';
import { addDays, daysBetween, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrHistoryService } from './hr-history.service';
import { EmploymentService } from './employment.service';
import { HrValidationService } from './hr-validation.service';
import { PhysicalPersonService } from './physical-person.service';

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const GROUPS = ['organization', 'branch', 'department', 'position', 'employmentType', 'status'] as const;

/**
 * HRReportingService (spec 52/54/87-97). Every as-of report is computed
 * from the effective-dated assignment/status register (HrHistoryService
 * .snapshot) — never from the "current" projection columns (spec 52).
 * Headcount and FTE are always separate measures (spec 54/138).
 */
@Injectable()
export class HrReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: HrHistoryService,
    private readonly employments: EmploymentService,
    private readonly validation: HrValidationService,
  ) {}

  private async orgIds(tenantId: string, membershipId: string, organizationId?: string) {
    return this.employments.accessibleOrgIds(tenantId, membershipId, organizationId);
  }

  /** Headcount + FTE as of a date, grouped by one dimension (spec 88). */
  async headcount(tenantId: string, membershipId: string, q: { asOf?: string; organizationId?: string; groupBy?: string }) {
    const asOf = parseOptionalHrDate(q.asOf, 'asOf') ?? todayHr();
    const groupBy = (q.groupBy ?? 'department') as (typeof GROUPS)[number];
    if (!GROUPS.includes(groupBy)) throw new ValidationAppError(`groupBy must be one of ${GROUPS.join(', ')}`);
    const snap = await this.history.snapshot(tenantId, asOf, { organizationIds: await this.orgIds(tenantId, membershipId, q.organizationId) });
    const [orgs, branches] = await Promise.all([
      this.prisma.organization.findMany({ where: { id: { in: [...new Set(snap.map((s) => s.organizationId))] } }, select: { id: true, name: true } }),
      this.prisma.branch.findMany({ where: { id: { in: snap.map((s) => s.branchId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const groups = new Map<string, { key: string; label: string; headcount: number; fte: number; employees: Set<string> }>();
    for (const s of snap) {
      const [key, label] =
        groupBy === 'organization' ? [s.organizationId, orgName.get(s.organizationId) ?? s.organizationId]
        : groupBy === 'branch' ? [s.branchId ?? '-', s.branchId ? branchName.get(s.branchId) ?? s.branchId : '—']
        : groupBy === 'department' ? [s.departmentId, s.departmentName ?? s.departmentId]
        : groupBy === 'position' ? [s.positionId, s.positionName ?? s.positionId]
        : groupBy === 'employmentType' ? [s.employmentType, s.employmentType]
        : [s.status, s.status];
      const g = groups.get(key) ?? { key, label, headcount: 0, fte: 0, employees: new Set<string>() };
      g.headcount += 1;
      g.fte += s.fte;
      g.employees.add(s.employeeId);
      groups.set(key, g);
    }
    const rows = [...groups.values()].map((g) => ({ key: g.key, label: g.label, headcount: g.headcount, distinctEmployees: g.employees.size, fte: round4(g.fte) })).sort((a, b) => a.label.localeCompare(b.label));
    return {
      asOfDate: isoHr(asOf),
      groupBy,
      rows,
      totals: { headcount: snap.length, distinctEmployees: new Set(snap.map((s) => s.employeeId)).size, fte: round4(snap.reduce((n, s) => n + s.fte, 0)) },
    };
  }

  /** Org chart as of a date (spec 35/87): Organization -> Department ->
   * (manager tree) employees, with position and FTE. */
  async orgChart(tenantId: string, membershipId: string, q: { asOf?: string; organizationId: string }) {
    if (!q.organizationId) throw new ValidationAppError('organizationId is required');
    const asOf = parseOptionalHrDate(q.asOf, 'asOf') ?? todayHr();
    const snap = await this.history.snapshot(tenantId, asOf, { organizationIds: await this.orgIds(tenantId, membershipId, q.organizationId) });
    const departments = await this.prisma.department.findMany({ where: { organizationId: q.organizationId }, orderBy: { code: 'asc' } });
    const node = (s: (typeof snap)[number]) => ({
      employmentId: s.employmentId,
      employeeId: s.employeeId,
      personnelNumber: s.personnelNumber,
      employeeName: s.employeeName,
      positionName: s.positionName,
      fte: s.fte,
      status: s.status,
      managerEmploymentId: s.managerEmploymentId,
    });
    const byManager = new Map<string, typeof snap>();
    for (const s of snap) if (s.managerEmploymentId) byManager.set(s.managerEmploymentId, [...(byManager.get(s.managerEmploymentId) ?? []), s]);
    const inSnapshot = new Set(snap.map((s) => s.employmentId));
    const build = (s: (typeof snap)[number], depth = 0): any => ({ ...node(s), reports: depth > 50 ? [] : (byManager.get(s.employmentId) ?? []).map((r) => build(r, depth + 1)) });
    const roots = snap.filter((s) => !s.managerEmploymentId || !inSnapshot.has(s.managerEmploymentId));
    return {
      asOfDate: isoHr(asOf),
      organizationId: q.organizationId,
      departments: departments
        .map((d) => {
          const members = snap.filter((s) => s.departmentId === d.id);
          const managerIds = new Set(members.map((m) => m.managerEmploymentId).filter(Boolean));
          return {
            departmentId: d.id,
            code: d.code,
            name: d.name,
            parentDepartmentId: d.parentDepartmentId,
            active: d.active,
            headcount: members.length,
            fte: round4(members.reduce((n, m) => n + m.fte, 0)),
            managers: snap.filter((s) => managerIds.has(s.employmentId)).map(node),
            employees: members.map(node),
          };
        })
        .filter((d) => d.headcount > 0 || d.active),
      reportingTree: roots.map((r) => build(r)),
    };
  }

  /** Staffing report (spec 17/89): approved vs occupied vs vacant, as of a
   * date, using the staffing-table version valid on that date. */
  async staffing(tenantId: string, membershipId: string, q: { asOf?: string; organizationId: string }) {
    if (!q.organizationId) throw new ValidationAppError('organizationId is required');
    await this.orgIds(tenantId, membershipId, q.organizationId);
    const asOf = parseOptionalHrDate(q.asOf, 'asOf') ?? todayHr();
    const positions = await this.prisma.staffingPosition.findMany({
      where: {
        tenantId,
        organizationId: q.organizationId,
        activeFrom: { lte: asOf },
        OR: [{ activeTo: null }, { activeTo: { gte: asOf } }],
        staffingTable: { status: { in: ['ACTIVE', 'SUPERSEDED'] }, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
      },
      include: { department: { select: { name: true, active: true } }, position: { select: { name: true } }, staffingTable: { select: { name: true, versionNumber: true } } },
      orderBy: { code: 'asc' },
    });
    const planned = await this.prisma.hireDocument.findMany({ where: { tenantId, organizationId: q.organizationId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] }, staffingPositionId: { not: null } }, select: { staffingPositionId: true, fte: true } });
    const futureHires = await this.prisma.hireDocument.findMany({ where: { tenantId, organizationId: q.organizationId, status: 'POSTED', hireDate: { gt: asOf }, staffingPositionId: { not: null } }, select: { staffingPositionId: true, fte: true } });
    const codeOf = new Map((await this.prisma.staffingPosition.findMany({ where: { tenantId, organizationId: q.organizationId }, select: { id: true, code: true } })).map((p) => [p.id, p.code]));
    const rows = [];
    for (const p of positions) {
      const occ = await this.validation.occupancy(this.prisma, tenantId, q.organizationId, p.code, asOf);
      const approvedFte = Number(p.fteLimit.toString());
      const plannedFte = [...planned, ...futureHires].filter((h) => codeOf.get(h.staffingPositionId!) === p.code).reduce((n, h) => n + Number(h.fte.toString()), 0);
      rows.push({
        staffingPositionId: p.id,
        code: p.code,
        staffingTable: `${p.staffingTable.name} v${p.staffingTable.versionNumber}`,
        departmentName: p.department.name,
        positionName: p.position.name,
        status: p.status,
        approvedHeadcount: p.headcountLimit,
        approvedFte,
        occupiedHeadcount: occ.headcount,
        occupiedFte: occ.fte,
        vacantHeadcount: Math.max(0, p.headcountLimit - occ.headcount),
        vacantFte: round4(Math.max(0, approvedFte - occ.fte)),
        plannedFte: round4(plannedFte),
        overstaffed: occ.fte > approvedFte + 1e-9 || occ.headcount > p.headcountLimit,
      });
    }
    return {
      asOfDate: isoHr(asOf),
      rows,
      totals: {
        approvedHeadcount: rows.reduce((n, r) => n + r.approvedHeadcount, 0),
        approvedFte: round4(rows.reduce((n, r) => n + r.approvedFte, 0)),
        occupiedHeadcount: rows.reduce((n, r) => n + r.occupiedHeadcount, 0),
        occupiedFte: round4(rows.reduce((n, r) => n + r.occupiedFte, 0)),
        vacantFte: round4(rows.reduce((n, r) => n + r.vacantFte, 0)),
        plannedFte: round4(rows.reduce((n, r) => n + r.plannedFte, 0)),
      },
    };
  }

  /** Employee movement (spec 91): opening, hires, transfers in/out,
   * terminations, closing. Opening = headcount on the day before `from`. */
  async movement(tenantId: string, membershipId: string, q: { from: string; to: string; organizationId?: string; departmentId?: string }) {
    const from = parseHrDate(q.from, 'from');
    const to = parseHrDate(q.to, 'to');
    if (to < from) throw new ValidationAppError('to must be on or after from');
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const inScope = (s: { departmentId: string }) => !q.departmentId || s.departmentId === q.departmentId;
    const opening = (await this.history.snapshot(tenantId, addDays(from, -1), { organizationIds: orgIds })).filter(inScope);
    const closing = (await this.history.snapshot(tenantId, to, { organizationIds: orgIds })).filter(inScope);
    const hires = await this.prisma.employeeAssignment.findMany({
      where: { tenantId, organizationId: { in: orgIds }, recordStatus: 'ACTIVE', isSecondary: false, eventType: { in: ['HIRE', 'REHIRE'] }, effectiveFrom: { gte: from, lte: to }, ...(q.departmentId ? { departmentId: q.departmentId } : {}) },
    });
    const terminations = await this.prisma.employment.findMany({ where: { tenantId, organizationId: { in: orgIds }, status: 'ACTIVE', employmentEndDate: { gte: from, lte: to } } });
    let terminationCount = terminations.length;
    if (q.departmentId) {
      terminationCount = 0;
      for (const t of terminations) {
        const s = await this.history.getDepartment(tenantId, t.id, t.employmentEndDate!);
        if (s?.departmentId === q.departmentId) terminationCount++;
      }
    }
    const changes = await this.prisma.employeeAssignment.findMany({
      where: { tenantId, organizationId: { in: orgIds }, recordStatus: 'ACTIVE', isSecondary: false, eventType: { notIn: ['HIRE', 'REHIRE'] }, effectiveFrom: { gte: from, lte: to } },
      orderBy: [{ effectiveFrom: 'asc' }, { sequence: 'asc' }],
    });
    let transfersIn = 0;
    let transfersOut = 0;
    let transfers = 0;
    for (const c of changes) {
      const prev = await this.prisma.employeeAssignment.findFirst({
        where: { employmentId: c.employmentId, recordStatus: 'ACTIVE', isSecondary: false, OR: [{ effectiveFrom: { lt: c.effectiveFrom } }, { effectiveFrom: c.effectiveFrom, sequence: { lt: c.sequence } }] },
        orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
      });
      if (!prev || prev.departmentId === c.departmentId) continue;
      transfers++;
      if (q.departmentId) {
        if (c.departmentId === q.departmentId) transfersIn++;
        if (prev.departmentId === q.departmentId) transfersOut++;
      }
    }
    if (!q.departmentId) {
      transfersIn = transfers;
      transfersOut = transfers;
    }
    return {
      from: isoHr(from),
      to: isoHr(to),
      openingHeadcount: opening.length,
      openingFte: round4(opening.reduce((n, s) => n + s.fte, 0)),
      hires: hires.length,
      transfersIn,
      transfersOut,
      terminations: terminationCount,
      closingHeadcount: closing.length,
      closingFte: round4(closing.reduce((n, s) => n + s.fte, 0)),
    };
  }

  /** Hire report (spec 92). */
  async hires(tenantId: string, membershipId: string, q: { from?: string; to?: string; organizationId?: string }) {
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const from = parseOptionalHrDate(q.from, 'from');
    const to = parseOptionalHrDate(q.to, 'to');
    const docs = await this.prisma.hireDocument.findMany({
      where: { tenantId, organizationId: { in: orgIds }, status: { in: ['POSTED', 'APPROVED', 'PENDING_APPROVAL', 'DRAFT'] }, ...(from || to ? { hireDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: { hireDate: 'asc' },
    });
    return this.decorateDocs(docs, async (d) => {
      const contract = d.contractId ? await this.prisma.employmentContract.findUnique({ where: { id: d.contractId }, select: { contractNumber: true } }) : null;
      return { number: d.number, isRehire: d.isRehire, hireDate: isoHr(d.hireDate), contractNumber: contract?.contractNumber ?? null, probationEndDate: isoHr(d.probationEndDate), status: d.status, employmentId: d.employmentId };
    });
  }

  private async decorateDocs<T extends { employeeId?: string; departmentId?: string; positionId?: string; organizationId: string }>(docs: T[], extra: (d: T) => Promise<Record<string, unknown>>) {
    const [employees, departments, positions, orgs] = await Promise.all([
      this.prisma.employee.findMany({ where: { id: { in: docs.map((d) => d.employeeId!).filter(Boolean) } }, include: { physicalPerson: { select: { fullName: true } } } }),
      this.prisma.department.findMany({ where: { id: { in: docs.map((d) => d.departmentId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.hrPosition.findMany({ where: { id: { in: docs.map((d) => d.positionId!).filter(Boolean) } }, select: { id: true, name: true } }),
      this.prisma.organization.findMany({ where: { id: { in: docs.map((d) => d.organizationId) } }, select: { id: true, name: true } }),
    ]);
    const e = new Map(employees.map((x) => [x.id, x]));
    const dn = new Map(departments.map((x) => [x.id, x.name]));
    const pn = new Map(positions.map((x) => [x.id, x.name]));
    const on = new Map(orgs.map((x) => [x.id, x.name]));
    const out = [];
    for (const d of docs) {
      out.push({
        employeeId: d.employeeId,
        employeeName: d.employeeId ? e.get(d.employeeId)?.physicalPerson.fullName ?? null : null,
        personnelNumber: d.employeeId ? e.get(d.employeeId)?.personnelNumber ?? null : null,
        organizationName: on.get(d.organizationId) ?? null,
        departmentName: d.departmentId ? dn.get(d.departmentId) ?? null : null,
        positionName: d.positionId ? pn.get(d.positionId) ?? null : null,
        ...(await extra(d)),
      });
    }
    return out;
  }

  /** Termination report (spec 93) with service length. */
  async terminations(tenantId: string, membershipId: string, q: { from?: string; to?: string; organizationId?: string }) {
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const from = parseOptionalHrDate(q.from, 'from');
    const to = parseOptionalHrDate(q.to, 'to');
    const docs = await this.prisma.terminationDocument.findMany({
      where: { tenantId, organizationId: { in: orgIds }, status: 'POSTED', ...(from || to ? { terminationDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: { terminationDate: 'asc' },
    });
    const out = [];
    for (const d of docs) {
      const s = await this.history.getEmploymentState(tenantId, d.employmentId, d.terminationDate);
      const days = daysBetween(new Date(s.employmentStartDate), d.terminationDate) + 1;
      out.push({
        number: d.number,
        employmentId: d.employmentId,
        employeeName: s.employeeName,
        personnelNumber: s.personnelNumber,
        departmentName: s.assignment?.departmentName ?? null,
        positionName: s.assignment?.positionName ?? null,
        terminationDate: isoHr(d.terminationDate),
        lastWorkingDate: isoHr(d.lastWorkingDate),
        reason: d.terminationReasonCode,
        serviceLengthDays: days,
        serviceLengthYears: Math.round((days / 365.25) * 100) / 100,
      });
    }
    return out;
  }

  /** Transfer history report (spec 94). */
  async transfers(tenantId: string, membershipId: string, q: { from?: string; to?: string; organizationId?: string; employmentId?: string }) {
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const from = parseOptionalHrDate(q.from, 'from');
    const to = parseOptionalHrDate(q.to, 'to');
    const docs = await this.prisma.employeeTransfer.findMany({
      where: { tenantId, organizationId: { in: orgIds }, status: 'POSTED', ...(q.employmentId ? { employmentId: q.employmentId } : {}), ...(from || to ? { effectiveDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: { effectiveDate: 'asc' },
    });
    const out = [];
    for (const d of docs) {
      const before = await this.history.getEmploymentState(tenantId, d.employmentId, addDays(d.effectiveDate, -1));
      const after = await this.history.getEmploymentState(tenantId, d.employmentId, d.effectiveDate);
      out.push({
        number: d.number,
        employmentId: d.employmentId,
        employeeName: after.employeeName,
        effectiveDate: isoHr(d.effectiveDate),
        transferType: d.transferType,
        fromDepartment: before.assignment?.departmentName ?? null,
        toDepartment: after.assignment?.departmentName ?? null,
        fromPosition: before.assignment?.positionName ?? null,
        toPosition: after.assignment?.positionName ?? null,
        reason: d.reason,
      });
    }
    return out;
  }

  /** Contract expiry report (spec 95): fixed-term contracts ending within
   * `days` (default 60) or already expired while still active. */
  async contractExpiry(tenantId: string, membershipId: string, q: { organizationId?: string; days?: string }) {
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const today = todayHr();
    const horizon = addDays(today, Number(q.days ?? 60));
    const contracts = await this.prisma.employmentContract.findMany({
      where: { tenantId, organizationId: { in: orgIds }, status: 'ACTIVE', effectiveTo: { not: null, lte: horizon } },
      orderBy: { effectiveTo: 'asc' },
    });
    const out = [];
    for (const c of contracts) {
      const s = c.employmentId ? await this.history.getEmploymentState(tenantId, c.employmentId, today > c.effectiveTo! ? c.effectiveTo! : today) : null;
      const hire = c.employmentId ? await this.prisma.employment.findUnique({ where: { id: c.employmentId }, select: { hireDocumentId: true } }) : null;
      const hireDoc = hire?.hireDocumentId ? await this.prisma.hireDocument.findUnique({ where: { id: hire.hireDocumentId }, select: { responsibleHrUserId: true } }) : null;
      out.push({
        contractId: c.id,
        contractNumber: c.contractNumber,
        contractType: c.contractType,
        employmentId: c.employmentId,
        employeeName: s?.employeeName ?? null,
        endDate: isoHr(c.effectiveTo),
        daysRemaining: daysBetween(today, c.effectiveTo!),
        expired: c.effectiveTo! < today,
        managerName: s?.assignment?.managerName ?? null,
        hrResponsibleUserId: hireDoc?.responsibleHrUserId ?? null,
      });
    }
    return out;
  }

  /** Probation report (spec 96). */
  async probation(tenantId: string, membershipId: string, q: { organizationId?: string; days?: string }) {
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const today = todayHr();
    const horizon = addDays(today, Number(q.days ?? 90));
    const employments = await this.prisma.employment.findMany({
      where: { tenantId, organizationId: { in: orgIds }, status: 'ACTIVE', employmentEndDate: null, probationEndDate: { not: null, gte: today, lte: horizon } },
      orderBy: { probationEndDate: 'asc' },
    });
    const out = [];
    for (const e of employments) {
      const s = await this.history.getEmploymentState(tenantId, e.id, today < e.employmentStartDate ? e.employmentStartDate : today);
      out.push({ employmentId: e.id, employeeName: s.employeeName, personnelNumber: s.personnelNumber, probationEndDate: isoHr(e.probationEndDate), daysRemaining: daysBetween(today, e.probationEndDate!), managerName: s.assignment?.managerName ?? null, status: s.status });
    }
    return out;
  }

  /** Leave/absence foundation report (spec 97). */
  async leaveAbsence(tenantId: string, membershipId: string, q: { from?: string; to?: string; organizationId?: string }) {
    const orgIds = await this.orgIds(tenantId, membershipId, q.organizationId);
    const from = parseOptionalHrDate(q.from, 'from');
    const to = parseOptionalHrDate(q.to, 'to');
    const range = { ...(to ? { startDate: { lte: to } } : {}), ...(from ? { endDate: { gte: from } } : {}) };
    const [leaves, absences] = await Promise.all([
      this.prisma.leaveRecord.findMany({ where: { tenantId, organizationId: { in: orgIds }, ...range }, include: { employment: { include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } } } } }),
      this.prisma.absenceRecord.findMany({ where: { tenantId, organizationId: { in: orgIds }, ...range }, include: { employment: { include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } } } } }),
    ]);
    return [
      ...leaves.map((l) => ({ kind: 'LEAVE', id: l.id, employmentId: l.employmentId, employeeName: l.employment.employee.physicalPerson.fullName, type: l.leaveTypeCode, startDate: isoHr(l.startDate), endDate: isoHr(l.endDate), status: l.status })),
      ...absences.map((a) => ({ kind: 'ABSENCE', id: a.id, employmentId: a.employmentId, employeeName: a.employment.employee.physicalPerson.fullName, type: a.absenceTypeCode, startDate: isoHr(a.startDate), endDate: isoHr(a.endDate), status: a.status })),
    ].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  }

  /**
   * Import validation API (spec 86) — validates rows WITHOUT writing:
   * required fields, date formats, reference codes, duplicate persons
   * (hard + fuzzy) against the database and within the file itself.
   * Full CSV/Excel import is Phase 28.
   */
  async validateImport(tenantId: string, persons: PhysicalPersonService, rows: Record<string, any>[]) {
    const orgs = await this.prisma.organization.findMany({ where: { tenantId }, select: { id: true, code: true } });
    const orgByCode = new Map(orgs.map((o) => [o.code, o.id]));
    const positions = new Set((await this.prisma.hrPosition.findMany({ where: { tenantId, active: true }, select: { code: true } })).map((p) => p.code));
    const seen = new Map<string, number>();
    const results = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!r.firstName) errors.push('firstName is required');
      if (!r.lastName) errors.push('lastName is required');
      for (const f of ['birthDate', 'hireDate']) {
        if (r[f] && !/^\d{4}-\d{2}-\d{2}$/.test(String(r[f]))) errors.push(`${f} must be YYYY-MM-DD`);
      }
      if (r.fte !== undefined && !(Number(r.fte) > 0 && Number(r.fte) <= 1)) errors.push('fte must be in (0, 1]');
      let orgId: string | undefined;
      if (r.organizationCode) {
        orgId = orgByCode.get(r.organizationCode);
        if (!orgId) errors.push(`Unknown organizationCode ${r.organizationCode}`);
      }
      if (r.positionCode && !positions.has(r.positionCode)) errors.push(`Unknown or inactive positionCode ${r.positionCode}`);
      if (r.departmentCode && orgId) {
        const dep = await this.prisma.department.findFirst({ where: { organizationId: orgId, code: r.departmentCode } });
        if (!dep) errors.push(`Unknown departmentCode ${r.departmentCode}`);
        else if (!dep.active) errors.push(`Department ${r.departmentCode} is inactive`);
      }
      const matches = errors.some((e) => e.startsWith('birthDate'))
        ? []
        : await persons.findDuplicates(tenantId, { firstName: r.firstName, lastName: r.lastName, birthDate: r.birthDate, personalId: r.personalId, passportNumber: r.passportNumber, personalEmail: r.email, personalPhone: r.phone });
      for (const m of matches) (m.hard ? errors : warnings).push(`${m.hard ? 'Duplicate' : 'Possible duplicate'} of existing person ${m.fullName} (${m.signal})`);
      const keys = [r.personalId && `ID:${String(r.personalId).toUpperCase()}`, r.passportNumber && `PP:${String(r.passportNumber).toUpperCase()}`, r.firstName && r.lastName && r.birthDate && `NB:${String(r.firstName).toLowerCase()}|${String(r.lastName).toLowerCase()}|${r.birthDate}`].filter(Boolean) as string[];
      for (const k of keys) {
        if (seen.has(k)) (k.startsWith('NB') ? warnings : errors).push(`Duplicate of row ${seen.get(k)} in this file (${k.split(':')[0]})`);
        else seen.set(k, i + 1);
      }
      results.push({ row: i + 1, valid: errors.length === 0, errors, warnings });
    }
    return { total: results.length, valid: results.filter((r) => r.valid).length, invalid: results.filter((r) => !r.valid).length, rows: results };
  }
}
