import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';

/**
 * AccountablePersonService (spec sections 27-32). Employee advances are
 * their own settlement dimension — never forced through Phase 13's
 * counterparty-shaped `SettlementObligation`/`SettlementAdvance` (spec
 * section 27). A standalone module for the same cycle-avoidance reason as
 * `CashMovementService`/`BankCashMovementService`.
 */
@Injectable()
export class AccountablePersonService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tenantId: string, input: { organizationId: string; employeeId: string; currencyId: string; movementType: 'ISSUE' | 'RETURN' | 'EXPENSE_REPORTED' | 'OVERSPEND_REIMBURSEMENT'; amount: Decimal; sourceDocumentType: string; sourceDocumentId: string; advanceMovementId?: string | null; effectiveDate: Date }, tx: PrismaTransactionClient) {
    const signed = ['RETURN', 'EXPENSE_REPORTED'].includes(input.movementType) ? input.amount.abs().negated() : input.amount.abs();
    return tx.accountablePersonMovement.create({
      data: {
        tenantId,
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        currencyId: input.currencyId,
        movementType: input.movementType,
        amount: signed.toString(),
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId,
        advanceMovementId: input.advanceMovementId ?? undefined,
        effectiveDate: input.effectiveDate,
      },
    });
  }

  async reverse(tenantId: string, sourceDocumentType: string, sourceDocumentId: string, tx: PrismaTransactionClient) {
    await tx.accountablePersonMovement.deleteMany({ where: { tenantId, sourceDocumentType, sourceDocumentId } });
  }

  /** Outstanding balance (spec section 27) — computed live, never a
   * stored projection. */
  async getOutstanding(tenantId: string, organizationId: string, employeeId: string, currencyId?: string, tx?: PrismaTransactionClient): Promise<Decimal> {
    const db = tx ?? this.prisma;
    const agg = await db.accountablePersonMovement.aggregate({ where: { tenantId, organizationId, employeeId, currencyId }, _sum: { amount: true } });
    return new Decimal((agg._sum.amount ?? 0).toString());
  }

  async summary(tenantId: string, organizationId: string, employeeId: string) {
    const movements = await this.prisma.accountablePersonMovement.findMany({ where: { tenantId, organizationId, employeeId }, orderBy: { effectiveDate: 'asc' } });
    const issued = movements.filter((m) => m.movementType === 'ISSUE').reduce((s, m) => s.plus(m.amount.toString()), new Decimal(0));
    const reported = movements.filter((m) => m.movementType === 'EXPENSE_REPORTED').reduce((s, m) => s.plus(new Decimal(m.amount.toString()).abs()), new Decimal(0));
    const returned = movements.filter((m) => m.movementType === 'RETURN').reduce((s, m) => s.plus(new Decimal(m.amount.toString()).abs()), new Decimal(0));
    const outstanding = movements.reduce((s, m) => s.plus(m.amount.toString()), new Decimal(0));
    return { issued: issued.toString(), reported: reported.toString(), returned: returned.toString(), outstanding: outstanding.toString(), movements };
  }

  async ageingReport(tenantId: string, organizationId: string, asOfDate: Date = new Date()) {
    const employees = await this.prisma.accountablePersonMovement.findMany({ where: { tenantId, organizationId }, distinct: ['employeeId'], select: { employeeId: true } });
    const rows = [];
    for (const { employeeId } of employees) {
      const s = await this.summary(tenantId, organizationId, employeeId);
      const firstIssue = s.movements.find((m) => m.movementType === 'ISSUE');
      if (new Decimal(s.outstanding).lte(0.01)) continue;
      rows.push({ employeeId, ...s, daysOutstanding: firstIssue ? Math.floor((asOfDate.getTime() - firstIssue.effectiveDate.getTime()) / 86_400_000) : null });
    }
    return rows;
  }
}
