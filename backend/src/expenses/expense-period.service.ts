import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CreateExpensePeriodDto } from './dto/expenses.dto';
import { CostAllocationRunService } from './cost-allocation-run.service';

const ENTITY_TYPE = 'EXPENSE_PERIOD';

/**
 * ExpensePeriodService (docx spec Phase 20 sections 116-118) — close
 * validation is a PRACTICAL SUBSET of the spec's own checklist: it
 * checks that nothing is left mid-workflow (no claim still in DRAFT/
 * SUBMITTED/PENDING_APPROVAL/PARTIALLY_APPROVED with a claim date in
 * the period, no APPROVED-but-unposted claim), that this period's
 * prepaid schedule rows are all RECOGNIZED, and — only when this
 * period actually has unallocated source cost behind an ACTIVE
 * AllocationRule (per `CostAllocationRunService.preview()`) — that a
 * POSTED CostAllocationRun exists for the period. It does NOT independently reconcile the
 * Expense/Prepaid/Employee-Settlement subledgers against the GL byte
 * for byte (spec sections 121-123's fuller ask; see
 * `ExpenseReportingService`'s reports for the read-side of that
 * instead) — Phase 22 Month Close is expected to own the full
 * orchestration.
 */
@Injectable()
export class ExpensePeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly allocationRuns: CostAllocationRunService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.expensePeriod.findMany({ where: { organizationId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, dto: CreateExpensePeriodDto) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = new Date(Date.UTC(dto.year, dto.month - 1, 1));
    const periodEnd = new Date(Date.UTC(dto.year, dto.month, 0));
    return this.prisma.expensePeriod.create({
      data: { tenantId, organizationId, year: dto.year, month: dto.month, periodStart, periodEnd },
    });
  }

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.expensePeriod.findFirst({ where: { id, organizationId } });
    if (!period) throw new NotFoundAppError('ExpensePeriod', id);
    if (period.status === 'CLOSED') throw new ValidationAppError('This expense period is already closed');

    const unresolvedClaims = await this.prisma.expenseClaim.count({
      where: {
        tenantId,
        organizationId,
        claimDate: { gte: period.periodStart, lte: period.periodEnd },
        claimStatus: { in: ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'PARTIALLY_APPROVED'] },
      },
    });
    if (unresolvedClaims > 0)
      throw new ValidationAppError(`Cannot close: ${unresolvedClaims} expense claim(s) in this period are not yet approved/rejected`);

    const unpostedApproved = await this.prisma.expenseClaim.count({
      where: {
        tenantId,
        organizationId,
        claimDate: { gte: period.periodStart, lte: period.periodEnd },
        claimStatus: 'APPROVED',
        postingStatus: { not: 'POSTED' },
      },
    });
    if (unpostedApproved > 0)
      throw new ValidationAppError(`Cannot close: ${unpostedApproved} approved expense claim(s) in this period are not yet posted to the GL`);

    const unrecognizedPrepaid = await this.prisma.prepaidExpenseSchedule.count({
      where: { tenantId, periodYear: period.year, periodMonth: period.month, status: 'PLANNED', prepaid: { organizationId, status: 'ACTIVE' } },
    });
    if (unrecognizedPrepaid > 0)
      throw new ValidationAppError(`Cannot close: ${unrecognizedPrepaid} prepaid expense schedule row(s) for this period are not yet recognized`);

    // Only require a posted CostAllocationRun when this period actually
    // has unallocated source cost sitting behind an ACTIVE rule — an
    // ACTIVE rule with nothing to allocate this period (e.g. its source
    // cost center had no expense this month) must never permanently
    // block every future close.
    const preview = await this.allocationRuns.preview(tenantId, membershipId, organizationId, {
      periodYear: period.year,
      periodMonth: period.month,
    });
    if (Number(preview.sourceAmount) > 0.005) {
      const postedRun = await this.prisma.costAllocationRun.findFirst({
        where: { tenantId, organizationId, periodYear: period.year, periodMonth: period.month, status: 'POSTED' },
      });
      if (!postedRun) throw new ValidationAppError('Cannot close: this period has unallocated cost-allocation source amount but no posted CostAllocationRun');
    }

    const updated = await this.prisma.expensePeriod.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_PERIOD_CLOSED', entityType: ENTITY_TYPE, entityId: id, action: 'UPDATE', userId });
    return updated;
  }

  async reopen(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, reason: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const period = await this.prisma.expensePeriod.findFirst({ where: { id, organizationId } });
    if (!period) throw new NotFoundAppError('ExpensePeriod', id);
    if (period.status !== 'CLOSED') throw new ValidationAppError(`Cannot reopen a period in status ${period.status}`);
    const updated = await this.prisma.expensePeriod.update({
      where: { id },
      data: { status: 'REOPENED', reopenedAt: new Date(), reopenReason: reason },
    });
    await this.audit.record({ tenantId, eventType: 'EXPENSE_PERIOD_REOPENED', entityType: ENTITY_TYPE, entityId: id, action: 'UPDATE', userId, reason });
    return updated;
  }
}
