import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AgeingService } from './ageing.service';

export interface StatementLine {
  date: string;
  documentType: string;
  documentId: string;
  description: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
  currencyId: string | null;
}

export interface Statement {
  counterpartyId: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  debitTurnover: string;
  creditTurnover: string;
  closingBalance: string;
  lines: StatementLine[];
}

/**
 * SettlementReportingService — read-only projections over
 * `SettlementMovement`/`SettlementOpenItem` (spec sections 116-125).
 * `statement` is the shared engine behind both the customer/supplier
 * account statement (section 116-117) and `SettlementReconciliationService`
 * (which persists a header over exactly this same computation).
 */
@Injectable()
export class SettlementReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly ageing: AgeingService,
  ) {}

  async statement(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, periodStart: Date, periodEnd: Date, contractId?: string): Promise<Statement> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const openingMovements = await this.prisma.settlementMovement.findMany({
      where: { tenantId, organizationId, counterpartyId, ...(contractId ? { contractId } : {}), effectiveDate: { lt: periodStart } },
    });
    const openingBalance = openingMovements.reduce((s, m) => s.plus(m.baseAmount.toString()), new Decimal(0));

    const periodMovements = await this.prisma.settlementMovement.findMany({
      where: { tenantId, organizationId, counterpartyId, ...(contractId ? { contractId } : {}), effectiveDate: { gte: periodStart, lte: periodEnd } },
      orderBy: { effectiveDate: 'asc' },
    });

    let running = openingBalance;
    let debitTurnover = new Decimal(0);
    let creditTurnover = new Decimal(0);
    const lines: StatementLine[] = periodMovements.map((m) => {
      const amount = new Decimal(m.baseAmount.toString());
      running = running.plus(amount);
      if (amount.gt(0)) debitTurnover = debitTurnover.plus(amount);
      else creditTurnover = creditTurnover.plus(amount.abs());
      return {
        date: m.effectiveDate.toISOString().slice(0, 10),
        documentType: m.sourceDocumentType,
        documentId: m.sourceDocumentId,
        description: m.description,
        debit: amount.gt(0) ? amount.toFixed(2) : '0.00',
        credit: amount.lt(0) ? amount.abs().toFixed(2) : '0.00',
        runningBalance: running.toFixed(2),
        currencyId: m.currencyId,
      };
    });

    return {
      counterpartyId,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      openingBalance: openingBalance.toFixed(2),
      debitTurnover: debitTurnover.toFixed(2),
      creditTurnover: creditTurnover.toFixed(2),
      closingBalance: running.toFixed(2),
      lines,
    };
  }

  async openReceivables(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, itemType: 'RECEIVABLE', status: { notIn: ['SETTLED', 'CANCELLED'] } }, orderBy: { dueDate: 'asc' } });
  }

  async openPayables(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, itemType: 'PAYABLE', status: { notIn: ['SETTLED', 'CANCELLED'] } }, orderBy: { dueDate: 'asc' } });
  }

  async advances(tenantId: string, membershipId: string, organizationId: string, role: 'CUSTOMER' | 'SUPPLIER') {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const itemType = role === 'CUSTOMER' ? 'CUSTOMER_ADVANCE' : 'SUPPLIER_ADVANCE';
    return this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, itemType, status: { notIn: ['CANCELLED'] } }, orderBy: { sourceDate: 'desc' } });
  }

  async unallocatedPayments(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const rows = await this.prisma.settlementOpenItem.findMany({ where: { tenantId, organizationId, itemType: { in: ['CUSTOMER_ADVANCE', 'SUPPLIER_ADVANCE'] }, status: { notIn: ['CANCELLED'] } } });
    return rows
      .filter((r) => new Decimal(r.remainingAmount.toString()).abs().gt(0.005))
      .map((r) => ({ id: r.id, counterpartyId: r.counterpartyId, itemType: r.itemType, sourceDocumentType: r.sourceDocumentType, sourceDocumentId: r.sourceDocumentId, originalAmount: r.originalAmount.toString(), remainingAmount: r.remainingAmount.toString(), ageDays: Math.floor((Date.now() - r.sourceDate.getTime()) / 86_400_000) }));
  }

  async overdueDebt(tenantId: string, membershipId: string, organizationId: string, role: 'CUSTOMER' | 'SUPPLIER') {
    const rows = await this.ageing.ageing(tenantId, membershipId, organizationId, role);
    const byCounterparty = new Map<string, { counterpartyId: string; outstanding: Decimal; overdue: Decimal; oldestDueDate: string | null; maxDaysOverdue: number }>();
    for (const r of rows) {
      const entry = byCounterparty.get(r.counterpartyId) ?? { counterpartyId: r.counterpartyId, outstanding: new Decimal(0), overdue: new Decimal(0), oldestDueDate: null, maxDaysOverdue: 0 };
      entry.outstanding = entry.outstanding.plus(r.outstanding);
      if (r.daysOverdue > 0) entry.overdue = entry.overdue.plus(r.outstanding);
      if (r.daysOverdue > entry.maxDaysOverdue) entry.maxDaysOverdue = r.daysOverdue;
      if (r.dueDate && (!entry.oldestDueDate || r.dueDate < entry.oldestDueDate)) entry.oldestDueDate = r.dueDate;
      byCounterparty.set(r.counterpartyId, entry);
    }
    return [...byCounterparty.values()].map((e) => ({ counterpartyId: e.counterpartyId, outstanding: e.outstanding.toFixed(2), overdue: e.overdue.toFixed(2), oldestDueDate: e.oldestDueDate, maxDaysOverdue: e.maxDaysOverdue }));
  }

  /** Debt movement report (spec section 123) — one period's roll-forward,
   * bucketed by movement type. */
  async debtMovement(tenantId: string, membershipId: string, organizationId: string, counterpartyId: string, periodStart: Date, periodEnd: Date) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const opening = await this.statement(tenantId, membershipId, organizationId, counterpartyId, new Date(0), periodStart);
    const movements = await this.prisma.settlementMovement.findMany({ where: { tenantId, organizationId, counterpartyId, effectiveDate: { gte: periodStart, lte: periodEnd } } });

    const bucket = (types: string[]) => movements.filter((m) => types.includes(m.movementType)).reduce((s, m) => s.plus(m.baseAmount.toString()), new Decimal(0));
    const newDebt = bucket(['RECEIVABLE_CREATE', 'PAYABLE_CREATE']);
    const payments = bucket(['RECEIVABLE_REDUCE', 'PAYABLE_REDUCE']).minus(bucket(['CUSTOMER_ADVANCE_APPLY', 'SUPPLIER_ADVANCE_APPLY']));
    const returns = bucket(['CREDIT_NOTE']);
    const offsets = bucket(['OFFSET']);
    const adjustments = bucket(['RECLASSIFICATION', 'DEBIT_NOTE']);
    const writeOff = bucket(['WRITE_OFF']);
    const fx = bucket(['FX_ADJUSTMENT']);
    const closing = new Decimal(opening.closingBalance).plus(newDebt).plus(payments).plus(returns).plus(offsets).plus(adjustments).plus(writeOff).plus(fx);

    return {
      counterpartyId,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      opening: opening.closingBalance,
      newDebt: newDebt.toFixed(2),
      payments: payments.toFixed(2),
      returns: returns.toFixed(2),
      offsets: offsets.toFixed(2),
      adjustments: adjustments.toFixed(2),
      writeOff: writeOff.toFixed(2),
      fx: fx.toFixed(2),
      closing: closing.toFixed(2),
    };
  }
}
