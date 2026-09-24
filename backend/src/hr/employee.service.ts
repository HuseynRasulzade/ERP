import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyConflictError, ConflictAppError, NotFoundAppError, PermissionDeniedError, ValidationAppError } from '../common/errors/app-error';
import { PermissionCodes } from '../rbac/permission-codes';
import { CreateAttributeDto, CreateBankAccountDto, CreateEmployeeDto, CreatePersonnelDocumentDto, UpdateEmployeeDto } from './dto/hr.dto';
import { HrCatalogType, HrDocType, HrEventType } from './hr.constants';
import { addDays, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrEventService } from './hr-event.service';
import { HrHistoryService } from './hr-history.service';
import { HrNumberingService } from './hr-numbering.service';
import { HrPolicyService } from './hr-policy.service';
import { HrSecurityService } from './hr-security.service';
import { PhysicalPersonService } from './physical-person.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

/**
 * EmployeeService (spec 6/7/55-59) — the tenant's HR identity of a
 * PhysicalPerson. Personnel number (EMP-…) comes from the transaction-safe
 * numbering engine and is distinct from the person's legal ID and from any
 * employment-contract number (spec 55).
 */
@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: HrNumberingService,
    private readonly persons: PhysicalPersonService,
    private readonly events: HrEventService,
    private readonly history: HrHistoryService,
    private readonly policy: HrPolicyService,
    private readonly security: HrSecurityService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateEmployeeDto) {
    if (!dto.physicalPersonId && !dto.person) throw new ValidationAppError('Either physicalPersonId or person is required');
    if (dto.physicalPersonId && dto.person) throw new ValidationAppError('Provide physicalPersonId OR person, not both');
    if (dto.person && !this.security.can(PermissionCodes.HR_PERSON_CREATE)) throw new PermissionDeniedError(PermissionCodes.HR_PERSON_CREATE);
    await this.numbering.ensure(tenantId, 'HR_EMPLOYEE');
    return this.prisma.runInTransaction(async (tx) => {
      let personId = dto.physicalPersonId;
      let duplicateWarnings: unknown[] = [];
      if (dto.person) {
        const created = await this.persons.create(tenantId, userId, dto.person, tx);
        personId = created.person.id;
        duplicateWarnings = created.duplicateWarnings;
      } else {
        const person = await tx.physicalPerson.findFirst({ where: { id: personId, tenantId } });
        if (!person) throw new NotFoundAppError('PhysicalPerson', personId);
        if (!person.active) throw new ValidationAppError('Physical person is inactive');
      }
      const existing = await tx.employee.findFirst({ where: { tenantId, physicalPersonId: personId } });
      if (existing) throw new ConflictAppError(`This physical person already has an employee record (${existing.personnelNumber}); reuse it for new employments or rehire`);
      if (dto.employeeCode) {
        const clash = await tx.employee.findFirst({ where: { tenantId, employeeCode: dto.employeeCode } });
        if (clash) throw new ConflictAppError(`Employee code already in use: ${dto.employeeCode}`);
      }
      const personnelNumber = await this.numbering.next(tx, tenantId, 'HR_EMPLOYEE', todayHr());
      const employee = await tx.employee.create({
        data: {
          tenantId,
          physicalPersonId: personId!,
          personnelNumber,
          employeeCode: dto.employeeCode,
          defaultOrganizationId: dto.defaultOrganizationId,
          defaultLanguage: dto.defaultLanguage,
          corporateEmail: dto.corporateEmail,
          corporatePhone: dto.corporatePhone,
          createdBy: userId,
          updatedBy: userId,
        },
        include: { physicalPerson: true },
      });
      await this.audit.record({ tenantId, eventType: 'HR_EMPLOYEE_CREATED', entityType: HrDocType.EMPLOYEE, entityId: employee.id, action: 'CREATE', userId, newValues: { personnelNumber, physicalPersonId: personId } }, tx);
      await this.events.emit(tx, {
        tenantId,
        eventType: HrEventType.EMPLOYEE_CREATED,
        employeeId: employee.id,
        effectiveDate: todayHr(),
        newState: { personnelNumber },
        sourceDocumentType: HrDocType.EMPLOYEE,
        sourceDocumentId: employee.id,
      });
      return { ...employee, physicalPerson: this.security.redactPerson(employee.physicalPerson), duplicateWarnings };
    });
  }

  async list(tenantId: string, filter: { search?: string; status?: string; limit?: number }) {
    const rows = await this.prisma.employee.findMany({
      where: {
        tenantId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.search
          ? { OR: [{ personnelNumber: { contains: filter.search, mode: 'insensitive' } }, { physicalPerson: { fullName: { contains: filter.search, mode: 'insensitive' } } }] }
          : {}),
      },
      include: { physicalPerson: { select: { id: true, fullName: true } }, employments: { select: { id: true, organizationId: true, employmentStartDate: true, employmentEndDate: true, primaryEmployment: true, status: true } } },
      orderBy: { personnelNumber: 'asc' },
      take: Math.min(filter.limit ?? 500, 2000),
    });
    return rows;
  }

  /**
   * Employee card (spec 100/107): person (field-level redacted), every
   * employment's state as of `asOf`, contracts, attributes, bank accounts,
   * documents and the unified timeline. Employments of organizations the
   * caller has no grant for are hidden.
   */
  async getCard(tenantId: string, membershipId: string, id: string, asOfRaw?: string) {
    const asOf = parseOptionalHrDate(asOfRaw, 'asOf') ?? todayHr();
    const employee = await this.prisma.employee.findFirst({ where: { id, tenantId }, include: { physicalPerson: true } });
    if (!employee) throw new NotFoundAppError('Employee', id);
    const accessible = new Set(await this.access.listAccessibleOrganizationIds(membershipId));
    const employments = (await this.prisma.employment.findMany({ where: { tenantId, employeeId: id }, orderBy: { employmentStartDate: 'asc' } })).filter((e) => accessible.has(e.organizationId));
    const states = await Promise.all(employments.map((e) => this.history.getEmploymentState(tenantId, e.id, asOf)));
    const employmentIds = employments.map((e) => e.id);
    const [contracts, attributes, bank, documents, leaves, absences, transfers] = await Promise.all([
      this.prisma.employmentContract.findMany({ where: { tenantId, employeeId: id }, include: { versions: { orderBy: { versionNumber: 'asc' } } }, orderBy: { contractDate: 'asc' } }),
      this.prisma.employeeAttributeHistory.findMany({ where: { tenantId, employeeId: id }, orderBy: [{ attributeType: 'asc' }, { effectiveFrom: 'asc' }] }),
      this.security.can(PermissionCodes.HR_VIEW_BANK_INFO) ? this.prisma.employeeBankAccount.findMany({ where: { tenantId, employeeId: id } }) : Promise.resolve(null),
      this.prisma.hrPersonnelDocument.findMany({ where: { tenantId, active: true, OR: [{ ownerType: 'EMPLOYEE', ownerId: id }, { ownerType: 'PERSON', ownerId: employee.physicalPersonId }, { ownerType: 'EMPLOYMENT', ownerId: { in: employmentIds } }] } }),
      this.prisma.leaveRecord.findMany({ where: { employmentId: { in: employmentIds } }, orderBy: { startDate: 'desc' } }),
      this.prisma.absenceRecord.findMany({ where: { employmentId: { in: employmentIds } }, orderBy: { startDate: 'desc' } }),
      this.prisma.employeeTransfer.findMany({ where: { employmentId: { in: employmentIds } }, orderBy: [{ effectiveDate: 'asc' }] }),
    ]);
    return {
      employee: { ...employee, physicalPerson: this.security.redactPerson(employee.physicalPerson) },
      asOfDate: isoHr(asOf),
      employments: employments.map((e, i) => ({ employment: e, state: states[i] })),
      contracts: this.security.can(PermissionCodes.HR_CONTRACT_VIEW) ? contracts.map((c) => this.security.redactContract(c)) : null,
      attributes: this.security.filterAttributes(attributes),
      bankAccounts: bank,
      documents: this.security.filterDocuments(documents),
      leaves,
      absences,
      transfers,
      timeline: this.security.can(PermissionCodes.HR_VIEW_HISTORY) ? (await this.history.getTimeline(tenantId, { employeeId: id })).filter((e) => employmentIds.includes(e.employmentId)) : null,
      /** Payroll preview reference (spec 100): which state Phase 19 would
       * read on `asOf` — no amounts (salary is Phase 19). */
      payrollPreview: states.filter((s) => s.isEmployed).map((s) => ({
        employmentId: s.employmentId,
        organizationId: s.organizationId,
        departmentId: s.assignment?.departmentId ?? null,
        positionId: s.assignment?.positionId ?? null,
        costCenter: s.assignment?.costCenter ?? null,
        fte: s.assignment?.fte ?? null,
        workScheduleId: s.workSchedule?.workScheduleId ?? null,
        contractId: s.contract?.contractId ?? null,
        contractVersion: s.contract?.versionNumber ?? null,
        status: s.status,
      })),
    };
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateEmployeeDto) {
    const current = await this.prisma.employee.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundAppError('Employee', id);
    const { expectedVersion, ...changes } = dto;
    const res = await this.prisma.employee.updateMany({ where: { id, tenantId, version: expectedVersion }, data: { ...changes, updatedBy: userId, version: { increment: 1 } } });
    if (res.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'HR_EMPLOYEE_CHANGED',
      entityType: HrDocType.EMPLOYEE,
      entityId: id,
      action: 'UPDATE',
      userId,
      oldValues: Object.fromEntries(Object.keys(changes).map((k) => [k, (current as any)[k]])),
      newValues: changes,
    });
    return this.prisma.employee.findUnique({ where: { id } });
  }

  // ------------------------------------------------ attributes (spec 58/59)

  async listAttributes(tenantId: string, employeeId: string) {
    const rows = await this.prisma.employeeAttributeHistory.findMany({ where: { tenantId, employeeId }, orderBy: [{ attributeType: 'asc' }, { effectiveFrom: 'asc' }] });
    return this.security.filterAttributes(rows);
  }

  /** Effective-dated attribute: a new value closes the previous one at D-1. */
  async addAttribute(tenantId: string, userId: string, employeeId: string, dto: CreateAttributeDto) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!employee) throw new NotFoundAppError('Employee', employeeId);
    const item = await this.policy.assertCatalogCode(tenantId, HrCatalogType.ATTRIBUTE_TYPE, dto.attributeType);
    const sensitive = !!(item.metadata as any)?.sensitive;
    if (sensitive && !this.security.can(PermissionCodes.HR_VIEW_SENSITIVE_DATA)) throw new PermissionDeniedError(PermissionCodes.HR_VIEW_SENSITIVE_DATA);
    const from = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM employees WHERE id = $1 FOR UPDATE`, employeeId);
      const later = await tx.employeeAttributeHistory.findFirst({ where: { employeeId, attributeType: dto.attributeType, employmentId: dto.employmentId ?? null, effectiveFrom: { gte: from } } });
      if (later) throw new ConflictAppError(`A ${dto.attributeType} value is already recorded effective ${isoHr(later.effectiveFrom)}; attribute history is append-only`);
      const previous = await tx.employeeAttributeHistory.findFirst({ where: { employeeId, attributeType: dto.attributeType, employmentId: dto.employmentId ?? null, effectiveTo: null } });
      if (previous) await tx.employeeAttributeHistory.update({ where: { id: previous.id }, data: { effectiveTo: addDays(from, -1) } });
      const row = await tx.employeeAttributeHistory.create({
        data: { tenantId, employeeId, employmentId: dto.employmentId, attributeType: dto.attributeType, value: dto.value, effectiveFrom: from, sensitive, createdBy: userId },
      });
      await this.audit.record(
        { tenantId, eventType: 'HR_EMPLOYEE_ATTRIBUTE_CHANGED', entityType: HrDocType.EMPLOYEE, entityId: employeeId, action: 'ATTRIBUTE', userId, oldValues: previous ? { [dto.attributeType]: sensitive ? '[SENSITIVE]' : previous.value } : null, newValues: { [dto.attributeType]: sensitive ? '[SENSITIVE]' : dto.value, effectiveFrom: dto.effectiveFrom } },
        tx,
      );
      return row;
    });
  }

  // ------------------------------------------------ bank accounts (spec 57)

  async listBankAccounts(tenantId: string, employeeId: string) {
    return this.prisma.employeeBankAccount.findMany({ where: { tenantId, employeeId }, orderBy: { effectiveFrom: 'desc' } });
  }

  async addBankAccount(tenantId: string, userId: string, employeeId: string, dto: CreateBankAccountDto) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!employee) throw new NotFoundAppError('Employee', employeeId);
    const from = parseOptionalHrDate(dto.effectiveFrom, 'effectiveFrom') ?? todayHr();
    return this.prisma.runInTransaction(async (tx) => {
      if (dto.isPrimary !== false) {
        await tx.employeeBankAccount.updateMany({ where: { employeeId, isPrimary: true, active: true, effectiveTo: null }, data: { effectiveTo: addDays(from, -1), isPrimary: false } });
      }
      const row = await tx.employeeBankAccount.create({
        data: { tenantId, employeeId, bankName: dto.bankName, iban: dto.iban.replace(/\s+/g, '').toUpperCase(), currencyCode: dto.currencyCode, isPrimary: dto.isPrimary !== false, effectiveFrom: from, createdBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'HR_BANK_ACCOUNT_ADDED', entityType: HrDocType.EMPLOYEE, entityId: employeeId, action: 'BANK_ACCOUNT', userId, newValues: { bankName: dto.bankName, iban: `****${row.iban.slice(-4)}` } }, tx);
      return row;
    });
  }

  // ------------------------------------------------ personnel documents (spec 60)

  async listDocuments(tenantId: string, ownerType: string, ownerId: string) {
    const rows = await this.prisma.hrPersonnelDocument.findMany({ where: { tenantId, ownerType, ownerId, active: true }, orderBy: { uploadedAt: 'desc' } });
    return this.security.filterDocuments(rows);
  }

  async addDocument(tenantId: string, userId: string, dto: CreatePersonnelDocumentDto) {
    const sensitivity = dto.sensitivity ?? (dto.documentCategory === 'MEDICAL' ? 'MEDICAL' : 'PERSONAL');
    if (sensitivity === 'MEDICAL' && !this.security.can(PermissionCodes.HR_VIEW_MEDICAL)) throw new PermissionDeniedError(PermissionCodes.HR_VIEW_MEDICAL);
    const row = await this.prisma.hrPersonnelDocument.create({
      data: { tenantId, ownerType: dto.ownerType, ownerId: dto.ownerId, documentCategory: dto.documentCategory, sensitivity, fileName: dto.fileName, fileType: dto.fileType, fileSize: dto.fileSize, storageKey: dto.storageKey, notes: dto.notes, uploadedBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'HR_DOCUMENT_ATTACHED', entityType: `HR_${dto.ownerType}`, entityId: dto.ownerId, action: 'ATTACH', userId, newValues: { fileName: dto.fileName, category: dto.documentCategory, sensitivity } });
    return row;
  }
}
