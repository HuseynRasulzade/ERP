import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodClosePolicyService } from './period-close-policy.service';
import { FixedAssetDepreciationService } from '../fixed-assets/fixed-asset-depreciation.service';
import { InventoryCostRecalculationService } from '../inventory-costing/inventory-cost-recalculation.service';
import { CostingReconciliationService } from '../inventory-costing/costing-reconciliation.service';
import { SettlementHealthService } from '../settlement/settlement-health.service';
import { TreasuryHealthService } from '../treasury/treasury-health.service';
import { CashHealthService } from '../cash/cash-health.service';

export interface ReadinessFinding {
  category: string;
  code: string;
  blocking: boolean;
  message: string;
}

export interface ReadinessReport {
  status: 'READY' | 'BLOCKED';
  findings: ReadinessFinding[];
}

/**
 * PeriodReadinessService (docx spec Phase 22, sections 18-24). Pure
 * read-only checks across the categories in section 19 — never mutates
 * anything. `PeriodCloseOrchestrator` calls this before creating a
 * REGULAR_CLOSE run and again, per-step, as each subledger's own gate.
 */
@Injectable()
export class PeriodReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PeriodClosePolicyService,
    private readonly depreciation: FixedAssetDepreciationService,
    private readonly costRecalc: InventoryCostRecalculationService,
    private readonly costReconciliation: CostingReconciliationService,
    private readonly settlementHealth: SettlementHealthService,
    private readonly treasuryHealth: TreasuryHealthService,
    private readonly cashHealth: CashHealthService,
  ) {}

  async checkReadiness(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date): Promise<ReadinessReport> {
    const policy = await this.policy.resolve(tenantId, organizationId, periodStart);
    const findings: ReadinessFinding[] = [];

    findings.push(...(await this.documentFindings(tenantId, organizationId, periodStart, periodEnd)));

    if (policy.requireInventoryCostFinalization) {
      const pending = await this.costRecalc.pendingCount(tenantId, organizationId);
      if (pending > 0) findings.push({ category: 'COSTING', code: 'PENDING_RECALCULATION', blocking: true, message: `${pending} inventory recalculation request(s) still pending.` });
      const costingIssues = await this.costReconciliation.health(tenantId, organizationId);
      for (const issue of costingIssues) findings.push({ category: 'COSTING', code: issue.code ?? 'COSTING_HEALTH', blocking: issue.severity === 'ERROR', message: issue.message ?? JSON.stringify(issue) });
    }

    if (policy.requireBankReconciliation) {
      const bankIssues = await this.treasuryHealth.check(tenantId, organizationId);
      for (const issue of bankIssues) findings.push({ category: 'BANK', code: issue.code, blocking: issue.severity === 'ERROR', message: issue.message });
    }

    if (policy.requireCashDailyClose) {
      const cashIssues = await this.cashHealth.check(tenantId, organizationId);
      for (const issue of cashIssues) findings.push({ category: 'CASH', code: issue.code, blocking: issue.severity === 'ERROR', message: issue.message });
    }

    const arApIssues = await this.settlementHealth.check(tenantId, organizationId);
    for (const issue of arApIssues) findings.push({ category: 'AR_AP', code: issue.code, blocking: issue.severity === 'ERROR', message: issue.message });

    if (policy.requireFaDepreciation) {
      const period = this.toPeriodString(periodStart);
      const existingRun = await this.prisma.fixedAssetDepreciationRun.findFirst({ where: { tenantId, organizationId, period: periodStart, valuationBook: 'ACCOUNTING_BOOK', runType: 'PERIODIC' } });
      if (!existingRun || existingRun.status !== 'POSTED') {
        findings.push({ category: 'FIXED_ASSETS', code: 'DEPRECIATION_NOT_POSTED', blocking: false, message: `Depreciation for ${period} has not been calculated/posted yet — the close step will run it.` });
      }
    }

    const status = findings.some((f) => f.blocking) ? 'BLOCKED' : 'READY';
    return { status, findings };
  }

  private toPeriodString(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** DOCUMENTS category (spec sections 20-22) — a representative subset of
   * document types is checked (see document-close-relevance.ts). */
  private async documentFindings(tenantId: string, organizationId: string, periodStart: Date, periodEnd: Date): Promise<ReadinessFinding[]> {
    const findings: ReadinessFinding[] = [];

    // This codebase's DocumentFramework has no separate "APPROVED" status
    // (DocumentStatus is DRAFT|ACTIVE|CANCELLED|DELETION_MARKED) — ACTIVE
    // is the "confirmed, eligible to post" state the spec's own "approved"
    // language maps to (spec section 21's own example).
    const unpostedPurchaseInvoices = await this.prisma.purchaseInvoice.findMany({
      where: { tenantId, organizationId, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'NOT_POSTED', status: 'ACTIVE' },
      select: { id: true, number: true },
    });
    for (const doc of unpostedPurchaseInvoices) {
      findings.push({ category: 'DOCUMENTS', code: 'APPROVED_UNPOSTED_PURCHASE_INVOICE', blocking: true, message: `Approved but unposted Purchase Invoice ${doc.number ?? doc.id}.` });
    }

    const unpostedSalesInvoices = await this.prisma.salesInvoice.findMany({
      where: { tenantId, organizationId, documentDate: { gte: periodStart, lte: periodEnd }, postingStatus: 'NOT_POSTED', status: 'ACTIVE' },
      select: { id: true, number: true },
    });
    for (const doc of unpostedSalesInvoices) {
      findings.push({ category: 'DOCUMENTS', code: 'APPROVED_UNPOSTED_SALES_INVOICE', blocking: true, message: `Approved but unposted Sales Invoice ${doc.number ?? doc.id}.` });
    }

    // Draft quotations / requirements are explicitly IGNORE (spec section
    // 21's own "Draft quotation -> irrelevant") — never checked here.
    return findings;
  }
}
