import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CreateAbsenceRecordDto } from './dto/hr-core.dto';

const ABSENCE_TYPE = 'HR_ABSENCE_RECORD';

/**
 * AbsenceRecord — foundation for Phase 18's worked-hours calculation (docx
 * spec Phase 17 section 40). Simple record-keeping only; no approval
 * workflow (disclosed simplification — unlike LeaveRecord, the spec treats
 * absences as after-the-fact records, not requests).
 */
@Injectable()
export class AbsenceRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    employmentId?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employmentIds = employmentId
      ? [employmentId]
      : (
          await this.prisma.employment.findMany({
            where: { organizationId },
            select: { id: true },
          })
        ).map((e) => e.id);
    return this.prisma.absenceRecord.findMany({
      where: { employmentId: { in: employmentIds } },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateAbsenceRecordDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, organizationId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this organization',
      );
    const startDate = this.parseDate(dto.startDate);
    const endDate = this.parseDate(dto.endDate);
    if (endDate < startDate)
      throw new ValidationAppError('endDate cannot be before startDate');

    const record = await this.prisma.absenceRecord.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        absenceType: dto.absenceType,
        startDate,
        endDate,
        reason: dto.reason,
        supportingDocument: dto.supportingDocument,
        createdBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'HR_ABSENCE_RECORD_CREATED',
      entityType: ABSENCE_TYPE,
      entityId: record.id,
      action: 'CREATE',
      userId,
    });
    return record;
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
