import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ErrorCode, ErrorCodeType, HrRuleError, ValidationAppError } from '../common/errors/app-error';
import { EMPLOYED_STATUSES, HrPolicy } from './hr.constants';
import { fmtHr } from './hr-date.util';
import { HrHistoryService } from './hr-history.service';

export interface HrIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

/** Collects validation findings so the same rules drive both POST (throw on
 * the first ERROR) and PREVIEW (return everything, write nothing — spec 66). */
export class HrIssues {
  readonly items: HrIssue[] = [];

  error(code: ErrorCodeType, message: string) {
    this.items.push({ severity: 'ERROR', code, message });
  }

  warn(code: string, message: string) {
    this.items.push({ severity: 'WARNING', code, message });
  }

  get errors() {
    return this.items.filter((i) => i.severity === 'ERROR');
  }

  get warnings() {
    return this.items.filter((i) => i.severity === 'WARNING');
  }

  throwIfErrors() {
    const first = this.errors[0];
    if (first) {
      const status = first.code === ErrorCode.HR_EFFECTIVE_DATE_CONFLICT || first.code === ErrorCode.HR_PRIMARY_EMPLOYMENT_CONFLICT || first.code === ErrorCode.HR_DUPLICATE_EMPLOYMENT ? 409 : 422;
      throw new HrRuleError(first.code as ErrorCodeType, first.message, status, { issues: this.items });
    }
  }
}

const covering = (d: Date) => ({ effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] });

/**
 * Reference, manager-hierarchy, FTE and staffing-capacity rules shared by
 * hire, rehire, transfer and bulk operations (spec 17/18/68-74).
 */
@Injectable()
export class HrValidationService {
  constructor(private readonly history: HrHistoryService) {}

  async department(db: PrismaTransactionClient, organizationId: string, departmentId: string, date: Date, issues: HrIssues) {
    const dep = await db.department.findFirst({ where: { id: departmentId, organizationId } });
    if (!dep) throw new ValidationAppError('Department does not belong to this organization');
    if (!dep.active) issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Department ${dep.code} (${dep.name}) is inactive; hire/transfer into it on ${fmtHr(date)} is blocked`);
    return dep;
  }

  async position(db: PrismaTransactionClient, tenantId: string, positionId: string, issues: HrIssues) {
    const pos = await db.hrPosition.findFirst({ where: { id: positionId, tenantId } });
    if (!pos) throw new ValidationAppError('Position not found');
    if (!pos.active) issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Position ${pos.code} (${pos.name}) is inactive`);
    return pos;
  }

  async branch(db: PrismaTransactionClient, organizationId: string, branchId: string, issues: HrIssues) {
    const br = await db.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!br) throw new ValidationAppError('Branch does not belong to this organization');
    if (!br.active) issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Branch ${br.code} is inactive`);
    return br;
  }

  async schedule(db: PrismaTransactionClient, tenantId: string, workScheduleId: string, issues: HrIssues) {
    const ws = await db.hrWorkSchedule.findFirst({ where: { id: workScheduleId, tenantId } });
    if (!ws) throw new ValidationAppError('Work schedule not found');
    if (!ws.active) issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Work schedule ${ws.code} is inactive`);
    return ws;
  }

  /** Staffing position must be ACTIVE, inside its validity window and part
   * of a staffing table that is ACTIVE on `date` (spec 68/82). */
  async staffingPosition(db: PrismaTransactionClient, tenantId: string, organizationId: string, staffingPositionId: string, date: Date, issues: HrIssues) {
    const sp = await db.staffingPosition.findFirst({ where: { id: staffingPositionId, tenantId, organizationId }, include: { staffingTable: true } });
    if (!sp) throw new ValidationAppError('Staffing position does not belong to this organization');
    const table = sp.staffingTable;
    const inWindow = sp.activeFrom <= date && (!sp.activeTo || sp.activeTo >= date);
    const tableOk = ['ACTIVE', 'SUPERSEDED'].includes(table.status) && table.effectiveFrom <= date && (!table.effectiveTo || table.effectiveTo >= date);
    if (sp.status !== 'ACTIVE' || !inWindow || !tableOk) {
      issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Staffing Position ${sp.code} is not active on ${fmtHr(date)}`);
    }
    return sp;
  }

  async occupancy(db: PrismaTransactionClient, tenantId: string, organizationId: string, code: string, date: Date, excludeEmploymentId?: string) {
    const ids = (await db.staffingPosition.findMany({ where: { tenantId, organizationId, code }, select: { id: true } })).map((s) => s.id);
    const rows = await db.employeeAssignment.findMany({
      where: {
        tenantId,
        staffingPositionId: { in: ids },
        recordStatus: 'ACTIVE',
        ...covering(date),
        employment: { status: 'ACTIVE' },
        ...(excludeEmploymentId ? { employmentId: { not: excludeEmploymentId } } : {}),
      },
      select: { employmentId: true, fte: true },
    });
    const employments = new Set(rows.map((r) => r.employmentId));
    const fte = rows.reduce((s, r) => s + Number(r.fte.toString()), 0);
    return { headcount: employments.size, fte: Math.round(fte * 10000) / 10000 };
  }

  /**
   * Staffing capacity + overstaff policy (spec 17/18/131). Capacity is
   * checked on the effective date AND on every later date another
   * assignment already starts on the same slot, so a future-dated hire can
   * never silently overbook the slot.
   */
  async capacity(
    db: PrismaTransactionClient,
    params: {
      tenantId: string;
      staffingPosition: { organizationId: string; code: string; headcountLimit: number; fteLimit: any };
      date: Date;
      fte: number;
      excludeEmploymentId?: string;
      policy: HrPolicy;
      overrideRequested: boolean;
      canOverride: boolean;
      approved: boolean;
    },
    issues: HrIssues,
  ) {
    const { tenantId, staffingPosition: sp, date, fte } = params;
    const ids = (await db.staffingPosition.findMany({ where: { tenantId, organizationId: sp.organizationId, code: sp.code }, select: { id: true } })).map((s) => s.id);
    const later = await db.employeeAssignment.findMany({
      where: { tenantId, staffingPositionId: { in: ids }, recordStatus: 'ACTIVE', effectiveFrom: { gt: date } },
      select: { effectiveFrom: true },
    });
    const dates = [date, ...later.map((l) => l.effectiveFrom)];
    const limit = Number(sp.fteLimit.toString());
    let violation: string | null = null;
    for (const d of dates) {
      const occ = await this.occupancy(db, tenantId, sp.organizationId, sp.code, d, params.excludeEmploymentId);
      if (occ.fte + fte > limit + 1e-9) {
        violation = `Employment cannot be activated because Staffing Position ${sp.code} has no available FTE on ${fmtHr(d)} (limit ${limit}, occupied ${occ.fte}, requested ${fte})`;
        break;
      }
      if (occ.headcount + 1 > sp.headcountLimit) {
        violation = `Employment cannot be activated because Staffing Position ${sp.code} has no available headcount on ${fmtHr(d)} (limit ${sp.headcountLimit}, occupied ${occ.headcount})`;
        break;
      }
    }
    if (!violation) return { exceeded: false };
    const policy = params.policy.overstaffPolicy;
    if (policy === 'ALLOW') return { exceeded: true };
    if (params.overrideRequested && params.canOverride) {
      issues.warn('HR_STAFFING_LIMIT_OVERRIDDEN', `${violation} — overridden by an authorized user`);
      return { exceeded: true, overridden: true };
    }
    if (policy === 'WARNING') issues.warn(ErrorCode.HR_STAFFING_CAPACITY_EXCEEDED, violation);
    else if (policy === 'APPROVAL_REQUIRED') {
      if (params.approved) issues.warn(ErrorCode.HR_STAFFING_CAPACITY_EXCEEDED, `${violation} — accepted by approval`);
      else issues.error(ErrorCode.HR_APPROVAL_REQUIRED, `${violation}; the document must be approved before posting (overstaff policy APPROVAL_REQUIRED)`);
    } else issues.error(ErrorCode.HR_STAFFING_CAPACITY_EXCEEDED, violation);
    return { exceeded: true };
  }

  /** Manager must be employed on `date`, never self, never circular (spec
   * 71/72/136). The reporting line is walked as of `date`. */
  async manager(db: PrismaTransactionClient, tenantId: string, employmentId: string | null, managerEmploymentId: string, date: Date, issues: HrIssues) {
    if (employmentId && managerEmploymentId === employmentId) {
      issues.error(ErrorCode.HR_CIRCULAR_MANAGER, 'Manager assignment would create a circular reporting hierarchy (an employment cannot manage itself)');
      return;
    }
    const mgr = await db.employment.findFirst({ where: { id: managerEmploymentId, tenantId }, include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } } });
    if (!mgr) throw new ValidationAppError('Manager employment not found');
    const status = await this.history.statusAt(mgr, date, db);
    if (!EMPLOYED_STATUSES.includes(status)) {
      issues.error(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `Manager ${mgr.employee.physicalPerson.fullName} is not active on ${fmtHr(date)} (status ${status})`);
      return;
    }
    if (!employmentId) return;
    const visited = new Set<string>([managerEmploymentId]);
    let current = managerEmploymentId;
    for (let i = 0; i < 1000; i++) {
      const a = await db.employeeAssignment.findFirst({
        where: { employmentId: current, recordStatus: 'ACTIVE', isSecondary: false, ...covering(date) },
        orderBy: [{ effectiveFrom: 'desc' }, { sequence: 'desc' }],
        select: { managerEmploymentId: true },
      });
      const next = a?.managerEmploymentId;
      if (!next) return;
      if (next === employmentId) {
        issues.error(ErrorCode.HR_CIRCULAR_MANAGER, 'Manager assignment would create a circular reporting hierarchy');
        return;
      }
      if (visited.has(next)) return;
      visited.add(next);
      current = next;
    }
  }

  /** FTE > 0, per-employment max, and aggregate across the employee's
   * employments employed on `date` (spec 73). */
  async fte(db: PrismaTransactionClient, tenantId: string, employeeId: string, fte: number, date: Date, policy: HrPolicy, issues: HrIssues, excludeEmploymentId?: string) {
    if (!(fte > 0)) {
      issues.error(ErrorCode.HR_FTE_INVALID, `FTE must be greater than 0 (got ${fte})`);
      return;
    }
    if (fte > policy.maxEmploymentFte + 1e-9) {
      issues.error(ErrorCode.HR_FTE_INVALID, `FTE ${fte} exceeds the maximum ${policy.maxEmploymentFte} for one employment`);
      return;
    }
    const others = await db.employeeAssignment.findMany({
      where: {
        tenantId,
        recordStatus: 'ACTIVE',
        isSecondary: false,
        ...covering(date),
        employment: { employeeId, status: 'ACTIVE' },
        ...(excludeEmploymentId ? { employmentId: { not: excludeEmploymentId } } : {}),
      },
      select: { fte: true },
    });
    const total = others.reduce((s, r) => s + Number(r.fte.toString()), 0) + fte;
    if (total > policy.maxAggregateFte + 1e-9) {
      issues.error(ErrorCode.HR_FTE_INVALID, `Aggregate FTE ${Math.round(total * 10000) / 10000} across this employee's employments on ${fmtHr(date)} exceeds the policy maximum ${policy.maxAggregateFte}`);
    }
  }
}
