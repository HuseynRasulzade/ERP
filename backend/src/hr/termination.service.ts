import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentLinkService } from '../document-link/document-link.service';
import { AppError, ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateTerminationDto } from './dto/hr.dto';
import { EffectiveTimeline } from './effective-timeline';
import { EMPLOYED_STATUSES, HrCatalogType, HrDocType, HrEventType } from './hr.constants';
import { addDays, daysBetween, fmtHr, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrDocumentLifecycleService } from './hr-document-lifecycle.service';
import { HrEventService } from './hr-event.service';
import { HrHistoryService } from './hr-history.service';
import { HrNumberingService } from './hr-numbering.service';
import { HrPolicyService } from './hr-policy.service';
import { HrIssues } from './hr-validation.service';
import { EmploymentService } from './employment.service';

/**
 * TerminationService (spec 43-46, 49, 75, 105, 135). POST closes the
 * assignment, schedule and status histories at the termination date (the
 * last day of employment), appends a TERMINATED status from the next day
 * and sets the employment end date — the PhysicalPerson, Employee and every
 * historical row stay (spec 46/128). Reversal ("termination cancellation",
 * spec 49) reopens them, blocked if a downstream consumer finalized the
 * period (final settlement) or a rehire already builds on it.
 */
@Injectable()
export class TerminationService {
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
    private readonly employments: EmploymentService,
  ) {}

  async create(tenantId: string, membershipId: string, userId: string, dto: CreateTerminationDto) {
    const emp = await this.employments.assertAccess(tenantId, membershipId, dto.employmentId);
    await this.policy.assertCatalogCode(tenantId, HrCatalogType.TERMINATION_REASON, dto.terminationReasonCode);
    const terminationDate = parseHrDate(dto.terminationDate, 'terminationDate');
    const lastWorkingDate = parseOptionalHrDate(dto.lastWorkingDate, 'lastWorkingDate') ?? terminationDate;
    if (lastWorkingDate > terminationDate) throw new ValidationAppError('Last working date cannot be after the termination date');
    const documentDate = parseOptionalHrDate(dto.documentDate, 'documentDate') ?? todayHr();
    await this.numbering.ensure(tenantId, 'HR_TERMINATION');
    return this.prisma.runInTransaction(async (tx) => {
      const number = await this.numbering.next(tx, tenantId, 'HR_TERMINATION', documentDate);
      const doc = await tx.terminationDocument.create({
        data: {
          tenantId,
          organizationId: emp.organizationId,
          number,
          documentDate,
          employmentId: emp.id,
          terminationDate,
          lastWorkingDate,
          terminationReasonCode: dto.terminationReasonCode,
          legalBasis: dto.legalBasis,
          noticeDate: parseOptionalHrDate(dto.noticeDate, 'noticeDate'),
          finalScheduleDate: parseOptionalHrDate(dto.finalScheduleDate, 'finalScheduleDate'),
          responsibleHrUserId: dto.responsibleHrUserId ?? userId,
          comment: dto.comment,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'HR_TERMINATION_CREATED', entityType: HrDocType.TERMINATION, entityId: doc.id, action: 'CREATE', userId, newValues: { number, employmentId: emp.id, terminationDate: isoHr(terminationDate), reason: dto.terminationReasonCode } }, tx);
      return doc;
    });
  }

  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; status?: string; employmentId?: string }) {
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    return this.prisma.terminationDocument.findMany({
      where: { tenantId, organizationId: { in: orgIds }, ...(filter.status ? { status: filter.status } : {}), ...(filter.employmentId ? { employmentId: filter.employmentId } : {}) },
      orderBy: [{ terminationDate: 'desc' }, { number: 'desc' }],
      take: 1000,
    });
  }

  async get(tenantId: string, membershipId: string, id: string) {
    const doc = await this.prisma.terminationDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundAppError('TerminationDocument', id);
    await this.access.assertAccess(tenantId, membershipId, doc.organizationId);
    return doc;
  }

  private async evaluate(db: PrismaTransactionClient, doc: any, issues: HrIssues) {
    const emp = await db.employment.findFirst({ where: { id: doc.employmentId, tenantId: doc.tenantId }, include: { employee: { include: { physicalPerson: { select: { fullName: true } } } } } });
    if (!emp) throw new NotFoundAppError('Employment', doc.employmentId);
    const T: Date = doc.terminationDate;
    if (emp.status !== 'ACTIVE') issues.error(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, 'A cancelled employment cannot be terminated');
    if (emp.employmentEndDate) issues.error(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `Employment is already terminated effective ${fmtHr(emp.employmentEndDate)}`);
    if (T < emp.employmentStartDate) {
      issues.error(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `Employee cannot be terminated on ${fmtHr(T)} because employment starts on ${fmtHr(emp.employmentStartDate)}.`);
    } else {
      const status = await this.history.statusAt(emp, T, db);
      if (!EMPLOYED_STATUSES.includes(status)) issues.error(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `Employment is ${status} on ${fmtHr(T)}`);
    }
    if (doc.lastWorkingDate < emp.employmentStartDate) issues.error(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `Last working date ${fmtHr(doc.lastWorkingDate)} is before the employment start ${fmtHr(emp.employmentStartDate)}`);

    // Future-dated dependencies (spec 75): changes already recorded after T.
    for (const [model, label] of [['employeeAssignment', 'assignment'], ['workScheduleAssignment', 'work schedule'], ['employmentStatusHistory', 'status']] as const) {
      const later = await new EffectiveTimeline(db, model).later(emp.id, T);
      if (later) issues.error(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, `A future ${label} change effective ${fmtHr(later.effectiveFrom)} exists after the termination date ${fmtHr(T)}; reverse it first`);
    }
    const [openLeave, openAbsence, openTrips, reports] = await Promise.all([
      db.leaveRecord.findMany({ where: { employmentId: emp.id, status: { in: ['REQUESTED', 'APPROVED'] }, endDate: { gt: T } } }),
      db.absenceRecord.findMany({ where: { employmentId: emp.id, status: { not: 'CANCELLED' }, endDate: { gt: T } } }),
      db.businessTrip.findMany({ where: { employmentId: emp.id, status: { in: ['PLANNED', 'APPROVED'] }, endDate: { gt: T } } }),
      db.employeeAssignment.findMany({ where: { managerEmploymentId: emp.id, recordStatus: 'ACTIVE', OR: [{ effectiveTo: null }, { effectiveTo: { gt: T } }] }, select: { employmentId: true } }),
    ]);
    for (const l of openLeave) issues.warn('HR_OPEN_LEAVE', `Leave ${l.leaveTypeCode} ${fmtHr(l.startDate)}–${fmtHr(l.endDate)} extends beyond the termination date`);
    for (const a of openAbsence) issues.warn('HR_OPEN_ABSENCE', `Absence ${a.absenceTypeCode} ${fmtHr(a.startDate)}–${fmtHr(a.endDate)} extends beyond the termination date`);
    for (const t of openTrips) issues.warn('HR_OPEN_BUSINESS_TRIP', `Business trip to ${t.destination} ends ${fmtHr(t.endDate)}, after the termination date`);
    const directReports = new Set(reports.map((r) => r.employmentId)).size;
    if (directReports) issues.warn('HR_DIRECT_REPORTS', `${directReports} employment(s) still report to this employment after ${fmtHr(T)}; reassign their manager`);
    const schedule = await new EffectiveTimeline(db, 'workScheduleAssignment').covering(emp.id, T);
    const contract = await db.employmentContract.findFirst({ where: { employmentId: emp.id, status: 'ACTIVE' } });
    return { emp, openLeave, openAbsence, openTrips, schedule, contract, directReports };
  }

  /** Termination preview (spec 66/105): status after date, open leave /
   * absence, future schedule, downstream and final-payroll indicators. */
  async preview(tenantId: string, membershipId: string, id: string) {
    const doc = await this.get(tenantId, membershipId, id);
    const issues = new HrIssues();
    let r: any = null;
    try {
      await this.policy.assertHrDateOpen(tenantId, doc.organizationId, doc.terminationDate);
      await this.events.assertNotFinalized(tenantId, doc.employmentId, doc.terminationDate);
      r = await this.evaluate(this.prisma, doc, issues);
    } catch (e) {
      if (e instanceof AppError) issues.error(e.code, e.message);
      else throw e;
    }
    return {
      valid: issues.errors.length === 0,
      issues: issues.items,
      terminationDate: isoHr(doc.terminationDate),
      lastWorkingDate: isoHr(doc.lastWorkingDate),
      statusOnTerminationDate: 'ACTIVE',
      statusAfterTerminationDate: 'TERMINATED',
      firstDayWithoutEmployment: isoHr(addDays(doc.terminationDate, 1)),
      contract: r?.contract ? { id: r.contract.id, contractNumber: r.contract.contractNumber, effectiveTo: isoHr(r.contract.effectiveTo) } : null,
      currentSchedule: r?.schedule ? { workScheduleId: r.schedule.workScheduleId, closesOn: isoHr(doc.terminationDate) } : null,
      openLeave: r?.openLeave ?? [],
      openAbsences: r?.openAbsence ?? [],
      openBusinessTrips: r?.openTrips ?? [],
      directReports: r?.directReports ?? 0,
      finalPayrollDependency: { required: true, note: 'Final settlement is calculated by Phase 19 Payroll from this termination event; once finalized, reversal is blocked.' },
      backdated: doc.terminationDate < todayHr(),
    };
  }

  async post(tenantId: string, membershipId: string, userId: string, id: string, expectedVersion?: number) {
    const head = await this.get(tenantId, membershipId, id);
    const policy = await this.policy.getPolicy(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lifecycle.lock(tx, 'terminationDocument', tenantId, id);
      if (this.lifecycle.assertPostable(doc, policy, expectedVersion) === 'ALREADY_POSTED') {
        return { alreadyPosted: true, document: doc, warnings: doc.warnings ?? [] };
      }
      const T: Date = doc.terminationDate;
      await this.policy.assertHrDateOpen(tenantId, head.organizationId, T, tx);
      const emp = await this.employments.lock(tx, tenantId, doc.employmentId);
      await this.events.assertNotFinalized(tenantId, emp.id, T);
      const issues = new HrIssues();
      const r = await this.evaluate(tx, doc, issues);
      issues.throwIfErrors();

      await new EffectiveTimeline(tx, 'employeeAssignment', { isSecondary: false }).closeAt(emp.id, T);
      await tx.employeeAssignment.updateMany({ where: { employmentId: emp.id, isSecondary: true, recordStatus: 'ACTIVE', OR: [{ effectiveTo: null }, { effectiveTo: { gt: T } }] }, data: { effectiveTo: T } });
      const closedSchedule = await new EffectiveTimeline(tx, 'workScheduleAssignment').closeAt(emp.id, T);
      const statusTimeline = new EffectiveTimeline(tx, 'employmentStatusHistory');
      const statusRow = await statusTimeline.closeAt(emp.id, T);
      await statusTimeline.insertInitial(emp.id, {
        tenantId,
        status: 'TERMINATED',
        effectiveFrom: addDays(T, 1),
        reason: doc.terminationReasonCode,
        sourceDocumentType: HrDocType.TERMINATION,
        sourceDocumentId: id,
        createdBy: userId,
      });
      const contractSnapshot = r.contract ? { id: r.contract.id, effectiveTo: isoHr(r.contract.effectiveTo), status: r.contract.status } : null;
      if (r.contract) {
        await tx.employmentContract.update({ where: { id: r.contract.id }, data: { status: 'TERMINATED', effectiveTo: !r.contract.effectiveTo || r.contract.effectiveTo > T ? T : r.contract.effectiveTo, updatedBy: userId, version: { increment: 1 } } });
        await tx.employmentContractVersion.updateMany({ where: { contractId: r.contract.id, OR: [{ effectiveTo: null }, { effectiveTo: { gt: T } }], effectiveFrom: { lte: T } }, data: { effectiveTo: T } });
      }
      await tx.employment.update({ where: { id: emp.id }, data: { employmentEndDate: T, terminationReasonCode: doc.terminationReasonCode, updatedBy: userId } });
      await this.employments.refreshProjection(tx, tenantId, emp.id);
      await this.employments.refreshEmployee(tx, tenantId, emp.employeeId);

      const warnings = issues.warnings;
      const posted = await tx.terminationDocument.update({
        where: { id },
        data: {
          status: 'POSTED',
          warnings: warnings as any,
          postingSnapshot: { contract: contractSnapshot, scheduleClosed: closedSchedule ? { id: closedSchedule.id, effectiveTo: isoHr(closedSchedule.effectiveTo) } : null, statusClosed: statusRow ? { id: statusRow.id, effectiveTo: isoHr(statusRow.effectiveTo) } : null } as any,
          postedAt: new Date(),
          postedBy: userId,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      await this.links.createLink(tenantId, { sourceDocumentType: HrDocType.TERMINATION, sourceDocumentId: id, targetDocumentType: HrDocType.EMPLOYMENT, targetDocumentId: emp.id, relationType: 'RELATED', createdBy: userId }, tx);
      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: T, sourceDocumentType: HrDocType.TERMINATION, sourceDocumentId: id };
      await this.events.emit(tx, {
        ...base,
        eventType: HrEventType.EMPLOYEE_TERMINATED,
        oldState: { status: 'ACTIVE' },
        newState: { status: 'TERMINATED', terminationDate: isoHr(T), lastWorkingDate: isoHr(doc.lastWorkingDate), reason: doc.terminationReasonCode },
        extra: { final_payroll_required: true, service_length_days: daysBetween(emp.employmentStartDate, T) + 1 },
      });
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: 'TERMINATION' });
      await this.audit.record(
        { tenantId, eventType: 'HR_TERMINATION_POSTED', entityType: HrDocType.TERMINATION, entityId: id, action: 'POST', userId, oldValues: { employmentEndDate: null }, newValues: { employmentEndDate: isoHr(T), reason: doc.terminationReasonCode, warnings: warnings.length } },
        tx,
      );
      return { alreadyPosted: false, document: posted, warnings };
    });
  }

  /** Termination cancellation (spec 49): controlled reversal. */
  async reverse(tenantId: string, membershipId: string, userId: string, id: string, reason?: string) {
    const head = await this.get(tenantId, membershipId, id);
    if (!reason) throw new ValidationAppError('A reason is required to reverse a posted termination');
    if (head.status !== 'POSTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Only a POSTED termination can be reversed (status ${head.status})`, 409);
    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lifecycle.lock(tx, 'terminationDocument', tenantId, id);
      if (doc.status !== 'POSTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Only a POSTED termination can be reversed (status ${doc.status})`, 409);
      const T: Date = doc.terminationDate;
      const emp = await this.employments.lock(tx, tenantId, doc.employmentId);
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, T, tx);
      // Final settlement already processed downstream -> blocked (spec 49).
      await this.events.assertNotFinalized(tenantId, emp.id, T);
      const rehire = await tx.hireDocument.findFirst({ where: { tenantId, previousEmploymentId: emp.id, status: 'POSTED' } });
      if (rehire) throw new HrRuleError(ErrorCode.HR_DOWNSTREAM_DEPENDENCY, `The termination cannot be reversed because rehire ${rehire.number} is based on it; reverse the rehire first`, 409);

      const snap = (doc.postingSnapshot ?? {}) as any;
      await new EffectiveTimeline(tx, 'employmentStatusHistory').reverseSource(emp.id, HrDocType.TERMINATION, id);
      await new EffectiveTimeline(tx, 'employeeAssignment', { isSecondary: false }).reopenClosedAt(emp.id, T, null);
      if (snap.scheduleClosed) await tx.workScheduleAssignment.update({ where: { id: snap.scheduleClosed.id }, data: { effectiveTo: null } });
      if (snap.statusClosed) await tx.employmentStatusHistory.update({ where: { id: snap.statusClosed.id }, data: { effectiveTo: null } });
      if (snap.contract) {
        await tx.employmentContract.update({ where: { id: snap.contract.id }, data: { status: 'ACTIVE', effectiveTo: parseOptionalHrDate(snap.contract.effectiveTo), version: { increment: 1 } } });
        const lastVersion = await tx.employmentContractVersion.findFirst({ where: { contractId: snap.contract.id }, orderBy: { versionNumber: 'desc' } });
        if (lastVersion) await tx.employmentContractVersion.update({ where: { id: lastVersion.id }, data: { effectiveTo: parseOptionalHrDate(snap.contract.effectiveTo) } });
      }
      await tx.employment.update({ where: { id: emp.id }, data: { employmentEndDate: null, terminationReasonCode: null, updatedBy: userId } });
      await this.employments.refreshProjection(tx, tenantId, emp.id);
      await this.employments.refreshEmployee(tx, tenantId, emp.employeeId);
      const updated = await tx.terminationDocument.update({ where: { id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, reversalReason: reason, version: { increment: 1 } } });
      await this.links.createLink(tenantId, { sourceDocumentType: HrDocType.TERMINATION, sourceDocumentId: id, targetDocumentType: HrDocType.EMPLOYMENT, targetDocumentId: emp.id, relationType: 'REVERSAL_OF', createdBy: userId, metadata: { reason } }, tx);
      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: T, sourceDocumentType: HrDocType.TERMINATION, sourceDocumentId: id };
      await this.events.emit(tx, { ...base, eventType: HrEventType.EMPLOYEE_TERMINATION_REVERSED, oldState: { status: 'TERMINATED', terminationDate: isoHr(T) }, newState: { status: 'ACTIVE' } });
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: 'TERMINATION_REVERSAL' });
      await this.audit.record({ tenantId, eventType: 'HR_TERMINATION_REVERSED', entityType: HrDocType.TERMINATION, entityId: id, action: 'REVERSE', userId, reason, oldValues: { employmentEndDate: isoHr(T) }, newValues: { employmentEndDate: null } }, tx);
      return updated;
    });
  }
}
