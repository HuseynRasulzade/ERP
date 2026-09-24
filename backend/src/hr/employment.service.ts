import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { EffectiveTimeline } from './effective-timeline';
import { HrCatalogType, HrDocType, HrEventType } from './hr.constants';
import { fmtHr, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrEventService } from './hr-event.service';
import { HrHistoryService } from './hr-history.service';
import { HrPolicyService } from './hr-policy.service';
import { HrSecurityService } from './hr-security.service';
import { HrIssues, HrValidationService } from './hr-validation.service';
import { ReturnToWorkDto, ScheduleChangeDto, SuspendDto } from './dto/hr.dto';

/**
 * EmploymentService (spec 8/10/37/108). Owns the employment row lock (the
 * serialization point for every HR writer of one employment, spec 77), the
 * current-state projection refresh (spec 23 — projection only, never the
 * source of truth), the employee list (spec 90), the employment card (spec
 * 102) and suspension / return-to-work (spec 37).
 */
@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly history: HrHistoryService,
    private readonly events: HrEventService,
    private readonly policy: HrPolicyService,
    private readonly security: HrSecurityService,
  ) {}

  /** SELECT ... FOR UPDATE on the employment row — every HR writer of an
   * employment takes this first, inside its transaction. */
  async lock(tx: PrismaTransactionClient, tenantId: string, employmentId: string) {
    await tx.$queryRawUnsafe(`SELECT id FROM employments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, employmentId, tenantId);
    const emp = await tx.employment.findFirst({ where: { id: employmentId, tenantId } });
    if (!emp) throw new NotFoundAppError('Employment', employmentId);
    return emp;
  }

  async lockEmployee(tx: PrismaTransactionClient, tenantId: string, employeeId: string) {
    await tx.$queryRawUnsafe(`SELECT id FROM employees WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, employeeId, tenantId);
  }

  async assertAccess(tenantId: string, membershipId: string, employmentId: string) {
    const emp = await this.prisma.employment.findFirst({ where: { id: employmentId, tenantId } });
    if (!emp) throw new NotFoundAppError('Employment', employmentId);
    await this.access.assertAccess(tenantId, membershipId, emp.organizationId);
    return emp;
  }

  /** Refreshes the Employment projection columns from the histories. */
  async refreshProjection(tx: PrismaTransactionClient, tenantId: string, employmentId: string) {
    const emp = await tx.employment.findFirst({ where: { id: employmentId, tenantId } });
    if (!emp) return;
    const today = todayHr();
    let at = today;
    if (today < emp.employmentStartDate) at = emp.employmentStartDate;
    else if (emp.employmentEndDate && today > emp.employmentEndDate) at = emp.employmentEndDate;
    const stateAt = await this.history.getEmploymentState(tenantId, employmentId, at, tx);
    const statusToday = await this.history.statusAt(emp, today, tx);
    const a = stateAt.assignment;
    await tx.employment.update({
      where: { id: employmentId },
      data: {
        employmentStatus: statusToday,
        ...(a
          ? {
              departmentId: a.departmentId,
              positionId: a.positionId,
              staffingPositionId: a.staffingPositionId,
              branchId: a.branchId,
              managerEmploymentId: a.managerEmploymentId,
              fte: a.fte,
              location: a.location,
              costCenter: a.costCenter,
              project: a.project,
            }
          : {}),
        workScheduleId: stateAt.workSchedule?.workScheduleId ?? null,
        version: { increment: 1 },
      },
    });
  }

  async refreshEmployee(tx: PrismaTransactionClient, tenantId: string, employeeId: string) {
    const employments = await tx.employment.findMany({ where: { tenantId, employeeId, status: 'ACTIVE' } });
    const today = todayHr();
    const current = employments.filter((e) => !e.employmentEndDate || e.employmentEndDate >= today);
    const starts = employments.map((e) => e.employmentStartDate.getTime());
    const ends = employments.map((e) => e.employmentEndDate?.getTime()).filter((x): x is number => !!x);
    await tx.employee.update({
      where: { id: employeeId },
      data: {
        status: current.length ? 'ACTIVE' : employments.length ? 'INACTIVE' : 'CANDIDATE',
        hireFirstDate: starts.length ? new Date(Math.min(...starts)) : null,
        lastTerminationDate: ends.length ? new Date(Math.max(...ends)) : null,
      },
    });
  }

  // --------------------------------------------------------------- reads

  /** Employee list (spec 90): personnel number, employee, organization,
   * department, position, manager, type, FTE, hire date, status — as of a
   * date, from the history (never from projection columns). */
  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; asOf?: string; status?: string; includeInactive?: string; employeeId?: string; search?: string }) {
    const asOf = parseOptionalHrDate(filter.asOf, 'asOf') ?? todayHr();
    const orgIds = await this.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    const employments = await this.prisma.employment.findMany({
      where: {
        tenantId,
        organizationId: { in: orgIds },
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.search ? { employee: { OR: [{ personnelNumber: { contains: filter.search, mode: 'insensitive' } }, { physicalPerson: { fullName: { contains: filter.search, mode: 'insensitive' } } }] } } : {}),
      },
      include: { employee: { include: { physicalPerson: { select: { fullName: true } } } }, organization: { select: { code: true, name: true } } },
      orderBy: [{ employmentStartDate: 'desc' }],
      take: 1000,
    });
    const rows = [];
    for (const e of employments) {
      const s = await this.history.getEmploymentState(tenantId, e.id, asOf);
      if (filter.status && s.status !== filter.status) continue;
      if (!filter.status && filter.includeInactive !== 'true' && !['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'PLANNED'].includes(s.status)) continue;
      rows.push({
        employmentId: e.id,
        employeeId: e.employeeId,
        personnelNumber: e.employee.personnelNumber,
        employeeName: e.employee.physicalPerson.fullName,
        organizationId: e.organizationId,
        organizationName: e.organization.name,
        departmentName: s.assignment?.departmentName ?? null,
        positionName: s.assignment?.positionName ?? null,
        managerName: s.assignment?.managerName ?? null,
        employmentType: e.employmentType,
        primaryEmployment: e.primaryEmployment,
        fte: s.assignment?.fte ?? Number(e.fte.toString()),
        hireDate: isoHr(e.employmentStartDate),
        terminationDate: isoHr(e.employmentEndDate),
        status: s.status,
        asOfDate: isoHr(asOf),
      });
    }
    return rows;
  }

  async accessibleOrgIds(tenantId: string, membershipId: string, organizationId?: string) {
    if (organizationId) {
      await this.access.assertAccess(tenantId, membershipId, organizationId);
      return [organizationId];
    }
    return this.access.listAccessibleOrganizationIds(membershipId);
  }

  /** Employment card (spec 102) — state as of any date (spec 107). */
  async getCard(tenantId: string, membershipId: string, employmentId: string, asOfRaw?: string) {
    const emp = await this.assertAccess(tenantId, membershipId, employmentId);
    const asOf = parseOptionalHrDate(asOfRaw, 'asOf') ?? todayHr();
    const state = await this.history.getEmploymentState(tenantId, employmentId, asOf);
    const [contracts, hire, terminations, transfers] = await Promise.all([
      this.prisma.employmentContract.findMany({ where: { employmentId }, include: { versions: { orderBy: { versionNumber: 'asc' } } } }),
      emp.hireDocumentId ? this.prisma.hireDocument.findUnique({ where: { id: emp.hireDocumentId } }) : null,
      this.prisma.terminationDocument.findMany({ where: { employmentId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.employeeTransfer.findMany({ where: { employmentId }, orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      employment: emp,
      state,
      contracts: contracts.map((c) => this.security.redactContract(c)),
      hireDocument: hire,
      transfers,
      terminations,
    };
  }

  // --------------------------------------------------------- status events

  /** Suspension (spec 37) — NOT a termination: the employment stays, its
   * status history gets a SUSPENDED segment from `effectiveFrom`. */
  async suspend(tenantId: string, membershipId: string, userId: string, employmentId: string, dto: SuspendDto) {
    await this.assertAccess(tenantId, membershipId, employmentId);
    const date = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    await this.policy.assertCatalogCode(tenantId, HrCatalogType.SUSPENSION_REASON, dto.reasonCode);
    return this.statusChange(tenantId, userId, employmentId, date, 'SUSPENDED', HrDocType.SUSPENSION, `${dto.reasonCode}${dto.comment ? `: ${dto.comment}` : ''}`, HrEventType.EMPLOYEE_SUSPENDED);
  }

  async returnToWork(tenantId: string, membershipId: string, userId: string, employmentId: string, dto: ReturnToWorkDto) {
    await this.assertAccess(tenantId, membershipId, employmentId);
    const date = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    return this.statusChange(tenantId, userId, employmentId, date, 'ACTIVE', HrDocType.RETURN_TO_WORK, dto.comment ?? 'Return to work', HrEventType.EMPLOYEE_RETURNED_TO_WORK);
  }

  private async statusChange(tenantId: string, userId: string, employmentId: string, date: Date, status: 'ACTIVE' | 'SUSPENDED', sourceType: string, reason: string, eventType: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const emp = await this.lock(tx, tenantId, employmentId);
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, date, tx);
      await this.events.assertNotFinalized(tenantId, employmentId, date);
      const current = await this.history.statusAt(emp, date, tx);
      const expected = status === 'SUSPENDED' ? ['ACTIVE', 'ON_LEAVE'] : ['SUSPENDED'];
      if (!expected.includes(current)) {
        throw new HrRuleError(
          ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE,
          status === 'SUSPENDED'
            ? `Employment cannot be suspended on ${fmtHr(date)} because its status on that date is ${current}`
            : `Return to work on ${fmtHr(date)} requires a suspended employment (status on that date is ${current})`,
        );
      }
      const sourceId = randomUUID();
      const timeline = new EffectiveTimeline(tx, 'employmentStatusHistory');
      const { previous, created } = await timeline.change(employmentId, date, () => ({
        tenantId,
        status,
        reason,
        sourceDocumentType: sourceType,
        sourceDocumentId: sourceId,
        createdBy: userId,
      }));
      await this.refreshProjection(tx, tenantId, employmentId);
      await this.events.emit(tx, {
        tenantId,
        eventType,
        employeeId: emp.employeeId,
        employmentId,
        organizationId: emp.organizationId,
        effectiveDate: date,
        oldState: { status: previous?.status },
        newState: { status },
        sourceDocumentType: sourceType,
        sourceDocumentId: sourceId,
      });
      await this.events.signalRecalculationIfNeeded(tx, { tenantId, employeeId: emp.employeeId, employmentId, organizationId: emp.organizationId, effectiveDate: date, sourceDocumentType: sourceType, sourceDocumentId: sourceId, changeType: status === 'SUSPENDED' ? 'SUSPENSION' : 'RETURN_TO_WORK' });
      await this.audit.record(
        { tenantId, eventType: status === 'SUSPENDED' ? 'HR_EMPLOYMENT_SUSPENDED' : 'HR_EMPLOYMENT_RETURNED_TO_WORK', entityType: HrDocType.EMPLOYMENT, entityId: employmentId, action: status, userId, oldValues: { status: previous?.status }, newValues: { status, effectiveFrom: isoHr(date) }, reason },
        tx,
      );
      return created;
    });
  }

  // ------------------------------------------------ secondary assignment

  /**
   * Internal combination (spec 31): an additional role inside the SAME
   * employment, recorded as an `isSecondary` assignment row that may overlap
   * the primary assignment (the explicit multi-assignment model of spec 74).
   * Not a second employment and not counted in headcount.
   */
  async addSecondaryAssignment(
    tenantId: string,
    membershipId: string,
    userId: string,
    employmentId: string,
    dto: { departmentId: string; positionId: string; fte: number; effectiveFrom: string; effectiveTo?: string; reason?: string },
    validation: HrValidationService,
  ) {
    await this.assertAccess(tenantId, membershipId, employmentId);
    const from = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    const to = parseOptionalHrDate(dto.effectiveTo, 'effectiveTo');
    if (to && to < from) throw new ValidationAppError('effectiveTo must be on or after effectiveFrom');
    return this.prisma.runInTransaction(async (tx) => {
      const emp = await this.lock(tx, tenantId, employmentId);
      await this.history.validateEmploymentActive(tenantId, employmentId, from, {}, tx);
      const issues = new HrIssues();
      await validation.department(tx, emp.organizationId, dto.departmentId, from, issues);
      await validation.position(tx, tenantId, dto.positionId, issues);
      if (!(dto.fte > 0 && dto.fte <= 1)) issues.error(ErrorCode.HR_FTE_INVALID, `Secondary assignment FTE must be in (0, 1], got ${dto.fte}`);
      issues.throwIfErrors();
      const id = randomUUID();
      const row = await tx.employeeAssignment.create({
        data: {
          id,
          tenantId,
          employmentId,
          effectiveFrom: from,
          effectiveTo: to ?? emp.employmentEndDate,
          organizationId: emp.organizationId,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          fte: dto.fte,
          isSecondary: true,
          eventType: 'SECONDARY_ASSIGNMENT',
          reason: dto.reason,
          sourceDocumentType: 'HR_SECONDARY_ASSIGNMENT',
          sourceDocumentId: id,
          createdBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'HR_SECONDARY_ASSIGNMENT_CREATED', entityType: HrDocType.EMPLOYMENT, entityId: employmentId, action: 'CREATE', userId, newValues: row }, tx);
      return row;
    });
  }
}

/**
 * WorkScheduleAssignmentService (spec 32/33/134) — schedule history is its
 * own effective-dated timeline, never an employee master field.
 */
@Injectable()
export class WorkScheduleAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employments: EmploymentService,
    private readonly history: HrHistoryService,
    private readonly events: HrEventService,
    private readonly policy: HrPolicyService,
    private readonly validation: HrValidationService,
  ) {}

  list(tenantId: string, employmentId: string) {
    return this.prisma.workScheduleAssignment.findMany({ where: { tenantId, employmentId }, orderBy: [{ effectiveFrom: 'asc' }, { sequence: 'asc' }] });
  }

  /** Applies a schedule change inside an existing transaction (used by the
   * schedule-change endpoint and by transfers carrying `newWorkScheduleId`). */
  async applyInTx(
    tx: PrismaTransactionClient,
    ctx: { tenantId: string; userId: string; employmentId: string; employeeId: string; organizationId: string },
    workScheduleId: string,
    date: Date,
    source: { type: string; id: string },
    reason?: string,
  ) {
    const timeline = new EffectiveTimeline(tx, 'workScheduleAssignment');
    const current = await timeline.covering(ctx.employmentId, date);
    if (current?.workScheduleId === workScheduleId) return null;
    const { previous, created } = await timeline.change(
      ctx.employmentId,
      date,
      () => ({ tenantId: ctx.tenantId, workScheduleId, reason, sourceDocumentType: source.type, sourceDocumentId: source.id, createdBy: ctx.userId }),
      { allowNoPrevious: true },
    );
    await this.events.emit(tx, {
      tenantId: ctx.tenantId,
      eventType: HrEventType.EMPLOYEE_SCHEDULE_CHANGED,
      employeeId: ctx.employeeId,
      employmentId: ctx.employmentId,
      organizationId: ctx.organizationId,
      effectiveDate: date,
      oldState: { workScheduleId: previous?.workScheduleId ?? null },
      newState: { workScheduleId },
      sourceDocumentType: source.type,
      sourceDocumentId: source.id,
    });
    await this.audit.record(
      { tenantId: ctx.tenantId, eventType: 'HR_SCHEDULE_CHANGED', entityType: HrDocType.EMPLOYMENT, entityId: ctx.employmentId, action: 'SCHEDULE_CHANGE', userId: ctx.userId, oldValues: { workScheduleId: previous?.workScheduleId ?? null }, newValues: { workScheduleId, effectiveFrom: isoHr(date) } },
      tx,
    );
    return created;
  }

  async changeSchedule(tenantId: string, membershipId: string, userId: string, employmentId: string, dto: ScheduleChangeDto) {
    await this.employments.assertAccess(tenantId, membershipId, employmentId);
    const date = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    return this.prisma.runInTransaction(async (tx) => {
      const emp = await this.employments.lock(tx, tenantId, employmentId);
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, date, tx);
      await this.events.assertNotFinalized(tenantId, employmentId, date);
      await this.history.validateEmploymentActive(tenantId, employmentId, date, {}, tx);
      const issues = new HrIssues();
      await this.validation.schedule(tx, tenantId, dto.workScheduleId, issues);
      issues.throwIfErrors();
      const sourceId = randomUUID();
      const created = await this.applyInTx(tx, { tenantId, userId, employmentId, employeeId: emp.employeeId, organizationId: emp.organizationId }, dto.workScheduleId, date, { type: HrDocType.SCHEDULE_CHANGE, id: sourceId }, dto.reason);
      if (!created) throw new ValidationAppError(`The employment already has this work schedule on ${fmtHr(date)}`);
      await this.events.signalRecalculationIfNeeded(tx, { tenantId, employeeId: emp.employeeId, employmentId, organizationId: emp.organizationId, effectiveDate: date, sourceDocumentType: HrDocType.SCHEDULE_CHANGE, sourceDocumentId: sourceId, changeType: 'SCHEDULE_CHANGE' });
      await this.employments.refreshProjection(tx, tenantId, employmentId);
      return created;
    });
  }
}
