import { Injectable } from '@nestjs/common';
import { AccountingQueryService } from '../accounting-core/accounting-query.service';

/**
 * TrialBalanceReportingService (docx spec Phase 23, sections 21-24).
 * Delegates entirely to Phase 4's own `AccountingQueryService.trialBalance`
 * — the exact opening/turnover/closing debit-credit columns spec section
 * 21 asks for already exist there and read the same immutable
 * `AccountingMovement` register this whole phase is built on, so this is
 * a thin Phase-23-shaped wrapper, not a second Trial Balance
 * implementation (spec section 131's own "Financial Reporting bu
 * modulların balances-lərini duplicate etməməlidir").
 */
@Injectable()
export class TrialBalanceReportingService {
  constructor(private readonly query: AccountingQueryService) {}

  async run(tenantId: string, membershipId: string, organizationId: string, periodStart: Date, periodEnd: Date, accountId?: string) {
    const rows = await this.query.trialBalance(tenantId, membershipId, organizationId, { fromDate: periodStart, toDate: periodEnd, accountId });
    const totals = rows.reduce(
      (acc, r) => ({
        openingDebit: acc.openingDebit + Number(r.openingDebit),
        openingCredit: acc.openingCredit + Number(r.openingCredit),
        turnoverDebit: acc.turnoverDebit + Number(r.turnoverDebit),
        turnoverCredit: acc.turnoverCredit + Number(r.turnoverCredit),
        closingDebit: acc.closingDebit + Number(r.closingDebit),
        closingCredit: acc.closingCredit + Number(r.closingCredit),
      }),
      { openingDebit: 0, openingCredit: 0, turnoverDebit: 0, turnoverCredit: 0, closingDebit: 0, closingCredit: 0 },
    );
    return { rows, totals, balanced: Math.abs(totals.closingDebit - totals.closingCredit) < 0.01 };
  }
}
