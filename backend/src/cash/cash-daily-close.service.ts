import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CashMovementService } from './cash-movement.service';

/**
 * CashDailyCloseService (spec sections 45-47, 76-78). A close for
 * `businessDate` is only allowed to reach CLOSED once every gate holds:
 *  1. no cash document for this desk dated on/before `businessDate` is
 *     still DRAFT/PENDING_APPROVAL (spec: "bütün kassa sənədləri valid
 *     olmalıdır") — checked across CashDeskTransfer, CashCountAdjustment,
 *     and cash-leg SettlementPayment (the spec's CashReceiptOrder/
 *     CashExpenseOrder, see schema.prisma's SettlementPayment doc).
 *  2. a physical count exists for the day if the desk requires one
 *     (`Cashbox.requireDenominationCount`) — otherwise COUNT_REQUIRED.
 *  3. any such count's difference has already been resolved by a posted
 *     CashCountAdjustment referencing it — otherwise DIFFERENCE_FOUND.
 *  4. no PENDING/DIFFERENCE_PENDING CashierHandover is open on this desk
 *     — otherwise PENDING_APPROVAL.
 * Each gate failure returns its own status rather than throwing, so a
 * caller can poll "why can't I close" without a failed request each time;
 * only calling `close` on a desk with zero blockers actually flips the row
 * to CLOSED.
 */
@Injectable()
export class CashDailyCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly cashMovements: CashMovementService,
  ) {}

  private dayBounds(businessDate: Date) {
    const start = new Date(Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), businessDate.getUTCDate(), 0, 0, 0));
    const end = new Date(Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), businessDate.getUTCDate(), 23, 59, 59, 999));
    return { start, end };
  }

  async attempt(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { cashDeskId: string; currencyId: string; businessDate: string; cashierId?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const desk = await this.prisma.cashbox.findFirst({ where: { id: dto.cashDeskId, tenantId, organizationId } });
    if (!desk) throw new NotFoundAppError('Cashbox', dto.cashDeskId);
    const businessDate = this.parseDate(dto.businessDate);
    const { start, end } = this.dayBounds(businessDate);

    const [openTransfers, openAdjustments, openPayments] = await Promise.all([
      this.prisma.cashDeskTransfer.count({ where: { tenantId, OR: [{ sourceCashDeskId: dto.cashDeskId }, { destinationCashDeskId: dto.cashDeskId }], status: { not: 'CANCELLED' }, postingStatus: { not: 'POSTED' }, documentDate: { lte: end } } }),
      this.prisma.cashCountAdjustment.count({ where: { tenantId, cashDeskId: dto.cashDeskId, status: { not: 'CANCELLED' }, postingStatus: { not: 'POSTED' }, documentDate: { lte: end } } }),
      this.prisma.settlementPayment.count({ where: { tenantId, cashDeskId: dto.cashDeskId, status: { not: 'CANCELLED' }, postingStatus: { not: 'POSTED' }, documentDate: { lte: end } } }),
    ]);
    if (openTransfers + openAdjustments + openPayments > 0) {
      return { status: 'BLOCKED', reason: 'UNPOSTED_CASH_DOCUMENTS', count: openTransfers + openAdjustments + openPayments };
    }

    let physicalCount: { id: string; difference: Decimal } | null = null;
    if (desk.requireDenominationCount) {
      const count = await this.prisma.cashPhysicalCount.findFirst({ where: { tenantId, cashDeskId: dto.cashDeskId, currencyId: dto.currencyId, countTimestamp: { gte: start, lte: end } }, orderBy: { countTimestamp: 'desc' } });
      if (!count) return { status: 'COUNT_REQUIRED', reason: 'No physical count recorded for this business date yet.' };
      physicalCount = { id: count.id, difference: new Decimal(count.difference.toString()) };
      if (!physicalCount.difference.abs().lte('0.01')) {
        const resolved = await this.prisma.cashCountAdjustment.findFirst({ where: { tenantId, physicalCountId: count.id, postingStatus: 'POSTED' } });
        if (!resolved) return { status: 'DIFFERENCE_FOUND', reason: 'Physical count difference has not been resolved by a posted CashCountAdjustment yet.', physicalCountId: count.id, difference: physicalCount.difference.toString() };
      }
    }

    const openHandover = await this.prisma.cashierHandover.findFirst({ where: { tenantId, cashDeskId: dto.cashDeskId, status: { in: ['PENDING', 'DIFFERENCE_PENDING'] }, handoverAt: { lte: end } } });
    if (openHandover) return { status: 'PENDING_APPROVAL', reason: 'A cashier handover on this desk is still open.', handoverId: openHandover.id };

    return this.close(tenantId, organizationId, userId, dto, desk, businessDate, physicalCount);
  }

  private async close(
    tenantId: string,
    organizationId: string,
    userId: string,
    dto: { cashDeskId: string; currencyId: string; cashierId?: string },
    desk: { id: string },
    businessDate: Date,
    physicalCount: { id: string; difference: Decimal } | null,
  ) {
    const { start, end } = this.dayBounds(businessDate);
    const previousClose = await this.prisma.cashDailyClose.findFirst({ where: { tenantId, cashDeskId: dto.cashDeskId, currencyId: dto.currencyId, businessDate: { lt: start } }, orderBy: { businessDate: 'desc' } });
    const openingBookBalance = previousClose ? new Decimal(previousClose.closingBookBalance.toString()) : await this.cashMovements.getBalance(tenantId, dto.cashDeskId, dto.currencyId, undefined, new Date(start.getTime() - 1));
    const closingBookBalance = await this.cashMovements.getBalance(tenantId, dto.cashDeskId, dto.currencyId, undefined, end);

    const [receipts, expenses] = await Promise.all([
      this.prisma.cashMovement.aggregate({ where: { tenantId, cashDeskId: dto.cashDeskId, currencyId: dto.currencyId, direction: 'INFLOW', reversed: false, effectiveDate: { gte: start, lte: end } }, _sum: { amount: true } }),
      this.prisma.cashMovement.aggregate({ where: { tenantId, cashDeskId: dto.cashDeskId, currencyId: dto.currencyId, direction: 'OUTFLOW', reversed: false, effectiveDate: { gte: start, lte: end } }, _sum: { amount: true } }),
    ]);

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.cashDailyClose.upsert({
        where: { tenantId_cashDeskId_businessDate_currencyId: { tenantId, cashDeskId: dto.cashDeskId, businessDate: start, currencyId: dto.currencyId } },
        create: {
          tenantId,
          cashDeskId: dto.cashDeskId,
          businessDate: start,
          cashierId: dto.cashierId,
          currencyId: dto.currencyId,
          openingBookBalance: openingBookBalance.toString(),
          totalReceipts: (receipts._sum.amount ?? 0).toString(),
          totalExpenses: (expenses._sum.amount ?? 0).toString(),
          closingBookBalance: closingBookBalance.toString(),
          physicalCountId: physicalCount?.id,
          difference: (physicalCount?.difference ?? new Decimal(0)).toString(),
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: userId,
        },
        update: {
          totalReceipts: (receipts._sum.amount ?? 0).toString(),
          totalExpenses: (expenses._sum.amount ?? 0).toString(),
          closingBookBalance: closingBookBalance.toString(),
          physicalCountId: physicalCount?.id,
          difference: (physicalCount?.difference ?? new Decimal(0)).toString(),
          status: 'CLOSED',
          closedAt: new Date(),
          closedBy: userId,
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
        },
      });
      await this.audit.record({ tenantId, eventType: 'CASH_DAY_CLOSED', entityType: 'CASH_DAILY_CLOSE', entityId: row.id, action: 'CREATE', userId, newValues: { businessDate, closingBookBalance: closingBookBalance.toString() } }, tx);
      return row;
    });
  }

  async reopen(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, reason: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!reason) throw new ValidationAppError('A reason is required to reopen a closed cash day');
    const row = await this.prisma.cashDailyClose.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('CashDailyClose', id);
    if (row.status !== 'CLOSED') throw new ValidationAppError(`Cannot reopen — current status is ${row.status}`);
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.cashDailyClose.update({ where: { id }, data: { status: 'REOPENED', reopenedAt: new Date(), reopenedBy: userId, reopenReason: reason } });
      await this.audit.record({ tenantId, eventType: 'CASH_DAY_REOPENED', entityType: 'CASH_DAILY_CLOSE', entityId: id, action: 'UPDATE', userId, newValues: { reason } }, tx);
      return updated;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, cashDeskId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.cashDailyClose.findMany({ where: { tenantId, cashDeskId }, orderBy: { businessDate: 'desc' } }));
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid business date');
    return date;
  }
}
