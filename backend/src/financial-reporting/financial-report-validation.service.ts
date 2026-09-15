import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodCloseOrchestrator } from '../period-close/period-close-orchestrator.service';

export interface ValidationOutcome {
  ruleCode: string;
  status: 'PASS' | 'WARNING' | 'FAIL' | 'BLOCKING';
  detail: Record<string, unknown>;
}

/**
 * FinancialReportValidationService (docx spec Phase 23, sections
 * 102-111). Built-in cross-statement checks (spec section 108) plus any
 * tenant-defined `FinancialReportValidationRule` rows. Never auto-plugs
 * a discrepancy (spec section 193's own critical rule, mirroring Phase
 * 22's own reconciliation engine) — a BLOCKING result simply blocks
 * finalization.
 */
@Injectable()
export class FinancialReportValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly closeOrchestrator: PeriodCloseOrchestrator,
  ) {}

  async validateBalanceSheet(equationDifference: string, tolerance = '0.01'): Promise<ValidationOutcome> {
    const diff = new Decimal(equationDifference).abs();
    return { ruleCode: 'BS_EQUATION', status: diff.lte(tolerance) ? 'PASS' : 'BLOCKING', detail: { difference: equationDifference, tolerance } };
  }

  async validateTrialBalance(totals: { closingDebit: number; closingCredit: number }): Promise<ValidationOutcome> {
    const diff = new Decimal(totals.closingDebit).minus(totals.closingCredit).abs();
    return { ruleCode: 'TB_DEBIT_CREDIT', status: diff.lte('0.01') ? 'PASS' : 'BLOCKING', detail: { closingDebit: totals.closingDebit, closingCredit: totals.closingCredit } };
  }

  /** P&L net result vs. Phase 22's own authoritative financial result
   * for the same period (spec sections 37, 105, 170). */
  async validatePnlAgainstCloseResult(pnlNetResult: string, tenantId: string, organizationId: string, closeRunId: string | undefined): Promise<ValidationOutcome> {
    if (!closeRunId) return { ruleCode: 'PNL_VS_CLOSE_RESULT', status: 'WARNING', detail: { reason: 'No close run referenced — cannot cross-validate against Phase 22 financial result.' } };
    const run = await this.closeOrchestrator.getRun(tenantId, closeRunId).catch(() => null);
    const step = run?.steps.find((s: { stepCode: string }) => s.stepCode === 'FINANCIAL_RESULT');
    const closeNetResult = (step?.resultSummary as { netResult?: string } | null)?.netResult;
    if (closeNetResult === undefined) return { ruleCode: 'PNL_VS_CLOSE_RESULT', status: 'WARNING', detail: { reason: 'Close run has no FINANCIAL_RESULT step outcome yet.' } };
    const diff = new Decimal(pnlNetResult).minus(closeNetResult).abs();
    return { ruleCode: 'PNL_VS_CLOSE_RESULT', status: diff.lte('0.01') ? 'PASS' : 'FAIL', detail: { pnlNetResult, closeNetResult, difference: diff.toFixed(2) } };
  }

  async validateEquityRollforward(openingEquity: string, netMovement: string, closingEquity: string): Promise<ValidationOutcome> {
    const diff = new Decimal(openingEquity).plus(netMovement).minus(closingEquity).abs();
    return { ruleCode: 'EQUITY_ROLLFORWARD', status: diff.lte('0.01') ? 'PASS' : 'FAIL', detail: { openingEquity, netMovement, closingEquity } };
  }

  async validateEquityAgainstBalanceSheet(equityStatementClosing: string, balanceSheetEquity: string): Promise<ValidationOutcome> {
    const diff = new Decimal(equityStatementClosing).minus(balanceSheetEquity).abs();
    return { ruleCode: 'EQUITY_VS_BS', status: diff.lte('0.01') ? 'PASS' : 'FAIL', detail: { equityStatementClosing, balanceSheetEquity } };
  }

  async validateCashFlowAgainstBalanceSheet(cashFlowClosingCash: string, balanceSheetCash: string): Promise<ValidationOutcome> {
    const diff = new Decimal(cashFlowClosingCash).minus(balanceSheetCash).abs();
    return { ruleCode: 'CF_VS_BS_CASH', status: diff.lte('0.01') ? 'PASS' : 'FAIL', detail: { cashFlowClosingCash, balanceSheetCash } };
  }

  async persist(tenantId: string, reportRunId: string, outcome: ValidationOutcome) {
    let rule = await this.prisma.financialReportValidationRule.findFirst({ where: { tenantId, ruleCode: outcome.ruleCode } });
    if (!rule) {
      rule = await this.prisma.financialReportValidationRule.create({ data: { tenantId, ruleCode: outcome.ruleCode, description: outcome.ruleCode, blocking: outcome.status === 'BLOCKING', severity: outcome.status } });
    }
    return this.prisma.financialReportValidationResult.create({ data: { tenantId, reportRunId, ruleId: rule.id, status: outcome.status, detail: outcome.detail as object } });
  }
}
