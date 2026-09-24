import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { DocumentLinkService } from '../document-link/document-link.service';
import { AppError, ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { BulkHireDto, CreateHireDto, CreateRehireDto, HireTermsDto } from './dto/hr.dto';
import { EffectiveTimeline } from './effective-timeline';
import { HrDocType, HrEventType, HrPolicy } from './hr.constants';
import { addDays, fmtHr, isoHr, parseHrDate, parseOptionalHrDate, rangesOverlapHr, todayHr } from './hr-date.util';
import { HrDocumentLifecycleService } from './hr-document-lifecycle.service';
import { HrEventService } from './hr-event.service';
import { HrNumberingService } from './hr-numbering.service';
import { HrPolicyService } from './hr-policy.service';
import { HrSecurityService } from './hr-security.service';
import { HrIssues, HrValidationService } from './hr-validation.service';
import { EmploymentContractService } from './employment-contract.service';
import { EmploymentService } from './employment.service';

/**
 * HireService (spec 19-21, 47/48, 85, 127/129/131/140) — also the RehireService
 * core: a rehire is a HireDocument with isRehire = true that always creates
 * a NEW Employment (the old one is never reopened, spec 47/146).
 *
 * POST, in one transaction: lock document -> idempotent replay if already
 * POSTED -> lock employee -> validate person / duplicate & primary
 * employment / FTE / department / position / staffing validity & capacity /
 * manager / contract -> create Employment -> initial EmployeeAssignment ->
 * WorkScheduleAssignment -> EmploymentStatusHistory -> attach contract ->
 * projections -> document links -> outbox events -> audit -> COMMIT.
 * Hire date may be in the future: the employment is PLANNED until then
 * (spec 21) — derived at query time, no job needed.
 */
@Injectable()
export class HireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly links: DocumentLinkService,
    private readonly numbering: HrNumberingService,
    private readonly lifecycle: HrDocumentLifecycleService,
    private readonly events: HrEventService,
    private readonly policy: HrPolicyService,
    private readonly security: HrSecurityService,
    private readonly validation: HrValidationService,
    private readonly contracts: EmploymentContractService,
    private readonly employments: EmploymentService,
  ) {}

  // ------------------------------------------------------------- create

  async create(tenantId: string, membershipId: string, userId: string, dto: CreateHireDto) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    return this.createDocument(tenantId, userId, dto.organizationId, dto.employeeId, dto, { isRehire: false });
  }

  async createRehire(tenantId: string, membershipId: string, userId: string, dto: CreateRehireDto) {
    const previous = await this.prisma.employment.findFirst({ where: { id: dto.previousEmploymentId, tenantId } });
    if (!previous) throw new NotFoundAppError('Employment', dto.previousEmploymentId);
    await this.access.assertAccess(tenantId, membershipId, previous.organizationId);
    const organizationId = dto.organizationId ?? previous.organizationId;
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (previous.status === 'CANCELLED') throw new ValidationAppError('The previous employment was cancelled; use a normal hire');
    return this.createDocument(tenantId, userId, organizationId, previous.employeeId, dto, { isRehire: true, previousEmploymentId: previous.id });
  }

  private async createDocument(tenantId: string, userId: string, organizationId: string, employeeId: string, dto: HireTermsDto, kind: { isRehire: boolean; previousEmploymentId?: string }) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId }, include: { physicalPerson: true } });
    if (!employee) throw new NotFoundAppError('Employee', employeeId);
    const hireDate = parseHrDate(dto.hireDate, 'hireDate');
    const documentDate = parseOptionalHrDate(dto.documentDate, 'documentDate') ?? todayHr();
    if (dto.contractId && dto.contract) throw new ValidationAppError('Provide contractId OR an inline contract, not both');

    let departmentId = dto.departmentId;
    let positionId = dto.positionId;
    let workScheduleId = dto.workScheduleId;
    let costCenter = dto.costCenter;
    let location = dto.location;
    let branchId = dto.branchId;
    if (dto.staffingPositionId) {
      const sp = await this.prisma.staffingPosition.findFirst({ where: { id: dto.staffingPositionId, tenantId, organizationId } });
      if (!sp) throw new ValidationAppError('Staffing position does not belong to this organization');
      departmentId ??= sp.departmentId;
      positionId ??= sp.positionId;
      workScheduleId ??= sp.defaultWorkScheduleId ?? undefined;
      costCenter ??= sp.costCenter ?? undefined;
      location ??= sp.location ?? undefined;
      branchId ??= sp.branchId ?? undefined;
    }
    if (!departmentId || !positionId) throw new ValidationAppError('departmentId and positionId are required (or a staffingPositionId to derive them from)');

    await this.numbering.ensure(tenantId, 'HR_HIRE');
    if (dto.contract && !dto.contract.contractNumber) await this.numbering.ensure(tenantId, 'HR_CONTRACT');
    return this.prisma.runInTransaction(async (tx) => {
      let contractId = dto.contractId ?? null;
      let probationEndDate = parseOptionalHrDate(dto.probationEndDate, 'probationEndDate');
      if (dto.contract) {
        const contract = await this.contracts.createInTx(tx, tenantId, userId, organizationId, employeeId, hireDate, dto.contract);
        contractId = contract.id;
        if (!probationEndDate && dto.contract.probationPeriodDays) probationEndDate = addDays(hireDate, dto.contract.probationPeriodDays - 1);
      }
      const number = await this.numbering.next(tx, tenantId, 'HR_HIRE', documentDate);
      const doc = await tx.hireDocument.create({
        data: {
          tenantId,
          organizationId,
          documentType: kind.isRehire ? HrDocType.REHIRE : HrDocType.HIRE,
          number,
          documentDate,
          hireDate,
          isRehire: kind.isRehire,
          previousEmploymentId: kind.previousEmploymentId,
          physicalPersonId: employee.physicalPersonId,
          employeeId,
          employmentType: dto.employmentType,
          primaryEmployment: dto.primaryEmployment ?? true,
          contractId,
          departmentId,
          positionId,
          staffingPositionId: dto.staffingPositionId,
          branchId,
          managerEmploymentId: dto.managerEmploymentId,
          workScheduleId,
          fte: dto.fte ?? 1,
          probationEndDate,
          location,
          costCenter,
          project: dto.project,
          responsibleHrUserId: dto.responsibleHrUserId ?? userId,
          overrideStaffingLimit: dto.overrideStaffingLimit ?? false,
          comment: dto.comment,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      if (contractId) {
        await this.links.createLink(tenantId, { sourceDocumentType: doc.documentType, sourceDocumentId: doc.id, targetDocumentType: HrDocType.CONTRACT, targetDocumentId: contractId, relationType: 'RELATED', createdBy: userId }, tx);
      }
      if (kind.previousEmploymentId) {
        await this.links.createLink(tenantId, { sourceDocumentType: HrDocType.EMPLOYMENT, sourceDocumentId: kind.previousEmploymentId, targetDocumentType: HrDocType.REHIRE, targetDocumentId: doc.id, relationType: 'RELATED', createdBy: userId }, tx);
      }
      await this.audit.record({ tenantId, eventType: kind.isRehire ? 'HR_REHIRE_CREATED' : 'HR_HIRE_CREATED', entityType: doc.documentType, entityId: doc.id, action: 'CREATE', userId, newValues: { number, hireDate: isoHr(hireDate), employeeId } }, tx);
      return doc;
    });
  }

  // ------------------------------------------------------------- reads

  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; status?: string; isRehire?: string; employeeId?: string }) {
    const orgIds = await this.employments.accessibleOrgIds(tenantId, membershipId, filter.organizationId);
    return this.prisma.hireDocument.findMany({
      where: {
        tenantId,
        organizationId: { in: orgIds },
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.isRehire !== undefined ? { isRehire: filter.isRehire === 'true' } : {}),
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      },
      orderBy: [{ documentDate: 'desc' }, { number: 'desc' }],
      take: 1000,
    });
  }

  async get(tenantId: string, membershipId: string, id: string) {
    const doc = await this.prisma.hireDocument.findFirst({ where: { id, tenantId } });
    if (!doc) throw new NotFoundAppError('HireDocument', id);
    await this.access.assertAccess(tenantId, membershipId, doc.organizationId);
    const [employee, links] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: doc.employeeId }, include: { physicalPerson: true } }),
      this.links.listForDocument(tenantId, doc.documentType, doc.id),
    ]);
    return { ...doc, employee: employee ? { ...employee, physicalPerson: this.security.redactPerson(employee.physicalPerson) } : null, links };
  }

  // ------------------------------------------------------------- validation

  private async evaluate(db: PrismaTransactionClient, doc: any, policy: HrPolicy, issues: HrIssues) {
    const tenantId = doc.tenantId;
    const hireDate: Date = doc.hireDate;
    const fte = Number(doc.fte.toString());

    const employee = await db.employee.findFirst({ where: { id: doc.employeeId, tenantId }, include: { physicalPerson: true } });
    if (!employee) throw new NotFoundAppError('Employee', doc.employeeId);
    if (!employee.physicalPerson.active) issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Physical person ${employee.physicalPerson.fullName} is inactive`);

    const department = await this.validation.department(db, doc.organizationId, doc.departmentId, hireDate, issues);
    const position = await this.validation.position(db, tenantId, doc.positionId, issues);
    if (doc.branchId) await this.validation.branch(db, doc.organizationId, doc.branchId, issues);
    const schedule = doc.workScheduleId ? await this.validation.schedule(db, tenantId, doc.workScheduleId, issues) : null;
    let staffing = null as any;
    if (doc.staffingPositionId) {
      staffing = await this.validation.staffingPosition(db, tenantId, doc.organizationId, doc.staffingPositionId, hireDate, issues);
      if (staffing.departmentId !== doc.departmentId || staffing.positionId !== doc.positionId) {
        issues.error(ErrorCode.HR_INACTIVE_REFERENCE, `Department/position do not match Staffing Position ${staffing.code}`);
      }
    }
    if (doc.managerEmploymentId) await this.validation.manager(db, tenantId, null, doc.managerEmploymentId, hireDate, issues);

    // Duplicate / primary / rehire rules (spec 30, 67, 76).
    const others = await db.employment.findMany({ where: { tenantId, employeeId: doc.employeeId, status: 'ACTIVE' } });
    const overlapping = others.filter((e) => rangesOverlapHr(e.employmentStartDate, e.employmentEndDate, hireDate, null));
    if (doc.isRehire) {
      const prev = others.find((e) => e.id === doc.previousEmploymentId);
      if (!prev) issues.error(ErrorCode.HR_INVALID_EFFECTIVE_DATE, 'The previous employment of this rehire no longer exists or was cancelled');
      else if (!prev.employmentEndDate) {
        issues.error(ErrorCode.HR_DUPLICATE_EMPLOYMENT, `Previous employment (started ${fmtHr(prev.employmentStartDate)}) is still active; a rehire requires a terminated employment — use a parallel hire for legitimate multiple employment`);
      } else if (hireDate <= prev.employmentEndDate) {
        issues.error(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `Rehire date ${fmtHr(hireDate)} must be after the previous employment end date ${fmtHr(prev.employmentEndDate)}`);
      }
    }
    const sameKind = overlapping.filter((e) => e.organizationId === doc.organizationId && e.employmentType === doc.employmentType);
    if (sameKind.length && policy.duplicateEmploymentPolicy !== 'ALLOW') {
      const msg = `${employee.physicalPerson.fullName} already has an overlapping ${doc.employmentType} employment in this organization (from ${fmtHr(sameKind[0].employmentStartDate)})`;
      if (policy.duplicateEmploymentPolicy === 'BLOCK') issues.error(ErrorCode.HR_DUPLICATE_EMPLOYMENT, msg);
      else issues.warn(ErrorCode.HR_DUPLICATE_EMPLOYMENT, msg);
    }
    if (doc.primaryEmployment) {
      const primaries = overlapping.filter((e) => e.primaryEmployment && (policy.primaryEmploymentScope === 'TENANT' || e.organizationId === doc.organizationId));
      if (primaries.length) {
        issues.error(ErrorCode.HR_PRIMARY_EMPLOYMENT_CONFLICT, `${employee.physicalPerson.fullName} already has an active primary employment (from ${fmtHr(primaries[0].employmentStartDate)}); mark this hire as secondary`);
      }
    }

    // FTE after the identity-level rules so the most specific error wins.
    await this.validation.fte(db, tenantId, doc.employeeId, fte, hireDate, policy, issues);

    // Contract (spec 20 "validate contract", 126 message).
    let contract = null as any;
    if (!doc.contractId) {
      if (policy.requireContract) issues.error(ErrorCode.HR_CONTRACT_REQUIRED, 'Hire cannot be posted because no employment contract is attached.');
    } else {
      contract = await db.employmentContract.findFirst({ where: { id: doc.contractId, tenantId } });
      if (!contract || contract.status === 'CANCELLED') issues.error(ErrorCode.HR_CONTRACT_REQUIRED, 'Hire cannot be posted because the attached employment contract is missing or cancelled.');
      else {
        if (contract.employeeId !== doc.employeeId || contract.organizationId !== doc.organizationId) issues.error(ErrorCode.HR_CONTRACT_REQUIRED, `Contract ${contract.contractNumber} belongs to a different employee or organization`);
        if (contract.employmentId) issues.error(ErrorCode.HR_CONTRACT_REQUIRED, `Contract ${contract.contractNumber} is already attached to another employment`);
        if (contract.effectiveTo && contract.effectiveTo < hireDate) issues.error(ErrorCode.HR_CONTRACT_REQUIRED, `Contract ${contract.contractNumber} ends ${fmtHr(contract.effectiveTo)}, before the hire date ${fmtHr(hireDate)}`);
        if (policy.requireSignedContract && contract.signedStatus !== 'SIGNED') issues.error(ErrorCode.HR_CONTRACT_REQUIRED, `Contract ${contract.contractNumber} is not signed`);
        else if (contract.signedStatus !== 'SIGNED') issues.warn('HR_CONTRACT_UNSIGNED', `Contract ${contract.contractNumber} is not marked as signed`);
      }
    }

    let capacity = null as any;
    if (staffing) {
      await this.validation.capacity(
        db,
        {
          tenantId,
          staffingPosition: staffing,
          date: hireDate,
          fte,
          policy,
          overrideRequested: doc.overrideStaffingLimit,
          canOverride: this.security.can(PermissionCodes.HR_OVERRIDE_STAFFING_LIMIT),
          approved: doc.status === 'APPROVED',
        },
        issues,
      );
      const occ = await this.validation.occupancy(db, tenantId, doc.organizationId, staffing.code, hireDate);
      capacity = { code: staffing.code, headcountLimit: staffing.headcountLimit, fteLimit: Number(staffing.fteLimit.toString()), occupiedFteBefore: occ.fte, occupiedFteAfter: occ.fte + fte, occupiedHeadcountBefore: occ.headcount };
    }
    return { employee, department, position, schedule, staffing, contract, capacity };
  }

  /** Hire preview (spec 66): "New Employee State" + every issue, no writes. */
  async preview(tenantId: string, membershipId: string, id: string) {
    const doc = await this.get(tenantId, membershipId, id);
    const policy = await this.policy.getPolicy(tenantId);
    const issues = new HrIssues();
    let resolved: any = {};
    try {
      await this.policy.assertHrDateOpen(tenantId, doc.organizationId, doc.hireDate);
      resolved = await this.evaluate(this.prisma, doc, policy, issues);
    } catch (e) {
      if (e instanceof AppError) issues.error(e.code, e.message);
      else throw e;
    }
    const today = todayHr();
    return {
      valid: issues.errors.length === 0,
      issues: issues.items,
      newState: {
        employee: resolved.employee ? { id: resolved.employee.id, personnelNumber: resolved.employee.personnelNumber, fullName: resolved.employee.physicalPerson.fullName } : null,
        organizationId: doc.organizationId,
        employmentType: doc.employmentType,
        primaryEmployment: doc.primaryEmployment,
        hireDate: isoHr(doc.hireDate),
        statusToday: doc.hireDate > today ? 'PLANNED' : 'ACTIVE',
        statusFromHireDate: 'ACTIVE',
        department: resolved.department ? { id: resolved.department.id, name: resolved.department.name } : null,
        position: resolved.position ? { id: resolved.position.id, name: resolved.position.name } : null,
        staffingPosition: resolved.staffing ? { id: resolved.staffing.id, code: resolved.staffing.code } : null,
        workSchedule: resolved.schedule ? { id: resolved.schedule.id, name: resolved.schedule.name } : null,
        managerEmploymentId: doc.managerEmploymentId,
        fte: Number(doc.fte.toString()),
        probationEndDate: isoHr(doc.probationEndDate),
        contract: resolved.contract ? { id: resolved.contract.id, contractNumber: resolved.contract.contractNumber } : null,
        staffingCapacity: resolved.capacity ?? null,
      },
    };
  }

  // ------------------------------------------------------------- post

  async post(tenantId: string, membershipId: string, userId: string, id: string, expectedVersion?: number) {
    const head = await this.prisma.hireDocument.findFirst({ where: { id, tenantId } });
    if (!head) throw new NotFoundAppError('HireDocument', id);
    await this.access.assertAccess(tenantId, membershipId, head.organizationId);
    const policy = await this.policy.getPolicy(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lifecycle.lock(tx, 'hireDocument', tenantId, id);
      if (this.lifecycle.assertPostable(doc, policy, expectedVersion) === 'ALREADY_POSTED') {
        // Idempotent replay (spec 78/140): the same POST twice -> one employment.
        const employment = await tx.employment.findUnique({ where: { id: doc.employmentId } });
        return { alreadyPosted: true, document: doc, employment, warnings: doc.warnings ?? [] };
      }
      await this.policy.assertHrDateOpen(tenantId, doc.organizationId, doc.hireDate, tx);
      await this.employments.lockEmployee(tx, tenantId, doc.employeeId);

      const issues = new HrIssues();
      const resolved = await this.evaluate(tx, doc, policy, issues);
      issues.throwIfErrors();

      const hireDate: Date = doc.hireDate;
      const eventType = doc.isRehire ? 'REHIRE' : 'HIRE';
      const employment = await tx.employment.create({
        data: {
          tenantId,
          employeeId: doc.employeeId,
          organizationId: doc.organizationId,
          employmentType: doc.employmentType,
          employmentStatus: hireDate > todayHr() ? 'PLANNED' : 'ACTIVE',
          employmentStartDate: hireDate,
          primaryEmployment: doc.primaryEmployment,
          contractId: doc.contractId,
          staffingPositionId: doc.staffingPositionId,
          departmentId: doc.departmentId,
          positionId: doc.positionId,
          branchId: doc.branchId,
          managerEmploymentId: doc.managerEmploymentId,
          workScheduleId: doc.workScheduleId,
          fte: doc.fte,
          probationEndDate: doc.probationEndDate,
          location: doc.location,
          costCenter: doc.costCenter,
          project: doc.project,
          hireDocumentId: doc.id,
          rehireOfEmploymentId: doc.previousEmploymentId,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      const source = { sourceDocumentType: doc.documentType, sourceDocumentId: doc.id, createdBy: userId, tenantId };
      await new EffectiveTimeline(tx, 'employeeAssignment').insertInitial(employment.id, {
        ...source,
        effectiveFrom: hireDate,
        organizationId: doc.organizationId,
        departmentId: doc.departmentId,
        branchId: doc.branchId,
        positionId: doc.positionId,
        staffingPositionId: doc.staffingPositionId,
        managerEmploymentId: doc.managerEmploymentId,
        location: doc.location,
        fte: doc.fte,
        costCenter: doc.costCenter,
        project: doc.project,
        eventType,
        reason: doc.isRehire ? 'Rehire' : 'Hire',
      });
      if (doc.workScheduleId) {
        await new EffectiveTimeline(tx, 'workScheduleAssignment').insertInitial(employment.id, { ...source, effectiveFrom: hireDate, workScheduleId: doc.workScheduleId, reason: eventType });
      } else {
        issues.warn('HR_NO_SCHEDULE', 'No work schedule was assigned; Phase 18 cannot plan work time for this employment until one is set');
      }
      await new EffectiveTimeline(tx, 'employmentStatusHistory').insertInitial(employment.id, { ...source, effectiveFrom: hireDate, status: 'ACTIVE', reason: eventType });
      if (doc.contractId) {
        await tx.employmentContract.update({ where: { id: doc.contractId }, data: { employmentId: employment.id, status: 'ACTIVE', updatedBy: userId, version: { increment: 1 } } });
      }
      await this.employments.refreshProjection(tx, tenantId, employment.id);
      await this.employments.refreshEmployee(tx, tenantId, doc.employeeId);

      const warnings = issues.warnings;
      const posted = await tx.hireDocument.update({
        where: { id: doc.id },
        data: { status: 'POSTED', employmentId: employment.id, warnings: warnings as any, postingSnapshot: { employmentId: employment.id, contractId: doc.contractId } as any, postedAt: new Date(), postedBy: userId, updatedBy: userId, version: { increment: 1 } },
      });
      await this.links.createLink(tenantId, { sourceDocumentType: doc.documentType, sourceDocumentId: doc.id, targetDocumentType: HrDocType.EMPLOYMENT, targetDocumentId: employment.id, relationType: 'CREATED_BASED_ON', createdBy: userId }, tx);

      const newState = {
        employmentType: doc.employmentType,
        departmentId: doc.departmentId,
        positionId: doc.positionId,
        staffingPositionId: doc.staffingPositionId,
        managerEmploymentId: doc.managerEmploymentId,
        workScheduleId: doc.workScheduleId,
        fte: Number(doc.fte.toString()),
        costCenter: doc.costCenter,
        contractId: doc.contractId,
      };
      const eventBase = { tenantId, employeeId: doc.employeeId, employmentId: employment.id, organizationId: doc.organizationId, effectiveDate: hireDate, sourceDocumentType: doc.documentType, sourceDocumentId: doc.id };
      if (hireDate > todayHr()) await this.events.emit(tx, { ...eventBase, eventType: HrEventType.EMPLOYMENT_PLANNED, newState });
      await this.events.emit(tx, { ...eventBase, eventType: doc.isRehire ? HrEventType.EMPLOYEE_REHIRED : HrEventType.EMPLOYEE_HIRED, newState, extra: doc.isRehire ? { previous_employment_id: doc.previousEmploymentId } : undefined });
      await this.events.signalRecalculationIfNeeded(tx, { ...eventBase, changeType: eventType });

      await this.audit.record({ tenantId, eventType: 'HR_EMPLOYMENT_CREATED', entityType: HrDocType.EMPLOYMENT, entityId: employment.id, action: 'CREATE', userId, newValues: { ...newState, employmentStartDate: isoHr(hireDate) } }, tx);
      await this.audit.record(
        { tenantId, eventType: doc.isRehire ? 'HR_REHIRE_POSTED' : 'HR_HIRE_POSTED', entityType: doc.documentType, entityId: doc.id, action: 'POST', userId, newValues: { employmentId: employment.id, hireDate: isoHr(hireDate), warnings: warnings.length }, metadata: resolved.capacity ? { staffing: resolved.capacity } : undefined },
        tx,
      );
      return { alreadyPosted: false, document: posted, employment: await tx.employment.findUnique({ where: { id: employment.id } }), warnings };
    });
  }

  // ------------------------------------------------------------- reverse

  /** Hire cancellation after posting (correction workflow): only while no
   * later HR change exists; history rows become REVERSED, the employment
   * CANCELLED — nothing is deleted. */
  async reverse(tenantId: string, membershipId: string, userId: string, id: string, reason?: string) {
    const head = await this.get(tenantId, membershipId, id);
    if (head.status !== 'POSTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Only a POSTED hire can be reversed (status ${head.status})`, 409);
    if (!reason) throw new ValidationAppError('A reason is required to reverse a posted hire');
    return this.prisma.runInTransaction(async (tx) => {
      const doc = await this.lifecycle.lock(tx, 'hireDocument', tenantId, id);
      if (doc.status !== 'POSTED') throw new HrRuleError(ErrorCode.HR_DOCUMENT_STATE, `Only a POSTED hire can be reversed (status ${doc.status})`, 409);
      const emp = await this.employments.lock(tx, tenantId, doc.employmentId);
      await this.policy.assertHrDateOpen(tenantId, emp.organizationId, doc.hireDate, tx);
      await this.events.assertNotFinalized(tenantId, emp.id, doc.hireDate);
      const laterDocs = await Promise.all([
        tx.employeeTransfer.count({ where: { employmentId: emp.id, status: 'POSTED' } }),
        tx.terminationDocument.count({ where: { employmentId: emp.id, status: 'POSTED' } }),
        tx.employmentStatusHistory.count({ where: { employmentId: emp.id, recordStatus: 'ACTIVE', NOT: { sourceDocumentId: doc.id } } }),
        tx.workScheduleAssignment.count({ where: { employmentId: emp.id, recordStatus: 'ACTIVE', NOT: { sourceDocumentId: doc.id } } }),
      ]);
      if (laterDocs.some((n) => n > 0)) {
        throw new HrRuleError(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, 'The hire cannot be reversed because later HR changes (transfer, schedule change, suspension or termination) exist for this employment; reverse them first', 409);
      }
      const reports = await tx.employeeAssignment.count({ where: { managerEmploymentId: emp.id, recordStatus: 'ACTIVE' } });
      if (reports) throw new HrRuleError(ErrorCode.HR_EFFECTIVE_DATE_CONFLICT, 'The hire cannot be reversed because other employments report to this employment', 409);
      for (const m of ['employeeAssignment', 'workScheduleAssignment', 'employmentStatusHistory'] as const) {
        await (tx as any)[m].updateMany({ where: { employmentId: emp.id, sourceDocumentId: doc.id }, data: { recordStatus: 'REVERSED' } });
      }
      await tx.employment.update({ where: { id: emp.id }, data: { status: 'CANCELLED', employmentStatus: 'CANCELLED', updatedBy: userId, version: { increment: 1 } } });
      if (doc.contractId) await tx.employmentContract.update({ where: { id: doc.contractId }, data: { employmentId: null, status: 'DRAFT', version: { increment: 1 } } });
      await this.employments.refreshEmployee(tx, tenantId, emp.employeeId);
      const updated = await tx.hireDocument.update({ where: { id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, reversalReason: reason, version: { increment: 1 } } });
      const base = { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: doc.hireDate, sourceDocumentType: doc.documentType, sourceDocumentId: doc.id };
      await this.events.emit(tx, { ...base, eventType: HrEventType.EMPLOYEE_HIRE_REVERSED, oldState: { status: 'ACTIVE' }, newState: { status: 'CANCELLED' } });
      await this.events.signalRecalculationIfNeeded(tx, { ...base, changeType: 'HIRE_REVERSAL' });
      await this.audit.record({ tenantId, eventType: 'HR_HIRE_REVERSED', entityType: doc.documentType, entityId: id, action: 'REVERSE', userId, reason, oldValues: { status: 'POSTED' }, newValues: { status: 'REVERSED', employmentStatus: 'CANCELLED' } }, tx);
      return updated;
    });
  }

  // ------------------------------------------------------------- bulk

  /** Bulk hire (spec 85): each line goes through the same create/post as a
   * single hire and is validated separately; failures do not roll back
   * other lines. */
  async bulk(tenantId: string, membershipId: string, userId: string, dto: BulkHireDto) {
    const results = [];
    for (let i = 0; i < dto.lines.length; i++) {
      try {
        const doc = await this.create(tenantId, membershipId, userId, dto.lines[i]);
        const posted = dto.post ? await this.post(tenantId, membershipId, userId, doc.id) : null;
        results.push({ line: i + 1, ok: true, documentId: doc.id, number: doc.number, employmentId: posted?.employment?.id ?? null, warnings: posted?.warnings ?? [] });
      } catch (e) {
        const err = e as AppError;
        results.push({ line: i + 1, ok: false, code: err.code ?? 'ERROR', message: err.message });
      }
    }
    return { total: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }
}
