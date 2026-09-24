import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentLinkService } from '../document-link/document-link.service';
import { AppError, ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { BulkTransferDto, CreateTransferDto, TransferChangesDto } from './dto/hr.dto';
import { EffectiveTimeline } from './effective-timeline';
import { EMPLOYED_STATUSES, HrDocType, HrEventType, HrPolicy } from './hr.constants';
import { fmtHr, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrDocumentLifecycleService } from './hr-document-lifecycle.service';
import { HrEventService } from './hr-event.service';
import { HrHistoryService } from './hr-history.service';
import { HrNumberingService } from './hr-numbering.service';
import { HrPolicyService } from './hr-policy.service';
import { HrSecurityService } from './hr-security.service';
import { HrIssues, HrValidationService } from './hr-validation.service';
import { EmploymentService, WorkScheduleAssignmentService } from './employment.service';

const ASSIGNMENT_FIELDS = ['departmentId', 'positionId', 'staffingPositionId', 'branchId', 'managerEmploymentId', 'location', 'fte', 'costCenter', 'project'] as const;

/**
 * EmployeeTransferService (spec 24-28, 83/84, 132/133/141). Transfer POST
 * closes the assignment in effect on the effective date at D-1 and starts a
 * new one at D (never overwriting it). A future-dated transfer leaves today's
 * state untouched until D; as-of queries on/after D already see it.
 * Concurrency: the document captures the assignment it was based on
 * (`oldAssignmentId`); under the employment row lock, POST refuses when a
 * different assignment is in effect by then — two parallel transfers for the
 * same employment/date yield exactly one state transition (spec 77/141).
 */
@Injectable()
export class EmployeeTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly links: DocumentLinkService,
    private readonly numbering: HrNumberingService,
    private readonly lifecycle: HrDocumentLifecycleService,
    private readonly events: HrEventService,
    private readonly history: HrHistoryService,
    private readonly policy: HrPolicyService,
    private readonly security: HrSecurityService,
    private readonly validation: HrValidationService,
    private readonly employments: EmploymentService,
    private readonly schedules: WorkScheduleAssignmentService,
  ) {}

  static hasChanges(dto: TransferChangesDto) {
    return !!(
      dto.newDepartmentId ||
      dto.newPositionId ||
      dto.newStaffingPositionId ||
      dto.newBranchId ||
      dto.newManagerEmploymentId ||
      dto.clearManager ||
      dto.newLocation ||
      dto.newFte !== undefined ||
      dto.newCostCenter ||
      dto.newProject ||
      dto.newWorkScheduleId
    );
  }

  async create(tenantId: string, membershipId: string, userId: string, dto: CreateTransferDto, batchNumber?: string) {
    const emp = await this.employments.assertAccess(tenantId, membershipId, dto.employmentId);
    if (emp.status !== 'ACTIVE') throw new ValidationAppError('A cancelled employment cannot be transferred');
    if (!EmployeeTransferService.hasChanges(dto)) throw new ValidationAppError('A transfer must change at least one of department, position, staffing position, branch, manager, location, FTE, cost center, project or schedule');
    const effectiveDate = parseHrDate(dto.effectiveDate, 'effectiveDate');
    const documentDate = parseOptionalHrDate(dto.documentDate, 'documentDate') ?? todayHr();
    const covering = await new EffectiveTimeline(this.prisma, 'employeeAssignment', { isSecondary: false }).covering(emp.id, effectiveDate);
    if (!covering) {
      throw new HrRuleError(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `Employment has no assignment on ${fmtHr(effectiveDate)} (employment period ${fmtHr(emp.employmentStartDate)} – ${emp.employmentEndDate ? fmtHr(emp.employmentEndDate) : 'open'})`);
    }
    await this.numbering.ensure(tenantId, 'HR_TRANSFER');
    return this.prisma.runInTransaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'HR_TRANSFER', documentDate);
      const doc = await tx.employeeTransfer.create({
        data: {
          tenantId,
          organizationId: emp.organizationId,
          number,
          documentDate,
          batchNumber,
          employmentId: emp.id,
          effectiveDate,
          transferType: dto.transferType,
          oldAssignmentId: covering.id,
          newDepartmentId: dto.newDepartmentId,
          newPositionId: dto.newPositionId,
          newStaffingPositionId: dto.newStaffingPositionId,
          newBranchId: dto.newBranchId,
          newManagerEmploymentId: dto.newManagerEmploymentId,
          clearManager: dto.clearManager ?? false,
          newLocation: dto.newLocation,
          newFte: dto.newFte,
          newCostCenter: dto.newCostCenter,
          newProject: dto.newProject,
          newWorkScheduleId: dto.newWorkScheduleId,
          reason: dto.reason,
          overrideStaffingLimit: dto.overrideStaffingLimit ?? false,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'HR_TRANSFER_CREATED', entityType: HrDocType.TRANSFER, entityId: doc.id, action: 'CREATE', userId, newValues: { number, employmentId: emp.id, effectiveDate: isoHr(effectiveDate), transferType: dto.transferType } }, tx);
      return doc;
    });
  }

  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; status?: string; employmentId?: string; batchNumber?: string }) {
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    return this.prisma.employeeTransfer.findMany({
      where: {
        tenantId,
        organizationId: { in: orgIds },
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.employmentId ? { employmentId: filter.employmentId } : {}),
        ...(filter.batchNumber ? { batchNumber: filter.batchNumber } : {}),
      },
      orderBy: [{ effectiveDate: 'desc' }, { number: 'desc' }],
      take: 1000,
    });
  }

  async get(tenantId: string, membershipId: string, id: string) {
    const doc = await this.prisma.employeeTransfer.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundAppError('EmployeeTransfer', id);
    await this.access.assertAccess(tenantId, membershipId, doc.organizationId);
    return doc;
  }

  // ---------------------------------------------------------- evaluation

  private async evaluate(db: PrismaTransactionClient, doc: any, policy: HrPolicy, issues: HrIssues) {
    const tenantId = doc.tenantId;
    const D: Date = doc.effectiveDate;
    const emp = await db.employment.findFirst({ where: { id: doc.employmentId, tenantId } });
    if (!emp) throw new NotFoundAppError('Employment', doc.employmentId);
    const status = await this.history.statusAt(emp, D, db);
    if (!EMPLOYED_STATUSES.includes(status)) {
      issues.error(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `Employment is ${status} on ${fmtHr(D)}; a transfer requires an active employment on its effective date`);
    }
    const timeline = new EffectiveTimeline(db, 'employeeAssignment', { isSecondary: false });
    const current = await timeline.covering(emp.id, D);
    const later = await timeline.later(emp.id, D);
    if (later) issues.error(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, `Transfer effective date ${fmtHr(D)} precedes an already posted change effective ${fmtHr(later.effectiveFrom)}; reverse that change first`);
    if (!current) {
      issues.error(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `Employment has no assignment on ${fmtHr(D)}`);
      return { emp, current: null, next: null, changed: [] as string[] };
    }
    if (doc.oldAssignmentId && current.id !== doc.oldAssignmentId) {
      issues.error(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, `Transfer effective date ${fmtHr(D)} overlaps an existing assignment created after this document was prepared (by another HR change)`);
    }

    let departmentId = doc.newDepartmentId ?? current.departmentId;
    let positionId = doc.newPositionId ?? current.positionId;
    let costCenter = doc.newCostCenter ?? current.costCenter;
    let location = doc.newLocation ?? current.location;
    let branchId = doc.newBranchId ?? current.branchId;
    let staffing = null as any;
    if (doc.newStaffingPositionId) {
      staffing = await this.validation.staffingPosition(db, tenantId, emp.organizationId, doc.newStaffingPositionId, D, issues);
      if (!doc.newDepartmentId) departmentId = staffing.departmentId;
      if (!doc.newPositionId) positionId = staffing.positionId;
      if (!doc.newCostCenter && staffing.costCenter) costCenter = staffing.costCenter;
      if (!doc.newLocation && staffing.location) location = staffing.location;
      if (!doc.newBranchId && staffing.branchId) branchId = staffing.branchId;
      if (staffing.departmentId !== departmentId || staffing.positionId !== positionId) issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Department/position do not match Staffing Position ${staffing.code}`);
    }
    // A department/position move without a new staffing slot leaves the old
    // slot — it would otherwise keep being counted as occupied there.
    const staffingPositionId = doc.newStaffingPositionId ?? (doc.newDepartmentId || doc.newPositionId ? null : current.staffingPositionId);
    const next = {
      departmentId,
      positionId,
      staffingPositionId,
      branchId,
      managerEmploymentId: doc.clearManager ? null : doc.newManagerEmploymentId ?? current.managerEmploymentId,
      location,
      fte: doc.newFte !== null && doc.newFte !== undefined ? Number(doc.newFte.toString()) : Number(current.fte.toString()),
      costCenter,
      project: doc.newProject ?? current.project,
    };
    if (doc.newDepartmentId) await this.validation.department(db, emp.organizationId, departmentId, D, issues);
    if (doc.newPositionId) await this.validation.position(db, tenantId, positionId, issues);
    if (doc.newBranchId) await this.validation.branch(db, emp.organizationId, branchId, issues);
    if (doc.newWorkScheduleId) await this.validation.schedule(db, tenantId, doc.newWorkScheduleId, issues);
    if (doc.newManagerEmploymentId && !doc.clearManager) await this.validation.manager(db, tenantId, emp.id, doc.newManagerEmploymentId, D, issues);
    if (doc.newFte !== null && doc.newFte !== undefined) await this.validation.fte(db, tenantId, emp.employeeId, next.fte, D, policy, issues, emp.id);

    const changed = ASSIGNMENT_FIELDS.filter((f) => {
      const before = f === 'fte' ? Number(current.fte.toString()) : (current as any)[f] ?? null;
      return before !== ((next as any)[f] ?? null);
    }) as string[];
    const scheduleNow = await new EffectiveTimeline(db, 'workScheduleAssignment').covering(emp.id, D);
    const scheduleChanges = !!doc.newWorkScheduleId && scheduleNow?.workScheduleId !== doc.newWorkScheduleId;
    if (!changed.length && !scheduleChanges) issues.error(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, `The transfer does not change anything compared with the assignment in effect on ${fmtHr(D)}`);

    const slotChanges = next.staffingPositionId && (next.staffingPositionId !== current.staffingPositionId || next.fte > Number(current.fte.toString()));
    if (slotChanges) {
      const sp = staffing ?? (await db.staffingPosition.findFirst({ where: { id: next.staffingPositionId!, tenantId } }));
      if (sp) {
        await this.validation.capacity(
          db,
          { tenantId, staffingPosition: sp, date: D, fte: next.fte, excludeEmploymentId: emp.id, policy, overrideRequested: doc.overrideStaffingLimit, canOverride: this.security.can(PermissionCodes.HR_OVERRIDE_STAFFING_LIMIT), approved: doc.status === 'APPROVED' },
          issues,
        );
      }
    }
    return { emp, current, next, changed, scheduleChanges, scheduleBefore: scheduleNow?.workScheduleId ?? null };
  }

  private async describe(db: PrismaTransactionClient, a: { departmentId?: string | null; positionId?: string | null; managerEmploymentId?: string | null; staffingPositionId?: string | null; fte?: number; costCenter?: string | null; branchId?: string | null; location?: string | null } | null, workScheduleId: string | null) {
    if (!a) return null;
    const [dep, pos, mgr, ws, sp] = await Promise.all([
      a.departmentId ? db.department.findUnique({ where: { id: a.departmentId }, select: { name: true } }) : null,
      a.positionId ? db.hrPosition.findUnique({ where: { id: a.positionId }, select: { name: true } }) : null,
      a.managerEmploymentId ? db.employment.findUnique({ where: { id: a.managerEmploymentId }, select: { employee: { select: { physicalPerson: { select: { fullName: true } } } } } }) : null,
      workScheduleId ? db.hrWorkSchedule.findUnique({ where: { id: workScheduleId }, select: { name: true } }) : null,
      a.staffingPositionId ? db.staffingPosition.findUnique({ where: { id: a.staffingPositionId }, select: { code: true } }) : null,
    ]);
    return {
      departmentId: a.departmentId,
      departmentName: dep?.name ?? null,
      positionId: a.positionId,
      positionName: pos?.name ?? null,
      staffingPositionId: a.staffingPositionId ?? null,
      staffingPositionCode: sp?.code ?? null,
      managerEmploymentId: a.managerEmploymentId ?? null,
      managerName: mgr?.employee.physicalPerson.fullName ?? null,
      workScheduleId,
      workScheduleName: ws?.name ?? null,
      fte: a.fte !== undefined ? Number(a.fte) : null,
      costCenter: a.costCenter ?? null,
      branchId: a.branchId ?? null,
      location: a.location ?? null,
    };
  }

  /** Transfer preview (spec 66/104): Before -> After on the effective date. */
  async preview(tenantId: string, membershipId: string, id: string) {
    const doc = await this.get(tenantId, membershipId, id);
    const policy = await this.policy.getPolicy(tenantId);
    const issues = new HrIssues();
    let r: any = null;
    try {
      await this.policy.assertHrDateOpen(tenantId, doc.organizationId, doc.effectiveDate);
      r = await this.evaluate(this.prisma, doc, policy, issues);
    } catch (e) {
      if (e instanceof AppError) issues.error(e.code, e.message);
      else throw e;
    }
    const before = r?.current ? await this.describe(this.prisma, { ...r.current, fte: Number(r.current.fte.toString()) }, r.scheduleBefore) : null;
    const after = r?.next ? await this.describe(this.prisma, r.next, doc.newWorkScheduleId ?? r.scheduleBefore) : null;
    return {
      valid: issues.errors.length === 0,
      issues: issues.items,
      effectiveDate: isoHr(doc.effectiveDate),
      appliesToday: doc.effectiveDate <= todayHr(),
      before,
      after,
      changedFields: [...(r?.changed ?? []), ...(r?.scheduleChanges ? ['workScheduleId'] : [])],
    };
  }

  // ---------------------------------------------------------------- post

  async post(tenantId: string, membershipId: string, userId: string, id: string, expectedVersion?: number) {
    const head = await this.get(tenantId, membershipId, id);
    const policy = await this.policy.getPolicy(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lifecycle.lock(tx, 'employeeTransfer', tenantId, id);
      if (this.lifecycle.assertPostable(doc, policy, expectedVersion) === 'ALREADY_POSTED') {
        return { alreadyPosted: true, document: doc, warnings: doc.warnings ?? [] };
      }
      await this.policy.assertHrDateOpen(tenantId, head.organizationId, doc.effectiveDate, tx);
      const emp = await this.employments.lock(tx, tenantId, doc.employmentId);
      await this.events.assertNotFinalized(tenantId, emp.id, doc.effectiveDate);

      const issues = new HrIssues();
      const r = await this.evaluate(tx, doc, policy, issues);
      issues.throwIfErrors();

      const D: Date = doc.effectiveDate;
      let resultAssignmentId: string | null = null;
      if (r.changed.length) {
        const { created } = await new EffectiveTimeline(tx, 'employeeAssignment', { isSecondary: false }).change(
          emp.id,
          D,
          (previous) => ({
            tenantId,
            organizationId: previous.organizationId,
            ...r.next,
            eventType: doc.transferType,
            reason: doc.reason,
            sourceDocumentType: HrDocType.TRANSFER,
            sourceDocumentId: doc.id,
            createdBy: userId,
          }),
          { expectedPreviousId: doc.oldAssignmentId },
        );
        resultAssignmentId = created.id;
      }
      const ctx = { tenantId, userId, employmentId: emp.id, employeeId: emp.employeeId, organizationId: emp.organizationId };
      if (r.scheduleChanges) await this.schedules.applyInTx(tx, ctx, doc.newWorkScheduleId, D, { type: HrDocType.TRANSFER, id: doc.id }, doc.reason ?? doc.transferType);
      await this.employments.refreshProjection(tx, tenantId, emp.id);

      const oldState = Object.fromEntries(r.changed.map((f) => [f, f === 'fte' ? Number(r.current.fte.toString()) : (r.current as any)[f]]));
      const newState = Object.fromEntries(r.changed.map((f) => [f, (r.next as any)[f]]));
      if (r.scheduleChanges) {
        oldState.workScheduleId = r.scheduleBefore;
        newState.workScheduleId = doc.newWorkScheduleId;
      }
      const warnings = issues.warnings;
      const posted = await tx.employeeTransfer.update({
        where: { id },
        data: { status: 'POSTED', resultAssignmentId, warnings: warnings as any, postingSnapshot: { before: oldState, after: newState } as any, postedAt: new Date(), postedBy: userId, updatedBy: userId, version: { increment: 1 } },
      });
      await this.links.createLink(tenantId, { sourceDocumentType: HrDocType.TRANSFER, sourceDocumentId: id, targetDocumentType: HrDocType.EMPLOYMENT, targetDocumentId: emp.id, relationType: 'RELATED', createdBy: userId }, tx);

      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: D, sourceDocumentType: HrDocType.TRANSFER, sourceDocumentId: id };
      if (r.changed.length) {
        await this.events.emit(tx, { ...base, eventType: HrEventType.EMPLOYEE_TRANSFERRED, oldState, newState, extra: { transfer_type: doc.transferType } });
        const specific: [string, string][] = [
          ['departmentId', HrEventType.EMPLOYEE_DEPARTMENT_CHANGED],
          ['positionId', HrEventType.EMPLOYEE_POSITION_CHANGED],
          ['managerEmploymentId', HrEventType.EMPLOYEE_MANAGER_CHANGED],
          ['fte', HrEventType.EMPLOYEE_FTE_CHANGED],
        ];
        for (const [field, type] of specific) {
          if (r.changed.includes(field)) await this.events.emit(tx, { ...base, eventType: type, oldState: { [field]: oldState[field] }, newState: { [field]: newState[field] } });
        }
      }
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: doc.transferType });
      await this.audit.record(
        { tenantId, eventType: 'HR_TRANSFER_POSTED', entityType: HrDocType.TRANSFER, entityId: id, action: 'POST', userId, oldValues: oldState, newValues: { ...newState, effectiveDate: isoHr(D), transferType: doc.transferType } },
        tx,
      );
      for (const [field, ev] of [['managerEmploymentId', 'HR_MANAGER_CHANGED'], ['fte', 'HR_FTE_CHANGED']] as const) {
        if (r.changed.includes(field)) {
          await this.audit.record({ tenantId, eventType: ev, entityType: HrDocType.EMPLOYMENT, entityId: emp.id, action: 'UPDATE', userId, oldValues: { [field]: oldState[field] }, newValues: { [field]: newState[field], effectiveFrom: isoHr(D) } }, tx);
        }
      }
      return { alreadyPosted: false, document: posted, warnings };
    });
  }

  /** Reversal of a posted transfer (only while nothing later depends on it). */
  async reverse(tenantId: string, membershipId: string, userId: string, id: string, reason?: string) {
    const head = await this.get(tenantId, membershipId, id);
    if (!reason) throw new ValidationAppError('A reason is required to reverse a posted transfer');
    if (head.status !== 'POSTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Only a POSTED transfer can be reversed (status ${head.status})`, 409);
    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lifecycle.lock(tx, 'employeeTransfer', tenantId, id);
      if (doc.status !== 'POSTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Only a POSTED transfer can be reversed (status ${doc.status})`, 409);
      const emp = await this.employments.lock(tx, tenantId, doc.employmentId);
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, doc.effectiveDate, tx);
      await this.events.assertNotFinalized(tenantId, emp.id, doc.effectiveDate);
      await new EffectiveTimeline(tx, 'employeeAssignment', { isSecondary: false }).reverseSource(emp.id, HrDocType.TRANSFER, id);
      await new EffectiveTimeline(tx, 'workScheduleAssignment').reverseSource(emp.id, HrDocType.TRANSFER, id);
      await this.employments.refreshProjection(tx, tenantId, emp.id);
      const updated = await tx.employeeTransfer.update({ where: { id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, reversalReason: reason, version: { increment: 1 } } });
      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: doc.effectiveDate, sourceDocumentType: HrDocType.TRANSFER, sourceDocumentId: id };
      const snap = (doc.postingSnapshot ?? {}) as any;
      await this.events.emit(tx, { ...base, eventType: HrEventType.EMPLOYEE_TRANSFER_REVERSED, oldState: snap.after ?? null, newState: snap.before ?? null });
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: 'TRANSFER_REVERSAL' });
      await this.audit.record({ tenantId, eventType: 'HR_TRANSFER_REVERSED', entityType: HrDocType.TRANSFER, entityId: id, action: 'REVERSE', userId, reason, oldValues: snap.after, newValues: snap.before }, tx);
      return updated;
    });
  }

  /** BulkEmployeeTransfer (spec 84): one batch number, each line created,
   * validated and (optionally) posted separately through the same path. */
  async bulk(tenantId: string, membershipId: string, userId: string, dto: BulkTransferDto) {
    await this.numbering.ensure(tenantId, 'HR_BULK_TRANSFER');
    const batchNumber = await this.prisma.runInTransaction((tx) => this.numbering.next(tx, tenantId, 'HR_BULK_TRANSFER', todayHr()));
    const results = [];
    for (let i = 0; i < dto.lines.length; i++) {
      const line = dto.lines[i];
      try {
        const doc = await this.create(tenantId, membershipId, userId, { ...line, effectiveDate: dto.effectiveDate, transferType: dto.transferType, reason: dto.reason }, batchNumber);
        const posted = dto.post ? await this.post(tenantId, membershipId, userId, doc.id) : null;
        results.push({ line: i + 1, employmentId: line.employmentId, ok: true, documentId: doc.id, number: doc.number, posted: !!posted, warnings: posted?.warnings ?? [] });
      } catch (e) {
        const err = e as AppError;
        results.push({ line: i + 1, employmentId: line.employmentId, ok: false, code: err.code ?? 'ERROR', message: err.message });
      }
    }
    return { batchNumber, total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
}
