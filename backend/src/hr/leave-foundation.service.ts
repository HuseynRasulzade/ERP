import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictAppError, ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateAbsenceDto, CreateBusinessTripDto, CreateLeaveDto } from './dto/hr.dto';
import { HrCatalogType, HrDocType, HrEventType } from './hr.constants';
import { fmtHr, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrEventService } from './hr-event.service';
import { HrPolicyService } from './hr-policy.service';
import { EmploymentService } from './employment.service';

/** Checks [start, end] lies inside the employment period. */
function assertWithinEmployment(emp: { employmentStartDate: Date; employmentEndDate: Date | null; status: string }, start: Date, end: Date, what: string) {
  if (end < start) throw new ValidationAppError(`${what} end date must be on or after its start date`);
  if (emp.status !== 'ACTIVE') throw new HrRuleError(ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE, `${what} cannot be registered for a cancelled employment`);
  if (start < emp.employmentStartDate || (emp.employmentEndDate && end > emp.employmentEndDate)) {
    throw new HrRuleError(
      ErrorCode.HR_EMPLOYMENT_NOT_ACTIVE,
      `${what} ${fmtHr(start)}–${fmtHr(end)} is outside the employment period ${fmtHr(emp.employmentStartDate)} – ${emp.employmentEndDate ? fmtHr(emp.employmentEndDate) : 'open'}`,
    );
  }
}

/**
 * LeaveFoundationService (spec 38/39/97). Records only — entitlement and
 * balance calculations are Phase 18/19. An APPROVED leave overlays the
 * employment status as ON_LEAVE for its dates (the employment is never
 * terminated or suspended by a leave).
 */
@Injectable()
export class LeaveFoundationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: HrEventService,
    private readonly policy: HrPolicyService,
    private readonly employments: EmploymentService,
  ) {}

  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; employmentId?: string; status?: string; from?: string; to?: string }) {
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    const from = parseOptionalHrDate(filter.from, 'from');
    const to = parseOptionalHrDate(filter.to, 'to');
    return this.prisma.leaveRecord.findMany({
      where: {
        tenantId,
        organizationId: { in: orgIds },
        ...(filter.employmentId ? { employmentId: filter.employmentId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(to ? { startDate: { lte: to } } : {}),
        ...(from ? { endDate: { gte: from } } : {}),
      },
      orderBy: { startDate: 'desc' },
      take: 1000,
    });
  }

  async create(tenantId: string, membershipId: string, userId: string, dto: CreateLeaveDto) {
    const emp = await this.employments.assertAccess(tenantId, membershipId, dto.employmentId);
    await this.policy.assertCatalogCode(tenantId, HrCatalogType.LEAVE_TYPE, dto.leaveTypeCode);
    const start = parseHrDate(dto.startDate, 'startDate');
    const end = parseHrDate(dto.endDate, 'endDate');
    assertWithinEmployment(emp, start, end, 'Leave');
    const overlap = await this.prisma.leaveRecord.findFirst({ where: { employmentId: emp.id, status: { in: ['REQUESTED', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } } });
    if (overlap) throw new ConflictAppError(`Leave overlaps an existing ${overlap.status.toLowerCase()} leave ${fmtHr(overlap.startDate)}–${fmtHr(overlap.endDate)}`);
    const row = await this.prisma.leaveRecord.create({
      data: { tenantId, organizationId: emp.organizationId, employmentId: emp.id, leaveTypeCode: dto.leaveTypeCode, startDate: start, endDate: end, requestDate: parseOptionalHrDate(dto.requestDate, 'requestDate') ?? todayHr(), comment: dto.comment, createdBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'HR_LEAVE_REQUESTED', entityType: HrDocType.LEAVE, entityId: row.id, action: 'CREATE', userId, newValues: { employmentId: emp.id, leaveTypeCode: dto.leaveTypeCode, startDate: dto.startDate, endDate: dto.endDate } });
    return row;
  }

  async approve(tenantId: string, membershipId: string, userId: string, id: string) {
    const leave = await this.prisma.leaveRecord.findFirst({ where: { id, tenantId } });
    if (!leave) throw new NotFoundAppError('LeaveRecord', id);
    const emp = await this.employments.assertAccess(tenantId, membershipId, leave.employmentId);
    if (leave.status !== 'REQUESTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Leave is ${leave.status}; only a REQUESTED leave can be approved`, 409);
    return this.prisma.runInTransaction(async (tx) => {
      await this.employments.lock(tx, tenantId, emp.id);
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, leave.startDate, tx);
      const res = await tx.leaveRecord.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId, version: { increment: 1 } } });
      if (res.count !== 1) throw new ConflictAppError('Leave was changed concurrently');
      await this.employments.refreshProjection(tx, tenantId, emp.id);
      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: leave.startDate, sourceDocumentType: HrDocType.LEAVE, sourceDocumentId: id };
      await this.events.emit(tx, { ...base, eventType: HrEventType.EMPLOYEE_LEAVE_REGISTERED, newState: { leaveTypeCode: leave.leaveTypeCode, startDate: isoHr(leave.startDate), endDate: isoHr(leave.endDate), status: 'APPROVED' } });
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: 'LEAVE' });
      await this.audit.record({ tenantId, eventType: 'HR_LEAVE_REGISTERED', entityType: HrDocType.LEAVE, entityId: id, action: 'APPROVE', userId, oldValues: { status: 'REQUESTED' }, newValues: { status: 'APPROVED' } }, tx);
      return tx.leaveRecord.findUnique({ where: { id } });
    });
  }

  async setStatus(tenantId: string, membershipId: string, userId: string, id: string, status: 'REJECTED' | 'CANCELLED') {
    const leave = await this.prisma.leaveRecord.findFirst({ where: { id, tenantId } });
    if (!leave) throw new NotFoundAppError('LeaveRecord', id);
    const emp = await this.employments.assertAccess(tenantId, membershipId, leave.employmentId);
    const allowed = status === 'REJECTED' ? ['REQUESTED'] : ['REQUESTED', 'APPROVED'];
    if (!allowed.includes(leave.status)) throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Leave is ${leave.status}; cannot set ${status}`, 409);
    return this.prisma.runInTransaction(async (tx) => {
      await this.employments.lock(tx, tenantId, emp.id);
      const row = await tx.leaveRecord.update({ where: { id }, data: { status, version: { increment: 1 } } });
      await this.employments.refreshProjection(tx, tenantId, emp.id);
      if (leave.status === 'APPROVED') {
        await this.events.signalRecalculationIfNeeded(tx, { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: leave.startDate, sourceDocumentType: HrDocType.LEAVE, sourceDocumentId: id, changeType: 'LEAVE_CANCELLED' });
      }
      await this.audit.record({ tenantId, eventType: `HR_LEAVE_${status}`, entityType: HrDocType.LEAVE, entityId: id, action: status, userId, oldValues: { status: leave.status }, newValues: { status } }, tx);
      return row;
    });
  }
}

/** AbsenceService (spec 40) + business-trip foundation (spec 41). */
@Injectable()
export class AbsenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: HrEventService,
    private readonly policy: HrPolicyService,
    private readonly employments: EmploymentService,
  ) {}

  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; employmentId?: string; status?: string }) {
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    return this.prisma.absenceRecord.findMany({
      where: { tenantId, organizationId: { in: orgIds }, ...(filter.employmentId ? { employmentId: filter.employmentId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { startDate: 'desc' },
      take: 1000,
    });
  }

  async create(tenantId: string, membershipId: string, userId: string, dto: CreateAbsenceDto) {
    const emp = await this.employments.assertAccess(tenantId, membershipId, dto.employmentId);
    await this.policy.assertCatalogCode(tenantId, HrCatalogType.ABSENCE_TYPE, dto.absenceTypeCode);
    const start = parseHrDate(dto.startDate, 'startDate');
    const end = parseHrDate(dto.endDate, 'endDate');
    assertWithinEmployment(emp, start, end, 'Absence');
    if (dto.hours !== undefined && start.getTime() !== end.getTime()) throw new ValidationAppError('Partial-day absence hours are only allowed for a single-day absence');
    return this.prisma.runInTransaction(async (tx) => {
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, start, tx);
      const row = await tx.absenceRecord.create({
        data: { tenantId, organizationId: emp.organizationId, employmentId: emp.id, absenceTypeCode: dto.absenceTypeCode, startDate: start, endDate: end, hours: dto.hours, reason: dto.reason, supportingDocument: dto.supportingDocument, createdBy: userId },
      });
      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: start, sourceDocumentType: HrDocType.ABSENCE, sourceDocumentId: row.id };
      await this.events.emit(tx, { ...base, eventType: HrEventType.EMPLOYEE_ABSENCE_REGISTERED, newState: { absenceTypeCode: dto.absenceTypeCode, startDate: dto.startDate, endDate: dto.endDate, hours: dto.hours ?? null } });
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: 'ABSENCE' });
      await this.audit.record({ tenantId, eventType: 'HR_ABSENCE_REGISTERED', entityType: HrDocType.ABSENCE, entityId: row.id, action: 'CREATE', userId, newValues: { employmentId: emp.id, absenceTypeCode: dto.absenceTypeCode, startDate: dto.startDate, endDate: dto.endDate } }, tx);
      return row;
    });
  }

  async cancel(tenantId: string, membershipId: string, userId: string, id: string) {
    const row = await this.prisma.absenceRecord.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('AbsenceRecord', id);
    await this.employments.assertAccess(tenantId, membershipId, row.employmentId);
    if (row.status === 'CANCELLED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, 'Absence is already cancelled', 409);
    const updated = await this.prisma.absenceRecord.update({ where: { id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'HR_ABSENCE_CANCELLED', entityType: HrDocType.ABSENCE, entityId: id, action: 'CANCEL', userId });
    return updated;
  }

  async listTrips(tenantId: string, membershipId: string, filter: { organizationId?: string; employmentId?: string }) {
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    return this.prisma.businessTrip.findMany({ where: { tenantId, organizationId: { in: orgIds }, ...(filter.employmentId ? { employmentId: filter.employmentId } : {}) }, orderBy: { startDate: 'desc' }, take: 1000 });
  }

  async createTrip(tenantId: string, membershipId: string, userId: string, dto: CreateBusinessTripDto) {
    const emp = await this.employments.assertAccess(tenantId, membershipId, dto.employmentId);
    const start = parseHrDate(dto.startDate, 'startDate');
    const end = parseHrDate(dto.endDate, 'endDate');
    assertWithinEmployment(emp, start, end, 'Business trip');
    const row = await this.prisma.businessTrip.create({ data: { tenantId, organizationId: emp.organizationId, employmentId: emp.id, destination: dto.destination, startDate: start, endDate: end, purpose: dto.purpose, createdBy: userId } });
    await this.audit.record({ tenantId, eventType: 'HR_BUSINESS_TRIP_CREATED', entityType: HrDocType.BUSINESS_TRIP, entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async setTripStatus(tenantId: string, membershipId: string, userId: string, id: string, status: 'APPROVED' | 'COMPLETED' | 'CANCELLED') {
    const row = await this.prisma.businessTrip.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('BusinessTrip', id);
    await this.employments.assertAccess(tenantId, membershipId, row.employmentId);
    if (row.status === 'CANCELLED' || row.status === 'COMPLETED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Business trip is ${row.status}`, 409);
    const updated = await this.prisma.businessTrip.update({ where: { id }, data: { status, version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: `HR_BUSINESS_TRIP_${status}`, entityType: HrDocType.BUSINESS_TRIP, entityId: id, action: status, userId, oldValues: { status: row.status }, newValues: { status } });
    return updated;
  }
}
