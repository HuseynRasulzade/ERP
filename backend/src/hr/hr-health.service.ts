import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fmtHr, isoHr, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrHistoryService } from './hr-history.service';
import { HrPolicyService } from './hr-policy.service';
import { HrValidationService } from './hr-validation.service';
import { EmploymentService } from './employment.service';

export type HrHealthSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';

export interface HrHealthIssue {
  check: string;
  severity: HrHealthSeverity;
  entityType: string;
  entityId: string;
  message: string;
}

const covering = (d: Date) => ({ effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] });

/**
 * HRHealthService (spec 98/99) — data-quality checks over the HR registers,
 * computed on demand as of a date (default today). Each finding carries a
 * severity (INFO/WARNING/ERROR/BLOCKING) and the entity to drill into.
 */
@Injectable()
export class HrHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: HrHistoryService,
    private readonly policy: HrPolicyService,
    private readonly validation: HrValidationService,
    private readonly employments: EmploymentService,
  ) {}

  async run(tenantId: string, membershipId: string, q: { asOf?: string; organizationId?: string }) {
    const asOf = parseOptionalHrDate(q.asOf, 'asOf') ?? todayHr();
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, q.organizationId);
    const policy = await this.policy.getPolicy(tenantId);
    const issues: HrHealthIssue[] = [];
    const add = (check: string, severity: HrHealthSeverity, entityType: string, entityId: string, message: string) => issues.push({ check, severity, entityType, entityId, message });

    const active = await this.prisma.employment.findMany({
      where: { tenantId, organizationId: { in: orgIds }, status: 'ACTIVE', employmentStartDate: { lte: asOf }, OR: [{ employmentEndDate: null }, { employmentEndDate: { gte: asOf } }] },
      include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } },
    });
    const name = (e: (typeof active)[number]) => `${e.employee.physicalPerson.fullName} (${e.employee.personnelNumber})`;

    for (const e of active) {
      const [contract, assignments, schedule] = await Promise.all([
        this.prisma.employmentContract.findFirst({ where: { employmentId: e.id, status: 'ACTIVE' } }),
        this.prisma.employeeAssignment.findMany({ where: { employmentId: e.id, recordStatus: 'ACTIVE', isSecondary: false, ...covering(asOf) } }),
        this.prisma.workScheduleAssignment.findFirst({ where: { employmentId: e.id, recordStatus: 'ACTIVE', ...covering(asOf) } }),
      ]);
      if (!contract) add('ACTIVE_EMPLOYMENT_WITHOUT_CONTRACT', 'ERROR', 'EMPLOYMENT', e.id, `${name(e)} has an active employment without an active contract`);
      else if (contract.effectiveTo && contract.effectiveTo < asOf) add('EXPIRED_FIXED_TERM_CONTRACT_STILL_ACTIVE', 'ERROR', 'CONTRACT', contract.id, `Contract ${contract.contractNumber} of ${name(e)} expired ${fmtHr(contract.effectiveTo)} but the employment is still active`);
      if (!assignments.length) add('ACTIVE_EMPLOYMENT_WITHOUT_ASSIGNMENT', 'BLOCKING', 'EMPLOYMENT', e.id, `${name(e)} has no assignment on ${fmtHr(asOf)}`);
      if (assignments.length > 1) add('OVERLAPPING_ASSIGNMENTS', 'BLOCKING', 'EMPLOYMENT', e.id, `${name(e)} has ${assignments.length} overlapping primary assignments on ${fmtHr(asOf)}`);
      if (!schedule) add('ACTIVE_EMPLOYMENT_WITHOUT_SCHEDULE', 'WARNING', 'EMPLOYMENT', e.id, `${name(e)} has no work schedule on ${fmtHr(asOf)}`);
      const a = assignments[0];
      if (a) {
        if (policy.requireManager && !a.managerEmploymentId) add('MISSING_MANAGER', 'WARNING', 'EMPLOYMENT', e.id, `${name(e)} has no manager`);
        const dep = await this.prisma.department.findUnique({ where: { id: a.departmentId }, select: { active: true, code: true } });
        if (dep && !dep.active) add('EMPLOYEE_IN_INACTIVE_DEPARTMENT', 'WARNING', 'EMPLOYMENT', e.id, `${name(e)} is assigned to inactive department ${dep.code}`);
        if (a.staffingPositionId) {
          const sp = await this.prisma.staffingPosition.findUnique({ where: { id: a.staffingPositionId } });
          if (sp && (sp.status !== 'ACTIVE' || (sp.activeTo && sp.activeTo < asOf))) add('INACTIVE_STAFFING_POSITION_OCCUPIED', 'WARNING', 'STAFFING_POSITION', sp.id, `Inactive staffing position ${sp.code} is occupied by ${name(e)}`);
        }
      }
    }

    // Primary employments overlapping for one employee.
    const byEmployee = new Map<string, typeof active>();
    for (const e of active.filter((x) => x.primaryEmployment)) byEmployee.set(e.employeeId, [...(byEmployee.get(e.employeeId) ?? []), e]);
    for (const [employeeId, list] of byEmployee) {
      const scoped = policy.primaryEmploymentScope === 'TENANT' ? [list] : [...new Set(list.map((l) => l.organizationId))].map((o) => list.filter((l) => l.organizationId === o));
      for (const group of scoped) if (group.length > 1) add('OVERLAPPING_PRIMARY_EMPLOYMENTS', 'ERROR', 'EMPLOYEE', employeeId, `${name(group[0])} has ${group.length} active primary employments`);
    }

    // Staffing capacity exceeded.
    const positions = await this.prisma.staffingPosition.findMany({ where: { tenantId, organizationId: { in: orgIds }, status: 'ACTIVE', activeFrom: { lte: asOf }, OR: [{ activeTo: null }, { activeTo: { gte: asOf } }], staffingTable: { status: 'ACTIVE' } } });
    const seenCodes = new Set<string>();
    for (const p of positions) {
      const key = `${p.organizationId}:${p.code}`;
      if (seenCodes.has(key)) continue;
      seenCodes.add(key);
      const occ = await this.validation.occupancy(this.prisma, tenantId, p.organizationId, p.code, asOf);
      if (occ.fte > Number(p.fteLimit.toString()) + 1e-9 || occ.headcount > p.headcountLimit) {
        add('STAFFING_CAPACITY_EXCEEDED', 'ERROR', 'STAFFING_POSITION', p.id, `Staffing position ${p.code}: occupied ${occ.headcount} / ${occ.fte} FTE exceeds limit ${p.headcountLimit} / ${p.fteLimit.toString()} FTE`);
      }
    }

    // Terminated employments: remaining schedule / later changes.
    const terminated = await this.prisma.employment.findMany({ where: { tenantId, organizationId: { in: orgIds }, status: 'ACTIVE', employmentEndDate: { not: null } } });
    for (const e of terminated) {
      const openSchedule = await this.prisma.workScheduleAssignment.findFirst({ where: { employmentId: e.id, recordStatus: 'ACTIVE', OR: [{ effectiveTo: null }, { effectiveTo: { gt: e.employmentEndDate! } }] } });
      if (openSchedule) add('TERMINATED_WITH_ACTIVE_SCHEDULE', 'ERROR', 'EMPLOYMENT', e.id, `Employment terminated ${fmtHr(e.employmentEndDate)} still has a schedule assignment beyond that date`);
      const later = await this.prisma.employeeAssignment.findFirst({ where: { employmentId: e.id, recordStatus: 'ACTIVE', OR: [{ effectiveFrom: { gt: e.employmentEndDate! } }, { effectiveTo: null }, { effectiveTo: { gt: e.employmentEndDate! } }] } });
      if (later) add('FUTURE_TERMINATION_CONFLICT', 'ERROR', 'EMPLOYMENT', e.id, `Employment terminated ${fmtHr(e.employmentEndDate)} has assignment history beyond the termination date`);
    }
    const pendingTerminations = await this.prisma.terminationDocument.findMany({ where: { tenantId, organizationId: { in: orgIds }, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } });
    for (const t of pendingTerminations) {
      const later = await this.prisma.employeeAssignment.findFirst({ where: { employmentId: t.employmentId, recordStatus: 'ACTIVE', effectiveFrom: { gt: t.terminationDate } } });
      if (later) add('FUTURE_TERMINATION_CONFLICT', 'WARNING', 'TERMINATION', t.id, `Termination ${t.number} (${fmtHr(t.terminationDate)}) conflicts with a change effective ${fmtHr(later.effectiveFrom)}`);
    }

    // Circular manager hierarchy as of date.
    const snap = await this.history.snapshot(tenantId, asOf, { organizationIds: orgIds });
    const managerOf = new Map(snap.map((s) => [s.employmentId, s.managerEmploymentId]));
    const reported = new Set<string>();
    for (const s of snap) {
      const path = new Set<string>([s.employmentId]);
      let cur = managerOf.get(s.employmentId);
      while (cur) {
        if (path.has(cur)) {
          if (!reported.has(cur)) {
            reported.add(cur);
            add('CIRCULAR_MANAGER_HIERARCHY', 'BLOCKING', 'EMPLOYMENT', cur, `Circular reporting line detected involving ${s.employeeName}`);
          }
          break;
        }
        path.add(cur);
        cur = managerOf.get(cur) ?? null;
      }
    }

    // Duplicate physical persons (same name + birth date).
    const dups = await this.prisma.$queryRawUnsafe<{ first_name: string; last_name: string; birth_date: Date; cnt: bigint; ids: string[] }[]>(
      `SELECT lower(first_name) AS first_name, lower(last_name) AS last_name, birth_date, COUNT(*) AS cnt, array_agg(id) AS ids
       FROM physical_persons WHERE tenant_id = $1 AND birth_date IS NOT NULL AND active
       GROUP BY lower(first_name), lower(last_name), birth_date HAVING COUNT(*) > 1`,
      tenantId,
    );
    for (const d of dups) add('DUPLICATE_PHYSICAL_PERSONS', 'WARNING', 'PHYSICAL_PERSON', d.ids[0], `${Number(d.cnt)} physical persons share name ${d.first_name} ${d.last_name} and birth date ${isoHr(d.birth_date)}`);

    const summary = { INFO: 0, WARNING: 0, ERROR: 0, BLOCKING: 0 } as Record<HrHealthSeverity, number>;
    for (const i of issues) summary[i.severity]++;
    return { asOfDate: isoHr(asOf), checkedEmployments: active.length, summary, issues };
  }
}
