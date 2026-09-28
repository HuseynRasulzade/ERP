import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  AmendEmploymentContractDto,
  CreateEmploymentContractDto,
} from './dto/hr-core.dto';

const CONTRACT_TYPE = 'HR_EMPLOYMENT_CONTRACT';

/**
 * EmploymentContract / EmploymentContractVersion (docx spec Phase 17
 * section 12) — the original contract row is never overwritten; each
 * amendment creates a new EmploymentContractVersion, effective-dated, so a
 * historical as-of-date read resolves the right terms. The contract's own
 * "live" fields (effectiveTo, workLocation, baseCompensationReference,
 * conditions) are a current-state projection, updated alongside each new
 * version — same convention as Employment vs EmployeeAssignment.
 */
@Injectable()
export class EmploymentContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    employmentId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: employmentId, organizationId },
    });
    if (!employment) throw new NotFoundAppError('Employment', employmentId);
    return this.prisma.employmentContract.findFirst({
      where: { employmentId },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateEmploymentContractDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, organizationId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this organization',
      );
    const existing = await this.prisma.employmentContract.findUnique({
      where: { employmentId: dto.employmentId },
    });
    if (existing)
      throw new ValidationAppError(
        'This employment already has a contract — use amend instead',
      );

    return this.prisma.runInTransaction(async (tx) => {
      const contract = await tx.employmentContract.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          contractNumber: dto.contractNumber,
          contractDate: this.parseDate(dto.contractDate),
          effectiveFrom: this.parseDate(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo
            ? this.parseDate(dto.effectiveTo)
            : undefined,
          contractType: dto.contractType,
          probationPeriodMonths: dto.probationPeriodMonths,
          workLocation: dto.workLocation,
          workingTimeType: dto.workingTimeType,
          baseCompensationReference: dto.baseCompensationReference,
          conditions: dto.conditions,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await tx.employmentContractVersion.create({
        data: {
          tenantId,
          contractId: contract.id,
          versionNumber: 1,
          effectiveFrom: contract.effectiveFrom,
          changes: 'Initial contract',
          createdBy: userId,
        },
      });
      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_CONTRACT_CREATED',
          entityType: CONTRACT_TYPE,
          entityId: contract.id,
          action: 'CREATE',
          userId,
        },
        tx,
      );
      return contract;
    });
  }

  async amend(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    employmentId: string,
    dto: AmendEmploymentContractDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const contract = await this.prisma.employmentContract.findFirst({
      where: { employmentId, tenantId },
    });
    if (!contract)
      throw new NotFoundAppError('EmploymentContract', employmentId);

    return this.prisma.runInTransaction(async (tx) => {
      const lastVersion = await tx.employmentContractVersion.findFirst({
        where: { contractId: contract.id },
        orderBy: { versionNumber: 'desc' },
      });
      const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;

      await tx.employmentContractVersion.create({
        data: {
          tenantId,
          contractId: contract.id,
          versionNumber: nextVersion,
          effectiveFrom: this.parseDate(dto.effectiveFrom),
          changes: dto.changes,
          sourceDocument: dto.sourceDocument,
          approvedBy: userId,
        },
      });

      const updated = await tx.employmentContract.update({
        where: { id: contract.id },
        data: {
          effectiveTo: dto.newEffectiveTo
            ? this.parseDate(dto.newEffectiveTo)
            : contract.effectiveTo,
          workLocation: dto.newWorkLocation ?? contract.workLocation,
          baseCompensationReference:
            dto.newBaseCompensationReference ??
            contract.baseCompensationReference,
          conditions: dto.newConditions ?? contract.conditions,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'HR_CONTRACT_AMENDED',
          entityType: CONTRACT_TYPE,
          entityId: contract.id,
          action: 'UPDATE',
          userId,
          newValues: { versionNumber: nextVersion },
        },
        tx,
      );
      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
