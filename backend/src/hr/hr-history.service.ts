import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { ErrorCode, HrRuleError, NotFoundAppError } from '../common/errors/app-error';
import { EMPLOYED_STATUSES, EmploymentStatus, HrDocType } from './hr.constants';
import { addDays, fmtHr, isoHr, maxDate, minDate } from './hr-date.util';

export interface EmploymentStateAssignment {
  assignmentId: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  organizationId: string;
  departmentId: string;
  departmentName: string | null;
  branchId: string | null;
  positionId: string;
  positionName: string | null;
  staffingPositionId: string | null;
  staffingPositionCode: string | null;
  managerEmploymentId: string | null;
  managerName: string | null;
  location: string | null;
  fte: number;
  costCenter: string | null;
  project: string | null;
  eventType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
}

/**
 * The effective-dated state of one employment on one calendar day — the
 * stable data contract Phase 18 (work time), Phase 19 (payroll), Phase 20
 * (employee expenses) and Phase 22 (month close) consume. See
 * docs/PHASE17_HR_CORE.md "Downstream contract".
 */
export interface EmploymentState {
  employmentId: string;
  employeeId: string;
  personnelNumber: string;
  employeeName: string;
  organizationId: string;
  asOfDate: string;
  employmentType: string;
  primaryEmployment: boolean;
  employmentStartDate: string;
  employmentEndDate: string | null;
  status: EmploymentStatus;
  /** true for ACTIVE / ON_LEAVE / SUSPENDED — employed on that date. */
  isEmployed: boolean;
  assignment: EmploymentStateAssignment | null;
  secondaryAssignments: EmploymentStateAssignment[];
  workSchedule: { assignmentId: string; workScheduleId: string; code: string | null; name: string | null; effectiveFrom: string | null; effectiveTo: string | null } | null;
  contract: { contractId: string; contractNumber: string; versionNumber: number; effectiveFrom: string | null; effectiveTo: string | null; terms: Record<string, unknown> } | null;
  leave: { id: string; leaveTypeCode: string; startDate: string | null; endDate: string | null }[];
  absences: { id: string; absenceTypeCode: string; startDate: string | null; endDate: string | null; hours: number | null }[];
  businessTrips: { id: string; destination: string; startDate: string | null; endDate: string | null }[];
}

export interface EmploymentSegment {
  from: string;
  to: string;
  days: number;
  status: EmploymentStatus;
  isEmployed: boolean;
  departmentId: string | null;
  positionId: string | null;
  staffingPositionId: string | null;
  managerEmploymentId: string | null;
  fte: number | null;
  costCenter: string | null;
  workScheduleId: string | null;
  contractId: string | null;
  contractVersionNumber: number | null;
}

type Db = PrismaTransactionClient;
const ACTIVE = { recordStatus: 'ACTIVE' };
const coveringWhere = (d: Date) => ({ effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] });
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v.toString()));

/**
 * HRHistoryService / as-of-date query engine (spec 50/51/113). Every answer
 * is computed from the authoritative effective-dated histories — never from
 * the projection columns on Employment (spec 23/52). This service is the
 * INTERNAL API other modules must use (exported from HrModule).
 */
@Injectable()
export class HrHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ status

  /** Status of an employment on `asOf`, derived from status history (spec
   * 10: "status history-dən derive edilməlidir") + approved-leave overlay. */
  async statusAt(
    employment: { id: string; status: string; employmentStartDate: Date; employmentEndDate: Date | null },
    asOf: Date,
    db: Db = this.prisma,
  ): Promise<EmploymentStatus> {
    if (employment.status === 'CANCELLED') return 'CANCELLED';
    if (asOf < employment.employmentStartDate) return 'PLANNED';
    if (employment.employmentEndDate && asOf > employment.employmentEndDate) return 'TERMINATED';
    const row = await db.employmentStatusHistory.findFirst({
      where: { employmentId: employment.id, ...ACTIVE, ...coveringWhere(asOf) },
      orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
    });
    const base = (row?.status ?? 'ACTIVE') as EmploymentStatus;
    if (base === 'ACTIVE') {
      const onLeave = await db.leaveRecord.findFirst({ where: { employmentId: employment.id, status: 'APPROVED', startDate: { lte: asOf }, endDate: { gte: asOf } } });
      if (onLeave) return 'ON_LEAVE';
    }
    return base;
  }

  // ------------------------------------------------------------------ state

  async getEmploymentState(tenantId: string, employmentId: string, asOf: Date, db: Db = this.prisma): Promise<EmploymentState> {
    const emp = await db.employment.findFirst({
      where: { id: employmentId, tenantId },
      include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } },
    });
    if (!emp) throw new NotFoundAppError('Employment', employmentId);

    const status = await this.statusAt(emp, asOf, db);
    const [assignmentRows, scheduleRow, contract, leave, absences, trips] = await Promise.all([
      db.employeeAssignment.findMany({ where: { employmentId, ...ACTIVE, ...coveringWhere(asOf) }, orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }] }),
      db.workScheduleAssignment.findFirst({ where: { employmentId, ...ACTIVE, ...coveringWhere(asOf) }, orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }] }),
      db.employmentContract.findFirst({ where: { employmentId, status: { not: 'CANCELLED' }, effectiveFrom: { lte: asOf } }, orderBy: { effectiveFrom: 'desc' } }),
      db.leaveRecord.findMany({ where: { employmentId, status: 'APPROVED', startDate: { lte: asOf }, endDate: { gte: asOf } } }),
      db.absenceRecord.findMany({ where: { employmentId, status: { not: 'CANCELLED' }, startDate: { lte: asOf }, endDate: { gte: asOf } } }),
      db.businessTrip.findMany({ where: { employmentId, status: { in: ['PLANNED', 'APPROVED', 'COMPLETED'] }, startDate: { lte: asOf }, endDate: { gte: asOf } } }),
    ]);

    const primary = assignmentRows.find((a) => !a.isSecondary) ?? null;
    const resolved = await this.resolveAssignments(db, assignmentRows);
    let schedule: EmploymentState['workSchedule'] = null;
    if (scheduleRow) {
      const ws = await db.hrWorkSchedule.findUnique({ where: { id: scheduleRow.workScheduleId } });
      schedule = { assignmentId: scheduleRow.id, workScheduleId: scheduleRow.workScheduleId, code: ws?.code ?? null, name: ws?.name ?? null, effectiveFrom: isoHr(scheduleRow.effectiveFrom), effectiveTo: isoHr(scheduleRow.effectiveTo) };
    }
    let contractState: EmploymentState['contract'] = null;
    if (contract) {
      const version = await db.employmentContractVersion.findFirst({
        where: { contractId: contract.id, ...coveringWhere(asOf) },
        orderBy: { versionNumber: 'desc' },
      });
      if (version) {
        contractState = { contractId: contract.id, contractNumber: contract.contractNumber, versionNumber: version.versionNumber, effectiveFrom: isoHr(version.effectiveFrom), effectiveTo: isoHr(version.effectiveTo), terms: version.terms as Record<string, unknown> };
      }
    }

    return {
      employmentId: emp.id,
      employeeId: emp.employeeId,
      personnelNumber: emp.employee.personnelNumber,
      employeeName: emp.employee.physicalPerson.fullName,
      organizationId: emp.organizationId,
      asOfDate: isoHr(asOf)!,
      employmentType: emp.employmentType,
      primaryEmployment: emp.primaryEmployment,
      employmentStartDate: isoHr(emp.employmentStartDate)!,
      employmentEndDate: isoHr(emp.employmentEndDate),
      status,
      isEmployed: EMPLOYED_STATUSES.includes(status),
      assignment: primary ? resolved.get(primary.id)! : null,
      secondaryAssignments: assignmentRows.filter((a) => a.isSecondary).map((a) => resolved.get(a.id)!),
      workSchedule: schedule,
      contract: contractState,
      leave: leave.map((l) => ({ id: l.id, leaveTypeCode: l.leaveTypeCode, startDate: isoHr(l.startDate), endDate: isoHr(l.endDate) })),
      absences: absences.map((a) => ({ id: a.id, absenceTypeCode: a.absenceTypeCode, startDate: isoHr(a.startDate), endDate: isoHr(a.endDate), hours: num(a.hours) })),
      businessTrips: trips.map((t) => ({ id: t.id, destination: t.destination, startDate: isoHr(t.startDate), endDate: isoHr(t.endDate) })),
    };
  }

  private async resolveAssignments(db: Db, rows: any[]): Promise<Map<string, EmploymentStateAssignment>> {
    const out = new Map<string, EmploymentStateAssignment>();
    if (!rows.length) return out;
    const [departments, positions, staffing, managers] = await Promise.all([
      db.department.findMany({ where: { id: { in: rows.map((r) => r.departmentId) } }, select: { id: true, name: true } }),
      db.hrPosition.findMany({ where: { id: { in: rows.map((r) => r.positionId) } }, select: { id: true, name: true } }),
      db.staffingPosition.findMany({ where: { id: { in: rows.map((r) => r.staffingPositionId).filter(Boolean) } }, select: { id: true, code: true } }),
      db.employment.findMany({
        where: { id: { in: rows.map((r) => r.managerEmploymentId).filter(Boolean) } },
        select: { id: true, employee: { select: { physicalPerson: { select: { fullName: true } } } } },
      }),
    ]);
    const dn = new Map(departments.map((d) => [d.id, d.name]));
    const pn = new Map(positions.map((p) => [p.id, p.name]));
    const sc = new Map(staffing.map((s) => [s.id, s.code]));
    const mn = new Map(managers.map((m) => [m.id, m.employee.physicalPerson.fullName]));
    for (const r of rows) {
      out.set(r.id, {
        assignmentId: r.id,
        effectiveFrom: isoHr(r.effectiveFrom),
        effectiveTo: isoHr(r.effectiveTo),
        organizationId: r.organizationId,
        departmentId: r.departmentId,
        departmentName: dn.get(r.departmentId) ?? null,
        branchId: r.branchId,
        positionId: r.positionId,
        positionName: pn.get(r.positionId) ?? null,
        staffingPositionId: r.staffingPositionId,
        staffingPositionCode: r.staffingPositionId ? sc.get(r.staffingPositionId) ?? null : null,
        managerEmploymentId: r.managerEmploymentId,
        managerName: r.managerEmploymentId ? mn.get(r.managerEmploymentId) ?? null : null,
        location: r.location,
        fte: Number(r.fte.toString()),
        costCenter: r.costCenter,
        project: r.project,
        eventType: r.eventType,
        sourceDocumentType: r.sourceDocumentType,
        sourceDocumentId: r.sourceDocumentId,
      });
    }
    return out;
  }

  // ----------------------------------------------------- internal API (spec 113)

  async getActiveEmployments(tenantId: string, employeeId: string, asOf: Date) {
    const employments = await this.prisma.employment.findMany({
      where: { tenantId, employeeId, status: 'ACTIVE', employmentStartDate: { lte: asOf }, OR: [{ employmentEndDate: null }, { employmentEndDate: { gte: asOf } }] },
    });
    const states = await Promise.all(employments.map((e) => this.getEmploymentState(tenantId, e.id, asOf)));
    return states.filter((s) => s.isEmployed);
  }

  async getDepartment(tenantId: string, employmentId: string, asOf: Date) {
    const s = await this.getEmploymentState(tenantId, employmentId, asOf);
    return s.assignment ? { departmentId: s.assignment.departmentId, departmentName: s.assignment.departmentName } : null;
  }

  async getPosition(tenantId: string, employmentId: string, asOf: Date) {
    const s = await this.getEmploymentState(tenantId, employmentId, asOf);
    return s.assignment ? { positionId: s.assignment.positionId, positionName: s.assignment.positionName, staffingPositionId: s.assignment.staffingPositionId } : null;
  }

  async getManager(tenantId: string, employmentId: string, asOf: Date) {
    const s = await this.getEmploymentState(tenantId, employmentId, asOf);
    return s.assignment?.managerEmploymentId ? { managerEmploymentId: s.assignment.managerEmploymentId, managerName: s.assignment.managerName } : null;
  }

  async getWorkSchedule(tenantId: string, employmentId: string, asOf: Date) {
    return (await this.getEmploymentState(tenantId, employmentId, asOf)).workSchedule;
  }

  async getFTE(tenantId: string, employmentId: string, asOf: Date) {
    return (await this.getEmploymentState(tenantId, employmentId, asOf)).assignment?.fte ?? null;
  }

  /** Throws HR_EMPLOYMENT_NOT_ACTIVE unless the employment is employed
   * (ACTIVE / ON_LEAVE / SUSPENDED — or strictly ACTIVE) on `asOf`. */
  async validateEmploymentActive(tenantId: string, employmentId: string, asOf: Date, opts: { strict?: boolean } = {}, db: Db = this.prisma) {
    const state = await this.getEmploymentState(tenantId, employmentId, asOf, db);
    const ok = opts.strict ? state.status === 'ACTIVE' : state.isEmployed;
    if (!ok) {
      throw new HrRuleError(
        ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE,
        `Employment of ${state.employeeName} is ${state.status} on ${fmtHr(asOf)} (employment period ${fmtHr(new Date(state.employmentStartDate))} – ${state.employmentEndDate ? fmtHr(new Date(state.employmentEndDate)) : 'open'})`,
      );
    }
    return state;
  }

  /**
   * Splits [from, to] into maximal segments of constant HR state — the
   * payroll/time contract (spec 115: "as-of-payroll-period state"). A
   * mid-month transfer, FTE change, schedule change, suspension, leave,
   * hire or termination each start a new segment.
   */
  async getEffectiveSegments(tenantId: string, employmentId: string, from: Date, to: Date): Promise<EmploymentSegment[]> {
    const emp = await this.prisma.employment.findFirst({ where: { id: employmentId, tenantId } });
    if (!emp) throw new NotFoundAppError('Employment', employmentId);
    const boundaries = new Set<number>([from.getTime()]);
    const add = (d: Date | null | undefined, plusOne = false) => {
      if (!d) return;
      const x = plusOne ? addDays(d, 1) : d;
      if (x > from && x <= to) boundaries.add(x.getTime());
    };
    add(emp.employmentStartDate);
    add(emp.employmentEndDate, true);
    const [assignments, schedules, statuses, leaves, contracts] = await Promise.all([
      this.prisma.employeeAssignment.findMany({ where: { employmentId, ...ACTIVE } }),
      this.prisma.workScheduleAssignment.findMany({ where: { employmentId, ...ACTIVE } }),
      this.prisma.employmentStatusHistory.findMany({ where: { employmentId, ...ACTIVE } }),
      this.prisma.leaveRecord.findMany({ where: { employmentId, status: 'APPROVED' } }),
      this.prisma.employmentContractVersion.findMany({ where: { contract: { employmentId } } }),
    ]);
    for (const r of [...assignments, ...schedules, ...statuses, ...contracts]) {
      add(r.effectiveFrom);
      add(r.effectiveTo, true);
    }
    for (const l of leaves) {
      add(l.startDate);
      add(l.endDate, true);
    }
    const starts = [...boundaries].sort((a, b) => a - b).map((t) => new Date(t));
    const segments: EmploymentSegment[] = [];
    for (let i = 0; i < starts.length; i++) {
      const segFrom = starts[i];
      const segTo = i + 1 < starts.length ? addDays(starts[i + 1], -1) : to;
      const s = await this.getEmploymentState(tenantId, employmentId, segFrom);
      segments.push({
        from: isoHr(segFrom)!,
        to: isoHr(segTo)!,
        days: Math.round((segTo.getTime() - segFrom.getTime()) / 86400000) + 1,
        status: s.status,
        isEmployed: s.isEmployed,
        departmentId: s.assignment?.departmentId ?? null,
        positionId: s.assignment?.positionId ?? null,
        staffingPositionId: s.assignment?.staffingPositionId ?? null,
        managerEmploymentId: s.assignment?.managerEmploymentId ?? null,
        fte: s.assignment?.fte ?? null,
        costCenter: s.assignment?.costCenter ?? null,
        workScheduleId: s.workSchedule?.workScheduleId ?? null,
        contractId: s.contract?.contractId ?? null,
        contractVersionNumber: s.contract?.versionNumber ?? null,
      });
    }
    return segments;
  }

  /** Employments overlapping [from, to] (optionally per organization) with
   * their effective segments — the Phase 19 payroll population and the
   * Phase 22 month-close HR checklist input (spec 115/118). */
  async getEmploymentsInPeriod(tenantId: string, filter: { organizationId?: string; organizationIds?: string[]; from: Date; to: Date }) {
    const employments = await this.prisma.employment.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        ...(filter.organizationId ? { organizationId: filter.organizationId } : filter.organizationIds ? { organizationId: { in: filter.organizationIds } } : {}),
        employmentStartDate: { lte: filter.to },
        OR: [{ employmentEndDate: null }, { employmentEndDate: { gte: filter.from } }],
      },
      include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } },
      orderBy: { employmentStartDate: 'asc' },
    });
    const out = [];
    for (const e of employments) {
      const from = maxDate(filter.from, e.employmentStartDate);
      const to = e.employmentEndDate ? minDate(filter.to, e.employmentEndDate) : filter.to;
      out.push({
        employmentId: e.id,
        employeeId: e.employeeId,
        personnelNumber: e.employee.personnelNumber,
        employeeName: e.employee.physicalPerson.fullName,
        organizationId: e.organizationId,
        employmentType: e.employmentType,
        primaryEmployment: e.primaryEmployment,
        employmentStartDate: isoHr(e.employmentStartDate),
        employmentEndDate: isoHr(e.employmentEndDate),
        hiredInPeriod: e.employmentStartDate >= filter.from && e.employmentStartDate <= filter.to,
        terminatedInPeriod: !!e.employmentEndDate && e.employmentEndDate >= filter.from && e.employmentEndDate <= filter.to,
        segments: await this.getEffectiveSegments(tenantId, e.id, from, to),
      });
    }
    return out;
  }

  // ------------------------------------------------------ bulk (reports)

  /**
   * Set-based as-of snapshot of every employed employment (optionally for
   * some organizations) — used by headcount, org chart, staffing occupancy
   * and the employee list. Computed from the assignment register (spec 52).
   */
  async snapshot(tenantId: string, asOf: Date, filter: { organizationIds?: string[] } = {}, db: Db = this.prisma) {
    const assignments = await db.employeeAssignment.findMany({
      where: {
        tenantId,
        ...ACTIVE,
        isSecondary: false,
        ...coveringWhere(asOf),
        ...(filter.organizationIds ? { organizationId: { in: filter.organizationIds } } : {}),
        employment: { status: 'ACTIVE', employmentStartDate: { lte: asOf }, OR: [{ employmentEndDate: null }, { employmentEndDate: { gte: asOf } }] },
      },
      include: {
        employment: { include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } } },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
    });
    const seen = new Set<string>();
    const unique = assignments.filter((a) => (seen.has(a.employmentId) ? false : (seen.add(a.employmentId), true)));
    const ids = unique.map((a) => a.employmentId);
    const [statusRows, leaves, schedules] = await Promise.all([
      db.employmentStatusHistory.findMany({ where: { employmentId: { in: ids }, ...ACTIVE, ...coveringWhere(asOf) }, orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }] }),
      db.leaveRecord.findMany({ where: { employmentId: { in: ids }, status: 'APPROVED', startDate: { lte: asOf }, endDate: { gte: asOf } } }),
      db.workScheduleAssignment.findMany({ where: { employmentId: { in: ids }, ...ACTIVE, ...coveringWhere(asOf) }, orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }] }),
    ]);
    const statusBy = new Map<string, string>();
    for (const r of statusRows) if (!statusBy.has(r.employmentId)) statusBy.set(r.employmentId, r.status);
    const onLeave = new Set(leaves.map((l) => l.employmentId));
    const scheduleBy = new Map<string, string>();
    for (const s of schedules) if (!scheduleBy.has(s.employmentId)) scheduleBy.set(s.employmentId, s.workScheduleId);
    const resolved = await this.resolveAssignments(db, unique);
    return unique
      .map((a) => {
        let status = (statusBy.get(a.employmentId) ?? 'ACTIVE') as EmploymentStatus;
        if (status === 'ACTIVE' && onLeave.has(a.employmentId)) status = 'ON_LEAVE';
        return {
          employmentId: a.employmentId,
          employeeId: a.employment.employeeId,
          personnelNumber: a.employment.employee.personnelNumber,
          employeeName: a.employment.employee.physicalPerson.fullName,
          organizationId: a.organizationId,
          employmentType: a.employment.employmentType,
          primaryEmployment: a.employment.primaryEmployment,
          employmentStartDate: isoHr(a.employment.employmentStartDate),
          employmentEndDate: isoHr(a.employment.employmentEndDate),
          probationEndDate: isoHr(a.employment.probationEndDate),
          status,
          workScheduleId: scheduleBy.get(a.employmentId) ?? null,
          ...resolved.get(a.id)!,
        };
      })
      .filter((s) => EMPLOYED_STATUSES.includes(s.status));
  }

  // ------------------------------------------------------ history / timeline

  async getHistory(tenantId: string, employmentId: string) {
    const emp = await this.prisma.employment.findFirst({ where: { id: employmentId, tenantId } });
    if (!emp) throw new NotFoundAppError('Employment', employmentId);
    const order = [{ effectiveFrom: 'asc' as const }, { sequence: 'asc' as const }];
    const [assignments, schedules, statuses, contracts, leaves, absences, trips, events] = await Promise.all([
      this.prisma.employeeAssignment.findMany({ where: { employmentId }, orderBy: order }),
      this.prisma.workScheduleAssignment.findMany({ where: { employmentId }, orderBy: order }),
      this.prisma.employmentStatusHistory.findMany({ where: { employmentId }, orderBy: order }),
      this.prisma.employmentContract.findMany({ where: { employmentId }, include: { versions: { orderBy: { versionNumber: 'asc' } } } }),
      this.prisma.leaveRecord.findMany({ where: { employmentId }, orderBy: { startDate: 'asc' } }),
      this.prisma.absenceRecord.findMany({ where: { employmentId }, orderBy: { startDate: 'asc' } }),
      this.prisma.businessTrip.findMany({ where: { employmentId }, orderBy: { startDate: 'asc' } }),
      this.prisma.hrEvent.findMany({ where: { tenantId, employmentId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { employment: emp, assignments, schedules, statuses, contracts, leaves, absences, businessTrips: trips, events, timeline: await this.getTimeline(tenantId, { employmentId }) };
  }

  /** Unified employment-event projection (spec 42/106) with drill-down to
   * the source document of each event. */
  async getTimeline(tenantId: string, filter: { employmentId?: string; employeeId?: string }) {
    const employments = await this.prisma.employment.findMany({
      where: { tenantId, ...(filter.employmentId ? { id: filter.employmentId } : {}), ...(filter.employeeId ? { employeeId: filter.employeeId } : {}) },
      select: { id: true, organizationId: true, rehireOfEmploymentId: true },
    });
    const ids = employments.map((e) => e.id);
    const order = [{ effectiveFrom: 'asc' as const }, { sequence: 'asc' as const }];
    const [assignments, schedules, statuses, leaves] = await Promise.all([
      this.prisma.employeeAssignment.findMany({ where: { employmentId: { in: ids }, ...ACTIVE }, orderBy: order }),
      this.prisma.workScheduleAssignment.findMany({ where: { employmentId: { in: ids }, ...ACTIVE }, orderBy: order }),
      this.prisma.employmentStatusHistory.findMany({ where: { employmentId: { in: ids }, ...ACTIVE }, orderBy: order }),
      this.prisma.leaveRecord.findMany({ where: { employmentId: { in: ids }, status: 'APPROVED' } }),
    ]);
    type Ev = { date: string; sort: number; eventType: string; employmentId: string; description: string; sourceDocumentType: string | null; sourceDocumentId: string | null; sourceDocumentNumber?: string | null };
    const out: Ev[] = [];
    const push = (d: Date, eventType: string, employmentId: string, description: string, sourceDocumentType: string | null, sourceDocumentId: string | null, sort = 0) =>
      out.push({ date: isoHr(d)!, sort: d.getTime() * 10 + sort, eventType, employmentId, description, sourceDocumentType, sourceDocumentId });

    const byEmp = new Map<string, any[]>();
    for (const a of assignments) byEmp.set(a.employmentId, [...(byEmp.get(a.employmentId) ?? []), a]);
    const resolved = await this.resolveAssignments(this.prisma, assignments);
    for (const [, rows] of byEmp) {
      let prev: EmploymentStateAssignment | null = null;
      for (const r of rows) {
        const cur = resolved.get(r.id)!;
        if (r.eventType === 'HIRE' || r.eventType === 'REHIRE') {
          push(r.effectiveFrom, r.eventType, r.employmentId, `${cur.departmentName ?? ''} / ${cur.positionName ?? ''} / FTE ${cur.fte}`, r.sourceDocumentType, r.sourceDocumentId, 1);
        } else if (!r.isSecondary) {
          const changes: string[] = [];
          if (prev && prev.departmentId !== cur.departmentId) changes.push(`${prev.departmentName} → ${cur.departmentName}`);
          if (prev && prev.positionId !== cur.positionId) changes.push(`${prev.positionName} → ${cur.positionName}`);
          if (prev && prev.managerEmploymentId !== cur.managerEmploymentId) changes.push(`manager ${prev.managerName ?? '—'} → ${cur.managerName ?? '—'}`);
          if (prev && prev.fte !== cur.fte) changes.push(`FTE ${prev.fte} → ${cur.fte}`);
          push(r.effectiveFrom, r.eventType, r.employmentId, changes.join('; ') || r.eventType, r.sourceDocumentType, r.sourceDocumentId, 2);
        }
        if (!r.isSecondary) prev = cur;
      }
    }
    const scheduleNames = new Map(
      (await this.prisma.hrWorkSchedule.findMany({ where: { id: { in: schedules.map((s) => s.workScheduleId) } } })).map((w) => [w.id, w.name]),
    );
    const firstSchedule = new Set<string>();
    for (const s of schedules) {
      if (!firstSchedule.has(s.employmentId)) {
        firstSchedule.add(s.employmentId);
        continue;
      }
      push(s.effectiveFrom, 'SCHEDULE_CHANGE', s.employmentId, scheduleNames.get(s.workScheduleId) ?? s.workScheduleId, s.sourceDocumentType, s.sourceDocumentId, 3);
    }
    let lastStatus = new Map<string, string>();
    for (const s of statuses) {
      const before = lastStatus.get(s.employmentId);
      if (s.status === 'SUSPENDED') push(s.effectiveFrom, 'SUSPENSION', s.employmentId, s.reason ?? '', s.sourceDocumentType, s.sourceDocumentId, 4);
      else if (s.status === 'ACTIVE' && before === 'SUSPENDED') push(s.effectiveFrom, 'RETURN_TO_WORK', s.employmentId, s.reason ?? '', s.sourceDocumentType, s.sourceDocumentId, 4);
      else if (s.status === 'TERMINATED') push(addDays(s.effectiveFrom, -1), 'TERMINATION', s.employmentId, s.reason ?? '', s.sourceDocumentType, s.sourceDocumentId, 9);
      lastStatus.set(s.employmentId, s.status);
    }
    lastStatus = new Map();
    for (const l of leaves) {
      push(l.startDate, 'LEAVE_START', l.employmentId, l.leaveTypeCode, HrDocType.LEAVE, l.id, 5);
      push(addDays(l.endDate, 1), 'LEAVE_END', l.employmentId, l.leaveTypeCode, HrDocType.LEAVE, l.id, 5);
    }
    out.sort((a, b) => a.sort - b.sort);

    // Drill-down: attach source document numbers.
    const docIds = (type: string) => out.filter((e) => e.sourceDocumentType === type).map((e) => e.sourceDocumentId!);
    const [hires, transfers, terminations] = await Promise.all([
      this.prisma.hireDocument.findMany({ where: { id: { in: [...docIds(HrDocType.HIRE), ...docIds(HrDocType.REHIRE)] } }, select: { id: true, number: true } }),
      this.prisma.employeeTransfer.findMany({ where: { id: { in: docIds(HrDocType.TRANSFER) } }, select: { id: true, number: true } }),
      this.prisma.terminationDocument.findMany({ where: { id: { in: docIds(HrDocType.TERMINATION) } }, select: { id: true, number: true } }),
    ]);
    const numbers = new Map([...hires, ...transfers, ...terminations].map((d) => [d.id, d.number]));
    return out.map(({ sort, ...e }) => ({ ...e, sourceDocumentNumber: e.sourceDocumentId ? numbers.get(e.sourceDocumentId) ?? null : null }));
  }
}
