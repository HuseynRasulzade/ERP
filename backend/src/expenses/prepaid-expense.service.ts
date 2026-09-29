import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreatePrepaidExpenseDto } from './dto/expenses.dto';

const ENTITY_TYPE = 'PREPAID_EXPENSE';

/**
 * PrepaidExpenseService (docx spec Phase 20 sections 33-40) — creating a
 * PrepaidExpense is a deliberate, EXPLICIT finance action referencing a
 * classified claim line, never auto-derived from it: the claim line
 * itself carries no "duration", only the recognition start/end dates
 * finance enters here decide the schedule (spec section 39: mid-month
 * start/end is not assumed to be 12 equal months unless configured).
 */
@Injectable()
export class PrepaidExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.prepaidExpense.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { schedule: { orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }] } },
    });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.prepaidExpense.findFirst({
      where: { id, organizationId },
      include: { schedule: { orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }] } },
    });
    if (!row) throw new NotFoundAppError('PrepaidExpense', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreatePrepaidExpenseDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const start = new Date(dto.recognitionStartDate);
    const end = new Date(dto.recognitionEndDate);
    if (end < start) throw new ValidationAppError('recognitionEndDate must not be before recognitionStartDate');

    const originalAmount = new Decimal(dto.originalAmount);
    const allocationMethod = dto.allocationMethod ?? 'STRAIGHT_LINE_BY_MONTH';
    const scheduleRows = this.buildSchedule(start, end, originalAmount, allocationMethod);

    const created = await this.prisma.prepaidExpense.create({
      data: {
        tenantId,
        organizationId,
        sourceClaimLineId: dto.sourceClaimLineId,
        expenseCategoryId: dto.expenseCategoryId,
        originalAmount,
        currencyId: dto.currencyId,
        baseAmount: originalAmount,
        recognitionStartDate: start,
        recognitionEndDate: end,
        allocationMethod,
        costCenterId: dto.costCenterId,
        projectId: dto.projectId,
        remainingAmount: originalAmount,
        status: 'ACTIVE',
        createdBy: userId,
        schedule: { create: scheduleRows.map((r) => ({ ...r, tenantId })) },
      },
      include: { schedule: true },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PREPAID_EXPENSE_CREATED',
      entityType: ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { originalAmount: originalAmount.toFixed(2), periods: scheduleRows.length },
    });
    return created;
  }

  /** STRAIGHT_LINE_BY_MONTH divides evenly across each calendar month in
   * range; STRAIGHT_LINE_BY_DAY prorates each month by its own day count
   * within the range (spec section 39's mid-month case). Either way the
   * LAST period absorbs the rounding residual so the schedule always
   * sums to exactly `originalAmount` (no unexplained residual, same
   * convention as Payroll/Cost Allocation rounding). */
  private buildSchedule(
    start: Date,
    end: Date,
    originalAmount: Decimal,
    allocationMethod: string,
  ): Array<{ tenantId?: string; periodYear: number; periodMonth: number; plannedRecognitionAmount: Decimal }> {
    const months: { year: number; month: number; days: number }[] = [];
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const endCursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= endCursor) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const monthStart = year === start.getUTCFullYear() && month === start.getUTCMonth() + 1 ? start : new Date(Date.UTC(year, month - 1, 1));
      const monthEnd = year === end.getUTCFullYear() && month === end.getUTCMonth() + 1 ? end : new Date(Date.UTC(year, month, 0));
      const days = Math.floor((monthEnd.getTime() - monthStart.getTime()) / 86_400_000) + 1;
      months.push({ year, month, days });
      cursor = new Date(Date.UTC(year, month, 1));
    }

    const totalDays = months.reduce((sum, m) => sum + m.days, 0);
    const rows: Array<{ periodYear: number; periodMonth: number; plannedRecognitionAmount: Decimal }> = [];
    let allocated = new Decimal(0);
    months.forEach((m, i) => {
      const isLast = i === months.length - 1;
      let amount: Decimal;
      if (isLast) {
        amount = originalAmount.minus(allocated);
      } else if (allocationMethod === 'STRAIGHT_LINE_BY_DAY') {
        amount = originalAmount.mul(m.days).div(totalDays).toDecimalPlaces(2);
      } else {
        amount = originalAmount.div(months.length).toDecimalPlaces(2);
      }
      allocated = allocated.plus(amount);
      rows.push({ periodYear: m.year, periodMonth: m.month, plannedRecognitionAmount: amount });
    });
    return rows;
  }
}
