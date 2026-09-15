import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';

export interface SettlementHealthIssue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'BLOCKING';
  counterpartyId?: string;
  documentId?: string;
  amount?: string;
  message: string;
}

const ROUNDING_TOLERANCE = new Decimal('0.02');

/**
 * SettlementHealthService (spec sections 114-115, 169-170). Computed live
 * — no persisted `settlement_health_issues` table (same "rebuildable
 * projection" pattern as Phase 11/12's own health reports).
 */
@Injectable()
export class SettlementHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(tenantId: string, organizationId: string): Promise<SettlementHealthIssue[]> {
    const issues: SettlementHealthIssue[] = [];

    // Overallocated / negative remaining (should be structurally
    // impossible given OpenItemService's own guard, but verified here).
    const negativeReceivables = await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, remainingAmount: { lt: 0 } } });
    for (const r of negativeReceivables) issues.push({ code: 'NEGATIVE_REMAINING_RECEIVABLE', severity: 'ERROR', counterpartyId: r.counterpartyId, documentId: r.id, amount: r.remainingAmount?.toString(), message: `Open item ${r.id} has a negative remaining amount.` });

    const negativePayables = await this.prisma.supplierPayable.findMany({ where: { tenantId, organizationId, remainingAmount: { lt: 0 } } });
    for (const p of negativePayables) issues.push({ code: 'NEGATIVE_REMAINING_PAYABLE', severity: 'ERROR', counterpartyId: p.counterpartyId, documentId: p.id, amount: p.remainingAmount?.toString(), message: `Open item ${p.id} has a negative remaining amount.` });

    // Settled item with residual base-currency amount (FX/rounding
    // anomaly, spec sections 112, 170).
    const settledWithResidual = await this.prisma.settlementObligation.findMany({ where: { tenantId, organizationId, status: 'SETTLED', remainingAmount: { not: 0 } } });
    for (const r of settledWithResidual) {
      const residual = new Decimal(r.remainingAmount!.toString()).abs();
      if (residual.gt(ROUNDING_TOLERANCE)) issues.push({ code: 'SETTLED_WITH_RESIDUAL', severity: 'WARNING', counterpartyId: r.counterpartyId, documentId: r.id, amount: residual.toString(), message: `Settled open item ${r.id} still carries a ${residual.toString()} residual — verify rounding/FX write-off.` });
    }

    // Missing due date.
    const missingDueDate = await this.prisma.settlementObligation.count({ where: { tenantId, organizationId, dueDate: null, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } } });
    if (missingDueDate > 0) issues.push({ code: 'MISSING_DUE_DATE', severity: 'WARNING', message: `${missingDueDate} open receivable(s) have no due date — ageing cannot be computed for them.` });

    // Unallocated payments older than a nominal threshold.
    const payments = await this.prisma.settlementPayment.findMany({ where: { tenantId, organizationId, postingStatus: 'POSTED' } });
    for (const p of payments) {
      const allocated = await this.prisma.settlementAllocation.aggregate({ where: { tenantId, paymentDocumentType: 'SETTLEMENT_PAYMENT', paymentDocumentId: p.id, status: 'ACTIVE' }, _sum: { paymentAmount: true } });
      const advanced = await this.prisma.settlementAdvance.aggregate({ where: { tenantId, sourceDocumentType: 'SETTLEMENT_PAYMENT', sourceDocumentId: p.id }, _sum: { originalAmount: true } });
      const unallocated = new Decimal(p.amount.toString()).minus((allocated._sum.paymentAmount ?? 0).toString()).minus((advanced._sum.originalAmount ?? 0).toString());
      if (unallocated.gt(ROUNDING_TOLERANCE)) issues.push({ code: 'UNALLOCATED_PAYMENT', severity: 'INFO', counterpartyId: p.counterpartyId, documentId: p.id, amount: unallocated.toString(), message: `Payment ${p.number ?? p.id} has ${unallocated.toString()} unallocated.` });
    }

    // Advance with negative balance (should be impossible, verified).
    const negativeAdvances = await this.prisma.settlementAdvance.count({ where: { tenantId, organizationId, remainingAmount: { lt: 0 } } });
    if (negativeAdvances > 0) issues.push({ code: 'NEGATIVE_ADVANCE_BALANCE', severity: 'ERROR', message: `${negativeAdvances} advance(s) have a negative remaining balance.` });

    return issues;
  }

  /** AR/AP vs GL reconciliation (spec sections 110, 169) — sums the
   * settlement subledger's own open balances and compares to the
   * resolved AR/AP GL account's posted balance. A real implementation
   * needs `AccountingMappingService`/ledger balance queries; wired at the
   * controller layer where those services are already available (see
   * `SettlementController.arVsGl`) rather than duplicated here. */
  async subledgerTotals(tenantId: string, organizationId: string) {
    const ar = await this.prisma.settlementObligation.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] } }, _sum: { remainingAmount: true } });
    const ap = await this.prisma.supplierPayable.aggregate({ where: { tenantId, organizationId, status: { notIn: ['CANCELLED'] } }, _sum: { remainingAmount: true } });
    return { receivable: new Decimal((ar._sum.remainingAmount ?? 0).toString()).toString(), payable: new Decimal((ap._sum.remainingAmount ?? 0).toString()).toString() };
  }
}
