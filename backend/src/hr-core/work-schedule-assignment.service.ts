import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { AssignWorkScheduleDto } from './dto/hr-core.dto';

/**
 * WorkScheduleAssignment — history-only (docx spec Phase 17 section 32);
 * full schedule mechanics (templates, shifts, calendars) are Phase 18's own
 * build. This only records which free-text `workScheduleCode` applied to an
 * employment from which date, mirroring EmployeeAssignment's own
 * close-current/open-new checkpoint pattern.
 */
@Injectable()
export class WorkScheduleAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    employmentId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.workScheduleAssignment.findMany({
      where: { employmentId },
      orderBy: { effectiveFrom: 'asc' },
    });
  }

  async assign(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: AssignWorkScheduleDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const employment = await this.prisma.employment.findFirst({
      where: { id: dto.employmentId, organizationId },
    });
    if (!employment)
      throw new ValidationAppError(
        'employmentId does not belong to this organization',
      );

    const effectiveFrom = this.parseDate(dto.effectiveFrom);
    return this.prisma.runInTransaction(async (tx) => {
      const dayBefore = new Date(effectiveFrom);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      await tx.workScheduleAssignment.updateMany({
        where: { employmentId: dto.employmentId, effectiveTo: null },
        data: { effectiveTo: dayBefore },
      });
      const row = await tx.workScheduleAssignment.create({
        data: {
          tenantId,
          employmentId: dto.employmentId,
          workScheduleCode: dto.workScheduleCode,
          effectiveFrom,
          reason: dto.reason,
          createdBy: userId,
        },
      });
      if (effectiveFrom <= new Date()) {
        await tx.employment.update({
          where: { id: dto.employmentId },
          data: { workScheduleCode: dto.workScheduleCode },
        });
      }
      return row;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
