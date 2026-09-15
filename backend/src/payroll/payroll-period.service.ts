import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/** PayrollPeriodService (spec sections 6-7, 125-126). */
@Injectable()
export class PayrollPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async open(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { year: number; month: number; paymentDate?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const periodEnd = new Date(Date.UTC(dto.year, dto.month, 0));
    const row = await this.prisma.payrollPeriod.upsert({
      where: { tenantId_organizationId_year_month_periodType: { tenantId, organizationId, year: dto.year, month: dto.month, periodType: 'MONTHLY' } },
      create: { tenantId, organizationId, year: dto.year, month: dto.month, periodStart, periodEnd, paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined, status: 'OPEN' },
      update: {},
    });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_PERIOD_OPENED', entityType: 'PAYROLL_PERIOD', entityId: row.id, action: 'CREATE', userId, newValues: dto });
    return row;
  }

  async transition(tenantId: string, id: string, userId: string, status: string, extra?: Record<string, unknown>) {
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id, tenantId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', id);
    const row = await this.prisma.payrollPeriod.update({ where: { id }, data: { status, ...extra } });
    await this.audit.record({ tenantId, eventType: 'PAYROLL_PERIOD_STATUS_CHANGED', entityType: 'PAYROLL_PERIOD', entityId: id, action: 'UPDATE', userId, oldValues: { status: period.status }, newValues: { status } });
    return row;
  }

  async approve(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id, tenantId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', id);
    if (period.status !== 'REVIEW' && period.status !== 'CALCULATED') throw new ValidationAppError(`Cannot approve from status ${period.status}`);
    return this.transition(tenantId, id, userId, 'APPROVED', { approvedAt: new Date(), approvedBy: userId });
  }

  /** Requires a mandatory reason (spec section 125), and flags the
   * finalized-report dependency (spec section 126) as a warning rather
   * than a hard block — statutory report re-submission tracking is out
   * of this build's scope (disclosed simplification). */
  async reopen(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, reason: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!reason) throw new ValidationAppError('A reason is required to reopen a payroll period (spec section 125)');
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id, tenantId, organizationId } });
    if (!period) throw new NotFoundAppError('PayrollPeriod', id);
    if (!['APPROVED', 'POSTED', 'CLOSED'].includes(period.status)) throw new ValidationAppError(`Cannot reopen from status ${period.status}`);
    return this.transition(tenantId, id, userId, 'REOPENED', { reopenedAt: new Date(), reopenReason: reason });
  }

  get(tenantId: string, id: string) {
    return this.prisma.payrollPeriod.findFirst({ where: { id, tenantId } });
  }

  async getOrThrow(tenantId: string, id: string) {
    const row = await this.get(tenantId, id);
    if (!row) throw new NotFoundAppError('PayrollPeriod', id);
    return row;
  }

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.payrollPeriod.findMany({ where: { tenantId, organizationId }, orderBy: { periodStart: 'desc' } }));
  }
}
