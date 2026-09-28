import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  OpenWorkTimePeriodDto,
  ReopenWorkTimePeriodDto,
} from './dto/work-time.dto';

const PERIOD_TYPE = 'WORK_TIME_PERIOD';

/**
 * WorkTimePeriod (docx spec Phase 18 sections 61-62) — a locked period
 * blocks new/edited TimeEntry rows going forward; a Time Correction is the
 * only way to change locked-period data (spec section 62).
 */
@Injectable()
export class WorkTimePeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.workTimePeriod.findMany({
      where: { organizationId },
      orderBy: { periodStart: 'desc' },
    });
  }

  async open(
    tenantId: string,
    membershipId: string,
    userId: string,
    dto: OpenWorkTimePeriodDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, dto.organizationId);
    const periodStart = this.parseDate(dto.periodStart);
    const periodEnd = this.parseDate(dto.periodEnd);
    const existing = await this.prisma.workTimePeriod.findUnique({
      where: {
        organizationId_periodStart_periodEnd: {
          organizationId: dto.organizationId,
          periodStart,
          periodEnd,
        },
      },
    });
    if (existing) return existing;
    return this.prisma.workTimePeriod.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        periodStart,
        periodEnd,
      },
    });
  }

  async lock(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.workTimePeriod.findFirst({
      where: { id, organizationId },
    });
    if (!period) throw new NotFoundAppError('WorkTimePeriod', id);
    if (period.status === 'LOCKED') return period;
    const result = await this.prisma.workTimePeriod.updateMany({
      where: { id, status: { not: 'LOCKED' } },
      data: { status: 'LOCKED', lockedAt: new Date() },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'WORK_TIME_PERIOD_LOCKED',
      entityType: PERIOD_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.workTimePeriod.findFirst({ where: { id } });
  }

  async reopen(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: ReopenWorkTimePeriodDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.workTimePeriod.findFirst({
      where: { id, organizationId },
    });
    if (!period) throw new NotFoundAppError('WorkTimePeriod', id);
    if (period.status !== 'LOCKED')
      throw new ValidationAppError(
        `Cannot reopen a period in status ${period.status}`,
      );
    const updated = await this.prisma.workTimePeriod.update({
      where: { id },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenReason: dto.reason,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'WORK_TIME_PERIOD_REOPENED',
      entityType: PERIOD_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      reason: dto.reason,
    });
    return updated;
  }

  /** Throws if `date` falls inside a LOCKED period for this organization —
   * called before creating/editing a direct TimeEntry (spec section 62). */
  async assertOpen(tenantId: string, organizationId: string, date: Date) {
    const lockedPeriod = await this.prisma.workTimePeriod.findFirst({
      where: {
        tenantId,
        organizationId,
        status: 'LOCKED',
        periodStart: { lte: date },
        periodEnd: { gte: date },
      },
    });
    if (lockedPeriod)
      throw new ValidationAppError(
        'This date falls in a LOCKED work-time period — use a Time Correction instead',
      );
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
