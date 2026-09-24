import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ConflictAppError, ErrorCode, HrRuleError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { AmendContractDto, CreateContractDto, InlineContractDto } from './dto/hr.dto';
import { HrDocType, HrEventType } from './hr.constants';
import { addDays, fmtHr, isoHr, parseHrDate, parseOptionalHrDate, todayHr } from './hr-date.util';
import { HrEventService } from './hr-event.service';
import { HrNumberingService } from './hr-numbering.service';
import { HrSecurityService } from './hr-security.service';

const TERM_KEYS = ['effectiveTo', 'contractType', 'probationPeriodDays', 'workLocation', 'workingTimeType', 'baseCompensationReference', 'conditions'] as const;

/**
 * EmploymentContractService (spec 11/12/142). The contract header keeps the
 * ORIGINAL terms forever; each amendment creates an
 * EmploymentContractVersion (full term snapshot + diff) valid from its own
 * effective date, and the previous version is closed the day before — so a
 * June query reads the old version and an August query the new one.
 */
@Injectable()
export class EmploymentContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly numbering: HrNumberingService,
    private readonly events: HrEventService,
    private readonly security: HrSecurityService,
  ) {}

  static termsOf(c: Record<string, any>) {
    return {
      effectiveTo: c.effectiveTo instanceof Date ? isoHr(c.effectiveTo) : c.effectiveTo ?? null,
      contractType: c.contractType,
      probationPeriodDays: c.probationPeriodDays ?? null,
      workLocation: c.workLocation ?? null,
      workingTimeType: c.workingTimeType ?? 'FULL_TIME',
      baseCompensationReference: c.baseCompensationReference ?? null,
      conditions: c.conditions ?? null,
    };
  }

  async list(tenantId: string, membershipId: string, filter: { organizationId?: string; employeeId?: string; employmentId?: string; status?: string }) {
    const orgIds = filter.organizationId ? [filter.organizationId] : await this.access.listAccessibleOrganizationIds(membershipId);
    if (filter.organizationId) await this.access.assertAccess(tenantId, membershipId, filter.organizationId);
    const rows = await this.prisma.employmentContract.findMany({
      where: {
        tenantId,
        organizationId: { in: orgIds },
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.employmentId ? { employmentId: filter.employmentId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { contractDate: 'desc' },
      take: 1000,
    });
    return rows.map((r) => this.security.redactContract(r));
  }

  async get(tenantId: string, membershipId: string, id: string) {
    const c = await this.prisma.employmentContract.findFirst({ where: { id, tenantId }, include: { versions: { orderBy: { versionNumber: 'asc' } } } });
    if (!c) throw new NotFoundAppError('EmploymentContract', id);
    await this.access.assertAccess(tenantId, membershipId, c.organizationId);
    return this.security.redactContract(c);
  }

  /** The contract version in effect on `asOf` (spec 142). */
  async getVersionAsOf(tenantId: string, membershipId: string, id: string, asOfRaw: string) {
    const asOf = parseHrDate(asOfRaw, 'asOf');
    await this.get(tenantId, membershipId, id);
    const v = await this.prisma.employmentContractVersion.findFirst({
      where: { contractId: id, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
      orderBy: { versionNumber: 'desc' },
    });
    if (!v) throw new HrRuleError(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `Contract has no version in effect on ${fmtHr(asOf)}`, 404);
    return this.security.redactContract(v);
  }

  async create(tenantId: string, membershipId: string, userId: string, dto: CreateContractDto) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    await this.numbering.ensure(tenantId, 'HR_CONTRACT');
    return this.prisma.runInTransaction((tx) => this.createInTx(tx, tenantId, userId, dto.organizationId, dto.employeeId, parseHrDate(dto.effectiveFrom, 'effectiveFrom'), dto));
  }

  /** Also used by HireService for an inline contract on a hire document. */
  async createInTx(tx: PrismaTransactionClient, tenantId: string, userId: string, organizationId: string, employeeId: string, effectiveFrom: Date, dto: InlineContractDto) {
    const employee = await tx.employee.findFirst({ where: { id: employeeId, tenantId } });
    if (!employee) throw new NotFoundAppError('Employee', employeeId);
    const effectiveTo = parseOptionalHrDate(dto.effectiveTo, 'effectiveTo');
    if (effectiveTo && effectiveTo < effectiveFrom) throw new ValidationAppError('Contract effectiveTo must be on or after effectiveFrom');
    if (dto.contractType === 'FIXED_TERM' && !effectiveTo) throw new ValidationAppError('A FIXED_TERM contract requires an end date (effectiveTo)');
    const contractDate = parseOptionalHrDate(dto.contractDate, 'contractDate') ?? todayHr();
    const contractNumber = dto.contractNumber?.trim() || (await this.numbering.next(tx, tenantId, 'HR_CONTRACT', contractDate));
    const dup = await tx.employmentContract.findFirst({ where: { tenantId, organizationId, contractNumber } });
    if (dup) throw new ConflictAppError(`Employment contract number already exists in this organization: ${contractNumber}`);
    const contract = await tx.employmentContract.create({
      data: {
        tenantId,
        organizationId,
        employeeId,
        contractNumber,
        contractDate,
        effectiveFrom,
        effectiveTo,
        contractType: dto.contractType,
        probationPeriodDays: dto.probationPeriodDays,
        workLocation: dto.workLocation,
        workingTimeType: dto.workingTimeType ?? 'FULL_TIME',
        baseCompensationReference: dto.baseCompensationReference,
        conditions: dto.conditions,
        signedStatus: dto.signedStatus ?? 'UNSIGNED',
        attachmentId: dto.attachmentId,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await tx.employmentContractVersion.create({
      data: { tenantId, contractId: contract.id, versionNumber: 1, effectiveFrom, effectiveTo, terms: EmploymentContractService.termsOf(contract) as any, reason: 'Original contract', sourceDocumentType: HrDocType.CONTRACT, sourceDocumentId: contract.id, createdBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'HR_CONTRACT_CREATED', entityType: HrDocType.CONTRACT, entityId: contract.id, action: 'CREATE', userId, newValues: { contractNumber, contractType: dto.contractType, effectiveFrom: isoHr(effectiveFrom) } }, tx);
    return contract;
  }

  async sign(tenantId: string, membershipId: string, userId: string, id: string) {
    const c = await this.get(tenantId, membershipId, id);
    if (c.status === 'CANCELLED') throw new ValidationAppError('A cancelled contract cannot be signed');
    const row = await this.prisma.employmentContract.update({ where: { id }, data: { signedStatus: 'SIGNED', updatedBy: userId, version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'HR_CONTRACT_SIGNED', entityType: HrDocType.CONTRACT, entityId: id, action: 'SIGN', userId, oldValues: { signedStatus: c.signedStatus }, newValues: { signedStatus: 'SIGNED' } });
    return row;
  }

  async cancel(tenantId: string, membershipId: string, userId: string, id: string) {
    const c = await this.get(tenantId, membershipId, id);
    if (c.employmentId) throw new ValidationAppError('A contract attached to a posted employment cannot be cancelled; terminate or amend it instead');
    const row = await this.prisma.employmentContract.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: userId, version: { increment: 1 } } });
    await this.audit.record({ tenantId, eventType: 'HR_CONTRACT_CANCELLED', entityType: HrDocType.CONTRACT, entityId: id, action: 'CANCEL', userId });
    return row;
  }

  /** Amendment: new version from `effectiveFrom`, previous closed at D-1. */
  async amend(tenantId: string, membershipId: string, userId: string, id: string, dto: AmendContractDto) {
    const contract = await this.get(tenantId, membershipId, id);
    if (['CANCELLED', 'TERMINATED'].includes(contract.status)) throw new ValidationAppError(`A ${contract.status} contract cannot be amended`);
    const from = parseHrDate(dto.effectiveFrom, 'effectiveFrom');
    const changes: Record<string, unknown> = {};
    for (const k of TERM_KEYS) if ((dto.changes as any)[k] !== undefined) changes[k] = (dto.changes as any)[k];
    if (!Object.keys(changes).length) throw new ValidationAppError('An amendment must change at least one contract term');
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM employment_contracts WHERE id = $1 FOR UPDATE`, id);
      const latest = await tx.employmentContractVersion.findFirst({ where: { contractId: id }, orderBy: { versionNumber: 'desc' } });
      if (!latest) throw new NotFoundAppError('EmploymentContractVersion', id);
      if (from <= latest.effectiveFrom) {
        throw new HrRuleError(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `Amendment effective ${fmtHr(from)} must be after the current version's start ${fmtHr(latest.effectiveFrom)}`);
      }
      if (from < contract.effectiveFrom || (latest.effectiveTo && from > latest.effectiveTo && !('effectiveTo' in changes))) {
        throw new HrRuleError(ErrorCode.HR_INVALID_EFFECTIVE_DATE, `Amendment effective ${fmtHr(from)} is outside the contract period`);
      }
      const terms = { ...(latest.terms as Record<string, unknown>), ...changes };
      const newTo = parseOptionalHrDate((terms.effectiveTo as string | null) ?? null, 'effectiveTo');
      await tx.employmentContractVersion.update({ where: { id: latest.id }, data: { effectiveTo: addDays(from, -1) } });
      const version = await tx.employmentContractVersion.create({
        data: {
          tenantId,
          contractId: id,
          versionNumber: latest.versionNumber + 1,
          effectiveFrom: from,
          effectiveTo: newTo,
          terms: terms as any,
          changes: changes as any,
          reason: dto.reason,
          sourceDocumentType: HrDocType.CONTRACT_AMENDMENT,
          sourceDocumentId: id,
          approvedBy: userId,
          createdBy: userId,
        },
      });
      await tx.employmentContract.update({ where: { id }, data: { currentVersionNumber: version.versionNumber, updatedBy: userId, version: { increment: 1 } } });
      await this.audit.record(
        { tenantId, eventType: 'HR_CONTRACT_AMENDED', entityType: HrDocType.CONTRACT, entityId: id, action: 'AMEND', userId, oldValues: latest.terms, newValues: { ...terms, effectiveFrom: isoHr(from), versionNumber: version.versionNumber }, reason: dto.reason },
        tx,
      );
      if (contract.employmentId) {
        const emp = await tx.employment.findUnique({ where: { id: contract.employmentId } });
        await this.events.emit(tx, {
          tenantId,
          eventType: HrEventType.CONTRACT_AMENDED,
          employeeId: contract.employeeId,
          employmentId: contract.employmentId,
          organizationId: contract.organizationId,
          effectiveDate: from,
          oldState: latest.terms,
          newState: terms,
          sourceDocumentType: HrDocType.CONTRACT_AMENDMENT,
          sourceDocumentId: version.id,
        });
        if (emp) {
          await this.events.signalRecalculationIfNeeded(tx, { tenantId, employeeId: emp.employeeId, employmentId: emp.id, organizationId: emp.organizationId, effectiveDate: from, sourceDocumentType: HrDocType.CONTRACT_AMENDMENT, sourceDocumentId: version.id, changeType: 'CONTRACT_AMENDMENT' });
        }
      }
      return this.security.redactContract(version);
    });
  }
}
