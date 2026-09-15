import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { HR_TRANSFER_TYPE } from './employee-transfer.repository';

const SEQUENCE_PREFIX = 'TRF';

@Injectable()
export class EmployeeTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      employmentId: string;
      transferType: string;
      effectiveDate: string;
      newOrganizationId?: string;
      newDepartmentId?: string;
      newPositionId?: string;
      newStaffingPositionId?: string;
      newBranchId?: string;
      newManagerEmploymentId?: string;
      newLocationId?: string;
      newFte?: number;
      newWorkScheduleId?: string;
      reason?: string;
      documentDate: string;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({ where: { id: dto.employmentId, organizationId } });
    if (!employment) throw new NotFoundAppError('Employment', dto.employmentId);
    const documentDate = this.parseDate(dto.documentDate);
    const effectiveDate = this.parseDate(dto.effectiveDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, HR_TRANSFER_TYPE, documentDate, tx);
      const row = await tx.employeeTransfer.create({
        data: {
          tenantId,
          organizationId,
          employmentId: dto.employmentId,
          transferType: dto.transferType,
          effectiveDate,
          newOrganizationId: dto.newOrganizationId,
          newDepartmentId: dto.newDepartmentId,
          newPositionId: dto.newPositionId,
          newStaffingPositionId: dto.newStaffingPositionId,
          newBranchId: dto.newBranchId,
          newManagerEmploymentId: dto.newManagerEmploymentId,
          newLocationId: dto.newLocationId,
          newFte: dto.newFte?.toString(),
          newWorkScheduleId: dto.newWorkScheduleId,
          reason: dto.reason,
          number: allocated.formatted,
          documentDate,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'HR_TRANSFER_CREATED', entityType: HR_TRANSFER_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { transferType: dto.transferType, effectiveDate: dto.effectiveDate } }, tx);
      return row;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, employmentId?: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.employeeTransfer.findMany({ where: { organizationId, employmentId }, orderBy: { createdAt: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: HR_TRANSFER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: HR_TRANSFER_TYPE, documentType: HR_TRANSFER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
