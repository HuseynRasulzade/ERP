import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { FinancialResultService } from './financial-result.service';
import { PostingDuplicateError } from '../common/errors/app-error';

/**
 * ClosingEntryService (docx spec Phase 22, sections 102-105). A MONTHLY
 * REGULAR_CLOSE never zeroes revenue/expense accounts — the current
 * fiscal year's profit/loss simply accumulates in them (spec section
 * 105's own "Month: current-year profit/loss accumulated") — closing
 * entries only fire for a YEAR_END_CLOSE run, transferring the net
 * REVENUE/EXPENSE balance into Retained Earnings (spec section 104).
 */
@Injectable()
export class ClosingEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: AccountingPostingEngine,
    private readonly mapping: AccountingMappingService,
    private readonly financialResult: FinancialResultService,
  ) {}

  async postYearEndClosingEntries(tenantId: string, userId: string, organizationId: string, closeRunId: string, fiscalYearStart: Date, fiscalYearEnd: Date) {
    const result = await this.financialResult.calculate(tenantId, organizationId, fiscalYearStart, fiscalYearEnd);
    const netResult = new Decimal(result.netResult);

    const currentPeriodResultAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.CURRENT_PERIOD_RESULT, fiscalYearEnd);
    const retainedEarningsAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.RETAINED_EARNINGS, fiscalYearEnd);

    if (netResult.eq(0)) return null;

    // Profit: Dr Current Period Result / Cr Retained Earnings.
    // Loss: Dr Retained Earnings / Cr Current Period Result.
    const isProfit = netResult.gt(0);
    const amount = netResult.abs();
    const lines = [
      { accountId: isProfit ? currentPeriodResultAccount.id : retainedEarningsAccount.id, side: 'DEBIT' as const, amountBase: amount.toString(), description: 'Year-end closing entry' },
      { accountId: isProfit ? retainedEarningsAccount.id : currentPeriodResultAccount.id, side: 'CREDIT' as const, amountBase: amount.toString(), description: 'Year-end closing entry' },
    ];

    let journalEntryId: string | undefined;
    try {
      const batch = await this.posting.postBatch(tenantId, userId, {
        organizationId,
        businessDate: fiscalYearEnd,
        description: `Year-end closing entry — retained earnings transfer`,
        operationType: 'CLOSING_ENTRY',
        generatedBy: 'PERIOD_CLOSE',
        sourceDocumentType: 'PERIOD_CLOSE_RUN_CLOSING_ENTRY',
        sourceDocumentId: closeRunId,
        lines,
      });
      journalEntryId = batch.id;
    } catch (err) {
      if (!(err instanceof PostingDuplicateError)) throw err;
    }

    const adjustment = await this.prisma.periodCloseAdjustmentBatch.create({
      data: { tenantId, closeRunId, organizationId, adjustmentType: 'RETAINED_EARNINGS', stepCode: 'CLOSING_ENTRIES', journalEntryId, amount: netResult.toString(), description: 'Year-end retained earnings transfer', createdBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'CLOSING_ENTRY_POSTED', entityType: 'PeriodCloseAdjustmentBatch', entityId: adjustment.id, action: 'CREATE', userId, newValues: { netResult: netResult.toString() } });
    return adjustment;
  }
}
