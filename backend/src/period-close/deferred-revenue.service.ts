import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NotFoundAppError, PostingDuplicateError } from '../common/errors/app-error';

/**
 * DeferredRevenueService (docx spec Phase 22, sections 63-65) — the
 * liability-side mirror of Phase 20's `PrepaidExpenseService`. Foundation
 * only, per the spec's own "Full revenue-recognition complexity future
 * extension" note: straight-line-by-month recognition, one schedule
 * header per source document, no usage-based/milestone recognition
 * (disclosed in docs/MONTH_CLOSE.md section H).
 */
@Injectable()
export class DeferredRevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: AccountingPostingEngine,
    private readonly mapping: AccountingMappingService,
  ) {}

  async create(tenantId: string, userId: string, dto: { organizationId: string; sourceDocumentType: string; sourceDocumentId: string; counterpartyId?: string; totalAmount: number; currencyId: string; recognitionStartDate: string; recognitionEndDate: string }) {
    const schedule = await this.prisma.deferredRevenueSchedule.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        sourceDocumentType: dto.sourceDocumentType,
        sourceDocumentId: dto.sourceDocumentId,
        counterpartyId: dto.counterpartyId,
        totalAmount: dto.totalAmount.toString(),
        currencyId: dto.currencyId,
        recognitionStartDate: new Date(dto.recognitionStartDate),
        recognitionEndDate: new Date(dto.recognitionEndDate),
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'DEFERRED_REVENUE_SCHEDULE_CREATED', entityType: 'DeferredRevenueSchedule', entityId: schedule.id, action: 'CREATE', userId, newValues: { totalAmount: dto.totalAmount } });
    return schedule;
  }

  /** Recognizes one month's straight-line slice for every ACTIVE
   * schedule whose window covers `period` (YYYY-MM), posting Dr Deferred
   * Revenue / Cr Revenue per schedule. Idempotent via
   * `sourceDocumentType`+`sourceDocumentId` on the posting batch. */
  async recognizePeriod(tenantId: string, organizationId: string, userId: string, period: string) {
    const [year, month] = period.split('-').map(Number);
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0));

    const schedules = await this.prisma.deferredRevenueSchedule.findMany({
      where: { tenantId, organizationId, status: 'ACTIVE', recognitionStartDate: { lte: periodEnd }, recognitionEndDate: { gte: periodStart } },
    });

    const results = [];
    for (const schedule of schedules) {
      const totalMonths = this.monthSpan(schedule.recognitionStartDate, schedule.recognitionEndDate);
      const monthlyAmount = new Decimal(schedule.totalAmount.toString()).div(totalMonths);
      const remaining = new Decimal(schedule.totalAmount.toString()).minus(schedule.recognizedAmount.toString());
      const amountThisMonth = Decimal.min(monthlyAmount, remaining);
      if (amountThisMonth.lte(0)) continue;

      const deferredAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.DEFERRED_REVENUE, periodEnd);
      const revenueAccount = await this.mapping.resolve(tenantId, organizationId, MappingKeys.SALES_REVENUE, periodEnd);

      let journalEntryId: string | undefined;
      try {
        const batch = await this.posting.postBatch(tenantId, userId, {
          organizationId,
          businessDate: periodEnd,
          description: `Deferred revenue recognition ${period} — ${schedule.id}`,
          operationType: 'DEFERRED_REVENUE_RECOGNITION',
          sourceDocumentType: 'DEFERRED_REVENUE_RECOGNITION',
          sourceDocumentId: `${schedule.id}:${period}`,
          lines: [
            { accountId: deferredAccount.id, side: 'DEBIT', amountBase: amountThisMonth.toString() },
            { accountId: revenueAccount.id, side: 'CREDIT', amountBase: amountThisMonth.toString() },
          ],
        });
        journalEntryId = batch.id;
      } catch (err) {
        if (!(err instanceof PostingDuplicateError)) throw err;
      }

      const newRecognized = new Decimal(schedule.recognizedAmount.toString()).plus(amountThisMonth);
      const updated = await this.prisma.deferredRevenueSchedule.update({
        where: { id: schedule.id },
        data: { recognizedAmount: newRecognized.toString(), status: newRecognized.gte(schedule.totalAmount.toString()) ? 'FULLY_RECOGNIZED' : 'ACTIVE' },
      });
      results.push({ scheduleId: schedule.id, amountRecognized: amountThisMonth.toString(), journalEntryId });
      await this.audit.record({ tenantId, eventType: 'DEFERRED_REVENUE_RECOGNIZED', entityType: 'DeferredRevenueSchedule', entityId: schedule.id, action: 'UPDATE', userId, newValues: { amountThisMonth: amountThisMonth.toString() } });
      void updated;
    }
    return results;
  }

  private monthSpan(start: Date, end: Date): number {
    return Math.max(1, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1);
  }

  async get(tenantId: string, id: string) {
    const schedule = await this.prisma.deferredRevenueSchedule.findFirst({ where: { id, tenantId } });
    if (!schedule) throw new NotFoundAppError('DeferredRevenueSchedule', id);
    return schedule;
  }
}
