import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CashMovementService } from './cash-movement.service';

export interface CashHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  cashDeskId?: string;
  documentId?: string;
  message: string;
}

/**
 * CashHealthService (spec section 27 intro: "kassa qalığı, kassirin
 * fiziki əlində olan pul, GL Cash Account balansı üç ayrı reconciliation
 * nöqtəsi"). Computed live — the same "rebuildable projection" pattern as
 * `TreasuryHealthService`/every other health service in this codebase;
 * never a stored/mutable health row. Cross-checking against the GL Cash
 * Account balance itself (the third of the three points) is left for
 * `AccountingReportingService` (out of this build's scope, disclosed
 * simplification) — this pass covers cash-desk-internal consistency
 * (book vs. physical, stale differences, open handovers, unclosed days).
 */
@Injectable()
export class CashHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashMovements: CashMovementService,
  ) {}

  async check(tenantId: string, organizationId: string): Promise<CashHealthIssue[]> {
    const issues: CashHealthIssue[] = [];

    const desks = await this.prisma.cashbox.findMany({ where: { organizationId, active: true } });
    for (const desk of desks) {
      if (desk.negativeBalancePolicy === 'NEVER') {
        const balances = await this.cashMovements.getBalancesByCurrency(tenantId, desk.id);
        for (const b of balances) {
          if (Number(b.balance) < 0) issues.push({ code: 'CASH_BALANCE_NEGATIVE', severity: 'BLOCKING', cashDeskId: desk.id, message: `Cash desk ${desk.name} has a negative ${b.currencyId} balance (${b.balance}) despite a NEVER negative-balance policy.` });
        }
      }
      if (desk.maxCashLimit) {
        const balances = await this.cashMovements.getBalancesByCurrency(tenantId, desk.id);
        for (const b of balances) {
          if (b.currencyId === desk.currencyId && Number(b.balance) > Number(desk.maxCashLimit.toString())) {
            issues.push({ code: 'CASH_LIMIT_EXCEEDED', severity: 'WARNING', cashDeskId: desk.id, message: `Cash desk ${desk.name} balance ${b.balance} exceeds its max cash limit ${desk.maxCashLimit.toString()}.` });
          }
        }
      }
    }

    const unresolvedDifferences = await this.prisma.cashPhysicalCount.findMany({ where: { tenantId, difference: { not: 0 } } });
    for (const count of unresolvedDifferences) {
      const resolved = await this.prisma.cashCountAdjustment.findFirst({ where: { tenantId, physicalCountId: count.id, postingStatus: 'POSTED' } });
      if (!resolved) issues.push({ code: 'UNRESOLVED_COUNT_DIFFERENCE', severity: 'ERROR', cashDeskId: count.cashDeskId, documentId: count.id, message: `Physical count ${count.id} has an unresolved difference of ${count.difference.toString()}.` });
    }

    const openHandovers = await this.prisma.cashierHandover.findMany({ where: { tenantId, status: { in: ['PENDING', 'DIFFERENCE_PENDING'] }, handoverAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
    for (const h of openHandovers) issues.push({ code: 'STALE_OPEN_HANDOVER', severity: 'WARNING', cashDeskId: h.cashDeskId, documentId: h.id, message: `Cashier handover ${h.id} has been open for over 24 hours.` });

    const unclosedDays = await this.prisma.cashDailyClose.findMany({ where: { tenantId, status: { in: ['COUNT_REQUIRED', 'DIFFERENCE_FOUND', 'PENDING_APPROVAL'] } } });
    for (const d of unclosedDays) issues.push({ code: 'CASH_DAY_NOT_CLOSED', severity: 'WARNING', cashDeskId: d.cashDeskId, documentId: d.id, message: `Cash day ${d.businessDate.toISOString().slice(0, 10)} for desk ${d.cashDeskId} is still ${d.status}.` });

    return issues;
  }
}
