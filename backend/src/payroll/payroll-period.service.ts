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
  ApprovePayrollPeriodDto,
  CreatePayrollPeriodDto,
  ReopenPayrollPeriodDto,
} from './dto/payroll.dto';

const PERIOD_TYPE = 'PAYROLL_PERIOD';

/**
 * PayrollPeriod (docx spec Phase 19 sections 6-7) — APPROVED, POSTED, PAID
 * and CLOSED are deliberately separate concepts (spec section 7): a period
 * can be posted to the GL while employee payments are still outstanding.
 */
@Injectable()
export class PayrollPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.payrollPeriod.findMany({
      where: { organizationId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.payrollPeriod.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundAppError('PayrollPeriod', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreatePayrollPeriodDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.month < 1 || dto.month > 12)
      throw new ValidationAppError('month must be between 1 and 12');
    const periodStart = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const periodEnd = new Date(Date.UTC(dto.year, dto.month, 0));

    const period = await this.prisma.payrollPeriod.create({
      data: {
        tenantId,
        organizationId,
        year: dto.year,
        month: dto.month,
        periodStart,
        periodEnd,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_PERIOD_CREATED',
      entityType: PERIOD_TYPE,
      entityId: period.id,
      action: 'CREATE',
      userId,
    });
    return period;
  }

  async setStatus(tenantId: string, id: string, status: string, extra: Record<string, unknown> = {}) {
    return this.prisma.payrollPeriod.update({ where: { id }, data: { status, ...extra } });
  }

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ApprovePayrollPeriodDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.get(tenantId, membershipId, organizationId, id);
    if (period.status !== 'CALCULATED' && period.status !== 'REVIEW')
      throw new ValidationAppError(`Cannot approve a payroll period in status ${period.status}`);
    if (period.calculationVersion !== dto.expectedCalculationVersion)
      throw new ConcurrencyConflictError();

    const errors = await this.prisma.payrollError.findFirst({
      where: {
        calculationRun: { payrollPeriodId: id },
        blocking: true,
        resolved: false,
      },
    });
    if (errors)
      throw new ValidationAppError('Cannot approve: unresolved blocking payroll errors exist');

    const updated = await this.prisma.payrollPeriod.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId },
    });
    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_PERIOD_APPROVED',
      entityType: PERIOD_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return updated;
  }

  async reopen(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ReopenPayrollPeriodDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.get(tenantId, membershipId, organizationId, id);
    if (!['APPROVED', 'POSTED', 'PAID', 'CLOSED'].includes(period.status))
      throw new ValidationAppError(`Cannot reopen a payroll period in status ${period.status}`);

    const updated = await this.prisma.payrollPeriod.update({
      where: { id },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenReason: dto.reason,
        calculationVersion: { increment: 1 },
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'PAYROLL_PERIOD_REOPENED',
      entityType: PERIOD_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      reason: dto.reason,
    });
    return updated;
  }
}
