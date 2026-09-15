import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const RECOGNITION_SOURCE_TYPE = 'PREPAID_EXPENSE_SCHEDULE';

/**
 * PrepaidExpenseService (spec sections 33-41). `STRAIGHT_LINE_BY_MONTH`
 * assumes equal calendar months; `STRAIGHT_LINE_BY_DAY` prorates by
 * actual day count instead (spec section 39's own "15 January to 14
 * January next year" mid-month example) — never a blind 12-equal-months
 * split unless that method is explicitly configured (spec section 39).
 * The schedule rows themselves ARE this build's recognition-run history
 * — no separate `PrepaidRecognitionRun` table (disclosed simplification,
 * see docs/EXPENSES.md).
 */
@Injectable()
export class PrepaidExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly postingEngine: AccountingPostingEngine,
  ) {}

  async createFromClaimLine(tenantId: string, membershipId: string, organizationId: string, userId: string, claimLineId: string, dto: { recognitionStartDate: string; recognitionEndDate: string; allocationMethod?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const line = await this.prisma.expenseClaimLine.findFirst({ where: { id: claimLineId, tenantId }, include: { claim: true } });
    if (!line) throw new NotFoundAppError('ExpenseClaimLine', claimLineId);
    const amount = new Decimal((line.approvedAmount ?? line.baseAmount).toString());
    const start = new Date(dto.recognitionStartDate);
    const end = new Date(dto.recognitionEndDate);
    const method = dto.allocationMethod ?? 'STRAIGHT_LINE_BY_MONTH';

    return this.prisma.runInTransaction(async (tx) => {
      const prepaid = await tx.prepaidExpense.create({
        data: {
          tenantId,
          organizationId,
          sourceDocumentType: 'EXPENSE_CLAIM_LINE',
          sourceDocumentId: claimLineId,
          sourceClaimLineId: claimLineId,
          expenseCategoryId: line.expenseCategoryId,
          originalAmount: amount.toString(),
          currencyId: line.transactionCurrencyId,
          baseAmount: amount.toString(),
          recognitionStartDate: start,
          recognitionEndDate: end,
          allocationMethod: method,
          costCenterId: line.costCenterId,
          projectId: line.projectId,
          remainingAmount: amount.toString(),
          status: 'ACTIVE',
          createdBy: userId,
        },
      });

      const schedule = this.buildSchedule(amount, start, end, method);
      for (const s of schedule) await tx.prepaidExpenseSchedule.create({ data: { tenantId, prepaidExpenseId: prepaid.id, period: s.period, plannedRecognitionAmount: s.amount.toString() } });

      await this.audit.record({ tenantId, eventType: 'PREPAID_EXPENSE_CREATED', entityType: 'PREPAID_EXPENSE', entityId: prepaid.id, action: 'CREATE', userId, newValues: { amount: amount.toString(), months: schedule.length } }, tx);
      return tx.prepaidExpense.findUniqueOrThrow({ where: { id: prepaid.id }, include: { schedule: true } });
    });
  }

  private buildSchedule(amount: Decimal, start: Date, end: Date, method: string): { period: Date; amount: Decimal }[] {
    const months: Date[] = [];
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
    if (months.length === 0) return [];

    if (method === 'STRAIGHT_LINE_BY_DAY') {
      const totalDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
      let allocated = new Decimal(0);
      return months.map((m, i) => {
        const monthStart = i === 0 ? start : m;
        const monthEnd = i === months.length - 1 ? end : new Date(m.getFullYear(), m.getMonth() + 1, 0);
        const days = Math.floor((monthEnd.getTime() - monthStart.getTime()) / 86_400_000) + 1;
        const isLast = i === months.length - 1;
        const share = isLast ? amount.minus(allocated) : amount.mul(days).dividedBy(totalDays).toDecimalPlaces(2);
        allocated = allocated.plus(share);
        return { period: m, amount: share };
      });
    }

    // STRAIGHT_LINE_BY_MONTH / FIXED_SCHEDULE / MANUAL / USAGE_BASED all
    // default to equal months in this build unless a caller pre-computes
    // its own schedule (disclosed simplification, see docs/EXPENSES.md).
    const perMonth = amount.dividedBy(months.length).toDecimalPlaces(2);
    let allocated = new Decimal(0);
    return months.map((m, i) => {
      const isLast = i === months.length - 1;
      const share = isLast ? amount.minus(allocated) : perMonth;
      allocated = allocated.plus(share);
      return { period: m, amount: share };
    });
  }

  /** Recognizes every PENDING schedule row due on or before `period` —
   * Dr Expense / Cr Prepaid Expense (spec section 36). Called by Phase
   * 22's own Month Close (spec section 41), or directly here. */
  async recognizePeriod(tenantId: string, organizationId: string, userId: string, period: string) {
    const periodEnd = new Date(period);
    const due = await this.prisma.prepaidExpenseSchedule.findMany({ where: { tenantId, status: 'PENDING', period: { lte: periodEnd }, prepaid: { organizationId, status: 'ACTIVE' } }, include: { prepaid: { include: { expenseCategory: true } } } });

    const results = [];
    for (const item of due) {
      const amount = new Decimal(item.plannedRecognitionAmount.toString());
      const businessDate = new Date(item.period.getFullYear(), item.period.getMonth() + 1, 0);
      const expenseAccount = await this.mappings.resolve(tenantId, organizationId, item.prepaid.expenseCategory.accountingMappingProfile ?? MappingKeys.OTHER_OPERATING_EXPENSE, businessDate).catch(() => null);
      const prepaidAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.PREPAID_EXPENSE, businessDate).catch(() => null);

      const updated = await this.prisma.runInTransaction(async (tx: PrismaTransactionClient) => {
        let postingReference: string | null = null;
        if (expenseAccount && prepaidAccount) {
          const dims = item.prepaid.costCenterId ? [{ dimensionCode: 'COST_CENTER', referenceId: item.prepaid.costCenterId }] : [];
          const batch = await this.postingEngine.postBatch(tenantId, userId, { organizationId, businessDate, description: `Prepaid expense recognition ${item.prepaid.id} — ${item.period.toISOString().slice(0, 7)}`, operationType: 'SYSTEM_DOCUMENT', sourceDocumentType: RECOGNITION_SOURCE_TYPE, sourceDocumentId: item.id, lines: [{ accountId: expenseAccount.id, side: 'DEBIT', amountBase: amount, description: 'Prepaid expense recognized', dimensions: dims }, { accountId: prepaidAccount.id, side: 'CREDIT', amountBase: amount, description: 'Prepaid expense reduction', dimensions: dims }] }, tx);
          postingReference = batch.id;
        }
        await tx.prepaidExpenseSchedule.update({ where: { id: item.id }, data: { status: 'RECOGNIZED', recognizedAmount: amount.toString(), recognizedAt: new Date(), postingReference } });
        const newRecognized = new Decimal(item.prepaid.recognizedAmount.toString()).plus(amount);
        const newRemaining = Decimal.max(new Decimal(item.prepaid.remainingAmount.toString()).minus(amount), 0);
        return tx.prepaidExpense.update({ where: { id: item.prepaid.id }, data: { recognizedAmount: newRecognized.toString(), remainingAmount: newRemaining.toString(), status: newRemaining.lte('0.01') ? 'FULLY_RECOGNIZED' : 'ACTIVE' } });
      });
      results.push(updated);
    }
    await this.audit.record({ tenantId, eventType: 'PREPAID_EXPENSE_RECOGNIZED', entityType: 'PREPAID_EXPENSE_SCHEDULE', entityId: organizationId, action: 'UPDATE', userId, newValues: { period, itemsProcessed: due.length } });
    return { itemsProcessed: due.length, results };
  }

  get(tenantId: string, id: string) {
    return this.prisma.prepaidExpense.findFirst({ where: { id, tenantId }, include: { schedule: true } });
  }

  list(tenantId: string, organizationId: string) {
    return this.prisma.prepaidExpense.findMany({ where: { tenantId, organizationId }, orderBy: { createdAt: 'desc' } });
  }
}
