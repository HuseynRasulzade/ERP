import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import { ApproveLeaveRecordDto, CreateLeaveRecordDto } from './dto/hr-core.dto';

const LEAVE_TYPE = 'HR_LEAVE_RECORD';

/**
 * LeaveRecord — HR-side foundation only (docx spec Phase 17 section 38).
 * Entitlement/balance calculation and the worked-hours impact of an
 * approved leave are Phase 18's job (Work Time); this module only tracks
 * the request/approval lifecycle so Phase 18 has something to read from
 * day one (disclosed simplification — no accrual engine here).
 */
@Injectable()
export class LeaveRecordService {
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
    return this.prisma.leaveRecord.findMany({
      where: { employmentId: { in: employmentIds } },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateLeaveRecordDto,
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

    const record = await this.prisma.leaveRecord.create({
      data: {
        tenantId,
        employmentId: dto.employmentId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        createdBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'HR_LEAVE_RECORD_CREATED',
      entityType: LEAVE_TYPE,
      entityId: record.id,
      action: 'CREATE',
      userId,
    });
    return record;
  }

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ApproveLeaveRecordDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const record = await this.prisma.leaveRecord.findFirst({
      where: { id, tenantId },
      include: { employment: true },
    });
    if (!record || record.employment.organizationId !== organizationId)
      throw new NotFoundAppError('LeaveRecord', id);
    if (record.status !== 'REQUESTED')
      throw new ValidationAppError(
        `Cannot approve a leave record in status ${record.status}`,
      );
    if (record.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const result = await this.prisma.leaveRecord.updateMany({
      where: { id, version: dto.expectedVersion },
      data: {
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: 'HR_LEAVE_RECORD_APPROVED',
      entityType: LEAVE_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.leaveRecord.findFirst({ where: { id } });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
