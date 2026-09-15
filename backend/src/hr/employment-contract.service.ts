import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * EmploymentContractService (spec sections 11-12). `amend` never mutates
 * an existing contract row in place — it closes the current version's
 * `effectiveTo` and creates a new row with `versionNumber + 1`, the same
 * `contractNumber`, and a `changeSummary` (spec section 12's own
 * "Amendment/version model istifadə et"). Disclosed simplification: this
 * IS the versioning model — there is no separate
 * `EmploymentContractVersion` child table (see docs/HR_CORE.md).
 */
@Injectable()
export class EmploymentContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createInitial(
    tenantId: string,
    userId: string,
    employmentId: string,
    dto: { contractNumber: string; contractDate: string; effectiveFrom: string; contractType: string; probationPeriodMonths?: number; workLocation?: string; workingTimeType?: string; baseCompensationReference?: string; conditions?: string; attachmentAssetId?: string },
    tx: PrismaTransactionClient,
  ) {
    const row = await tx.employmentContract.create({
      data: {
        tenantId,
        employmentId,
        contractNumber: dto.contractNumber,
        versionNumber: 1,
        contractDate: new Date(dto.contractDate),
        effectiveFrom: new Date(dto.effectiveFrom),
        contractType: dto.contractType,
        probationPeriodMonths: dto.probationPeriodMonths,
        workLocation: dto.workLocation,
        workingTimeType: dto.workingTimeType,
        baseCompensationReference: dto.baseCompensationReference,
        conditions: dto.conditions,
        attachmentAssetId: dto.attachmentAssetId,
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'HR_CONTRACT_CREATED', entityType: 'EMPLOYMENT_CONTRACT', entityId: row.id, action: 'CREATE', userId, newValues: { contractNumber: dto.contractNumber } }, tx);
    return row;
  }

  async amend(tenantId: string, userId: string, contractId: string, dto: { effectiveFrom: string; changeSummary: string; contractType?: string; conditions?: string; baseCompensationReference?: string; approvedBy?: string; sourceDocumentType?: string; sourceDocumentId?: string }) {
    const current = await this.prisma.employmentContract.findFirst({ where: { id: contractId, tenantId, status: 'ACTIVE' } });
    if (!current) throw new NotFoundAppError('EmploymentContract', contractId);
    const effectiveFrom = new Date(dto.effectiveFrom);
    if (effectiveFrom <= current.effectiveFrom) throw new ValidationAppError('Amendment effective date must be after the current version\'s effective date');

    return this.prisma.runInTransaction(async (tx) => {
      await tx.employmentContract.update({ where: { id: contractId }, data: { status: 'SUPERSEDED', effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) } });
      const amended = await tx.employmentContract.create({
        data: {
          tenantId,
          employmentId: current.employmentId,
          contractNumber: current.contractNumber,
          versionNumber: current.versionNumber + 1,
          contractDate: current.contractDate,
          effectiveFrom,
          contractType: dto.contractType ?? current.contractType,
          probationPeriodMonths: current.probationPeriodMonths,
          workLocation: current.workLocation,
          workingTimeType: current.workingTimeType,
          baseCompensationReference: dto.baseCompensationReference ?? current.baseCompensationReference,
          conditions: dto.conditions ?? current.conditions,
          changeSummary: dto.changeSummary,
          sourceDocumentType: dto.sourceDocumentType,
          sourceDocumentId: dto.sourceDocumentId,
          approvedBy: dto.approvedBy,
          createdBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'HR_CONTRACT_AMENDED', entityType: 'EMPLOYMENT_CONTRACT', entityId: amended.id, action: 'CREATE', userId, oldValues: { versionNumber: current.versionNumber }, newValues: { versionNumber: amended.versionNumber, changeSummary: dto.changeSummary } }, tx);
      return amended;
    });
  }

  history(tenantId: string, employmentId: string) {
    return this.prisma.employmentContract.findMany({ where: { tenantId, employmentId }, orderBy: { versionNumber: 'asc' } });
  }

  async current(tenantId: string, employmentId: string) {
    return this.prisma.employmentContract.findFirst({ where: { tenantId, employmentId, status: 'ACTIVE' }, orderBy: { versionNumber: 'desc' } });
  }
}
