import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  CashBalanceService,
  CASH_MOVEMENT_REGISTER,
} from './cash-balance.service';

const ENTITY_TYPE = 'CashDeskDailyClose';

/**
 * CashDeskDailyClose (docx spec Phase 15, "Daily Close") — a per-cashbox/
 * per-business-date checkpoint, the exact cash-side mirror of
 * BankReconciliationPeriodService (Phase 14): `refresh` recomputes
 * opening/closing book balances and totals from CASH_MOVEMENT_REGISTER
 * (never a mutable field) and derives readiness; `close` re-validates
 * that same readiness before persisting CLOSED, so a stale read can never
 * slip a not-actually-ready close through.
 *
 * Status ladder: OPEN (nothing outstanding) -> COUNT_REQUIRED (cashbox
 * policy requires a physical count and none is linked/approved yet) ->
 * DIFFERENCE_FOUND (an approved count's difference has no resolving
 * CashCountAdjustment yet) -> PENDING_APPROVAL (the adjustment exists but
 * is not yet POSTED) -> CLOSED. REOPENED is a terminal-but-editable state
 * set by `reopen`, mirroring bank reconciliation's own.
 */
@Injectable()
export class CashDeskDailyCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly cashBalance: CashBalanceService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.cashDeskDailyClose.findMany({
          where: { organizationId, ...(cashboxId ? { cashboxId } : {}) },
          orderBy: { businessDate: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashDeskDailyClose.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError(ENTITY_TYPE, id);
    return row;
  }

  async open(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    cashboxId: string,
    businessDate: string,
    cashierId?: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cashbox = await this.prisma.cashbox.findFirst({
      where: { id: cashboxId, organizationId },
    });
    if (!cashbox)
      throw new ValidationAppError(
        'Cashbox does not belong to this organization',
      );
    const date = this.parseDate(businessDate);

    const existing = await this.prisma.cashDeskDailyClose.findUnique({
      where: {
        organizationId_cashboxId_businessDate: {
          organizationId,
          cashboxId,
          businessDate: date,
        },
      },
    });
    if (existing)
      throw new ValidationAppError(
        'A daily close already exists for this cash desk and date',
      );

    const { openingBookBalance } = await this.computeNumbers(
      tenantId,
      cashboxId,
      date,
    );

    const created = await this.prisma.cashDeskDailyClose.create({
      data: {
        tenantId,
        organizationId,
        cashboxId,
        businessDate: date,
        cashierId,
        openingBookBalance,
        closingBookBalance: openingBookBalance,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'CASH_DESK_DAILY_CLOSE_OPENED',
      entityType: ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { cashboxId, businessDate },
    });
    return created;
  }

  async linkPhysicalCount(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    physicalCountId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'CLOSED')
      throw new ValidationAppError(
        'Cannot modify a closed daily close — reopen it first',
      );
    const count = await this.prisma.cashPhysicalCount.findFirst({
      where: { id: physicalCountId, organizationId },
    });
    if (!count)
      throw new ValidationAppError(
        'Physical count does not belong to this organization',
      );
    if (count.cashboxId !== current.cashboxId)
      throw new ValidationAppError(
        'Physical count is against a different cash desk',
      );

    const result = await this.prisma.cashDeskDailyClose.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: { physicalCountId, updatedBy: userId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'CASH_DESK_DAILY_CLOSE_COUNT_LINKED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { physicalCountId },
    });
    return this.refresh(tenantId, membershipId, organizationId, id);
  }

  private async computeNumbers(
    tenantId: string,
    cashboxId: string,
    businessDate: Date,
  ) {
    const dayBefore = new Date(businessDate);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const openingBookBalance = await this.cashBalance.getBookBalance(
      tenantId,
      cashboxId,
      dayBefore,
    );

    const nextDay = new Date(businessDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const dayMovements = await this.prisma.registerMovement.findMany({
      where: {
        tenantId,
        registerCode: CASH_MOVEMENT_REGISTER,
        businessDate: { gte: businessDate, lt: nextDay },
        dimensions: { path: ['cashboxId'], equals: cashboxId },
      },
    });
    const { totalReceipts, totalExpenses } = dayMovements.reduce(
      (acc, m) => {
        const resources = m.resources as {
          amount?: string;
          direction?: string;
        } | null;
        if (!resources?.amount) return acc;
        const amount = new Decimal(resources.amount);
        if (
          resources.direction === 'PAYMENT' ||
          resources.direction === 'OUTFLOW'
        )
          acc.totalExpenses = acc.totalExpenses.plus(amount);
        else acc.totalReceipts = acc.totalReceipts.plus(amount);
        return acc;
      },
      { totalReceipts: new Decimal(0), totalExpenses: new Decimal(0) },
    );
    const closingBookBalance = openingBookBalance
      .plus(totalReceipts)
      .minus(totalExpenses);
    return {
      openingBookBalance,
      totalReceipts,
      totalExpenses,
      closingBookBalance,
    };
  }

  private async computeStatus(
    organizationId: string,
    cashboxId: string,
    physicalCountId: string | null,
  ) {
    const cashbox = await this.prisma.cashbox.findFirst({
      where: { id: cashboxId, organizationId },
    });
    if (cashbox?.requireDenominationCount && !physicalCountId)
      return { status: 'COUNT_REQUIRED', difference: null as Decimal | null };
    if (!physicalCountId) return { status: 'OPEN', difference: null };

    const count = await this.prisma.cashPhysicalCount.findFirst({
      where: { id: physicalCountId },
    });
    if (!count || count.status !== 'APPROVED')
      return { status: 'COUNT_REQUIRED', difference: null };

    const difference = new Decimal(count.difference?.toString() ?? '0');
    if (difference.isZero()) return { status: 'OPEN', difference };

    const adjustment = await this.prisma.cashCountAdjustment.findFirst({
      where: { countId: physicalCountId },
    });
    if (!adjustment) return { status: 'DIFFERENCE_FOUND', difference };
    if (adjustment.postingStatus !== 'POSTED')
      return { status: 'PENDING_APPROVAL', difference };
    return { status: 'OPEN', difference };
  }

  async refresh(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'CLOSED')
      throw new ValidationAppError(
        'Cannot refresh a closed daily close — reopen it first',
      );

    const numbers = await this.computeNumbers(
      tenantId,
      current.cashboxId,
      current.businessDate,
    );
    const { status, difference } = await this.computeStatus(
      organizationId,
      current.cashboxId,
      current.physicalCountId,
    );

    return this.prisma.cashDeskDailyClose.update({
      where: { id },
      data: {
        openingBookBalance: numbers.openingBookBalance,
        totalReceipts: numbers.totalReceipts,
        totalExpenses: numbers.totalExpenses,
        closingBookBalance: numbers.closingBookBalance,
        difference,
        status,
        version: { increment: 1 },
      },
    });
  }

  async close(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'CLOSED')
      throw new ValidationAppError('Already closed');

    const numbers = await this.computeNumbers(
      tenantId,
      current.cashboxId,
      current.businessDate,
    );
    const { status, difference } = await this.computeStatus(
      organizationId,
      current.cashboxId,
      current.physicalCountId,
    );
    if (status !== 'OPEN') {
      throw new ValidationAppError(
        `Cannot close: status is ${status} — resolve it before closing`,
      );
    }

    const result = await this.prisma.cashDeskDailyClose.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        openingBookBalance: numbers.openingBookBalance,
        totalReceipts: numbers.totalReceipts,
        totalExpenses: numbers.totalExpenses,
        closingBookBalance: numbers.closingBookBalance,
        difference,
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: userId,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'CASH_DESK_DAILY_CLOSE_CLOSED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  async reopen(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    expectedVersion: number,
    reason: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status !== 'CLOSED')
      throw new ValidationAppError('Only a CLOSED daily close can be reopened');
    if (!reason?.trim())
      throw new ValidationAppError('A reopen reason is required');

    const result = await this.prisma.cashDeskDailyClose.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        status: 'REOPENED',
        reopenReason: reason,
        reopenedAt: new Date(),
        reopenedBy: userId,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'CASH_DESK_DAILY_CLOSE_REOPENED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { reason },
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
