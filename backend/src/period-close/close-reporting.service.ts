import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CloseReportingService (docx spec Phase 22, sections 151-158) — a
 * read-only aggregation layer over the tables every other service in
 * this module already writes. Polished presentation/UI is out of scope
 * (same convention as Phase 11/23's own reporting split) — this returns
 * structured data a frontend or export job can render.
 */
@Injectable()
export class CloseReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async checklist(tenantId: string, closeRunId: string) {
    const steps = await this.prisma.periodCloseStep.findMany({ where: { tenantId, closeRunId }, orderBy: { sequence: 'asc' } });
    return steps.map((s) => ({ stepCode: s.stepCode, name: s.name, status: s.status, startedAt: s.startedAt, completedAt: s.completedAt, warnings: s.warnings, errors: s.errors }));
  }

  async reconciliationSummary(tenantId: string, closeRunId: string) {
    return this.prisma.periodReconciliationResult.findMany({ where: { tenantId, closeRunId }, include: { rule: true } });
  }

  async adjustmentJournal(tenantId: string, closeRunId: string) {
    return this.prisma.periodCloseAdjustmentBatch.findMany({ where: { tenantId, closeRunId } });
  }

  async fxReport(tenantId: string, organizationId: string, period: string) {
    const run = await this.prisma.fXRevaluationRun.findFirst({ where: { tenantId, organizationId, period }, include: { items: true } });
    return run?.items ?? [];
  }

  async accrualReport(tenantId: string, organizationId: string, financialPeriodId: string) {
    return this.prisma.periodAccrual.findMany({ where: { tenantId, organizationId, financialPeriodId } });
  }

  async reopenHistory(tenantId: string, financialPeriodId: string) {
    return this.prisma.periodReopenRequest.findMany({ where: { tenantId, financialPeriodId }, orderBy: { requestDate: 'desc' } });
  }

  async prePostTrialBalance(tenantId: string, organizationId: string, closeRunId: string, periodStart: Date, periodEnd: Date) {
    const accounts = await this.prisma.account.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
    const preClose = await this.prisma.accountingMovement.groupBy({ by: ['accountId', 'side'], where: { tenantId, organizationId, businessDate: { lt: periodStart } }, _sum: { amountBase: true } });
    const postClose = await this.prisma.accountingMovement.groupBy({ by: ['accountId', 'side'], where: { tenantId, organizationId, businessDate: { lte: periodEnd } }, _sum: { amountBase: true } });
    const adjustments = await this.prisma.periodCloseAdjustmentBatch.findMany({ where: { tenantId, closeRunId } });
    return { accounts: accounts.length, preCloseRows: preClose.length, postCloseRows: postClose.length, adjustmentCount: adjustments.length };
  }
}
