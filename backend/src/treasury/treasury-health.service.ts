import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { BankCashMovementService } from './bank-cash-movement.service';

export interface TreasuryHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  bankAccountId?: string;
  documentId?: string;
  message: string;
}

/**
 * TreasuryHealthService (spec sections 141-142). Computed live — same
 * "rebuildable projection" pattern as every other health service in this
 * codebase (Phase 11/12/13's own).
 */
@Injectable()
export class TreasuryHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async check(tenantId: string, organizationId: string): Promise<TreasuryHealthIssue[]> {
    const issues: TreasuryHealthIssue[] = [];

    const approvedNotPlanned = await this.prisma.paymentRequest.count({ where: { tenantId, organizationId, status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] }, treasuryStatus: 'UNPLANNED' } });
    if (approvedNotPlanned > 0) issues.push({ code: 'APPROVED_REQUEST_NOT_PLANNED', severity: 'WARNING', message: `${approvedNotPlanned} approved payment request(s) have no calendar item yet.` });

    const overdueUnpaid = await this.prisma.paymentRequest.count({ where: { tenantId, organizationId, status: { in: ['APPROVED', 'PARTIALLY_APPROVED', 'PARTIALLY_PAID'] }, requestedPaymentDate: { lt: new Date() } } });
    if (overdueUnpaid > 0) issues.push({ code: 'OVERDUE_APPROVED_REQUEST_UNPAID', severity: 'WARNING', message: `${overdueUnpaid} approved payment request(s) are past their requested payment date and still not fully paid.` });

    const unallocated = await this.prisma.settlementPayment.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED', counterpartyId: { not: null } } });
    for (const p of unallocated) {
      const allocated = await this.prisma.settlementAllocation.aggregate({ where: { tenantId, paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: p.id, status: 'ACTIVE' }, _sum: { paymentAmount: true } });
      const advanced = await this.prisma.settlementAdvance.aggregate({ where: { tenantId, sourceDocumentType: 'SETTLEMENT_PAYMENT', sourceDocumentId: p.id }, _sum: { originalAmount: true } });
      const remaining = new Decimal(p.amount.toString()).minus((allocated._sum.paymentAmount ?? 0).toString()).minus((advanced._sum.originalAmount ?? 0).toString());
      if (remaining.gt('0.01') && Date.now() - p.documentDate.getTime() > 7 * 86_400_000) {
        issues.push({ code: 'UNALLOCATED_BANK_PAYMENT', severity: 'WARNING', documentId: p.id, message: `Bank payment ${p.number ?? p.id} has ${remaining.toString()} unallocated for over 7 days.` });
      }
    }

    const staleUnmatched = await this.prisma.bankStatementLine.count({ where: { tenantId, matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] }, transactionDate: { lt: new Date(Date.now() - 14 * 86_400_000) } } });
    if (staleUnmatched > 0) issues.push({ code: 'STALE_UNMATCHED_STATEMENT_LINE', severity: 'ERROR', message: `${staleUnmatched} bank statement line(s) unmatched for over 14 days.` });

    const openReconciliations = await this.prisma.bankReconciliation.findMany({ where: { tenantId, organizationId, status: { in: ['DIFFERENCE_FOUND', 'IN_PROGRESS'] } } });
    for (const r of openReconciliations) issues.push({ code: 'RECONCILIATION_DIFFERENCE', severity: 'ERROR', bankAccountId: r.bankAccountId, documentId: r.id, message: `Bank reconciliation for account ${r.bankAccountId} has an unresolved difference of ${r.difference.toString()}.` });

    const accounts = await this.prisma.bankAccount.findMany({ where: { organizationId, active: true } });
    for (const a of accounts) {
      const balance = await this.bankCash.getBookBalance(tenantId, a.id);
      if (balance.lt(0) && !a.overdraftAllowed) issues.push({ code: 'BANK_BALANCE_MISMATCH', severity: 'BLOCKING', bankAccountId: a.id, message: `Bank account ${a.accountName} book balance is negative (${balance.toString()}) without overdraft allowed.` });
    }

    return issues;
  }
}
