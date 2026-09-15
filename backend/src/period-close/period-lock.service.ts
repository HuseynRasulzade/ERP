import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PeriodService } from '../period/period.service';
import { FinancialPeriodService } from './financial-period.service';
import { ValidationAppError } from '../common/errors/app-error';

/**
 * PeriodLockService (docx spec Phase 22, sections 114-115) — the ONLY
 * place that flips the underlying Phase 4 `AccountingPeriod.status`
 * (spec section 114's own "Phase 4 period lock service called"). Soft
 * close restricts operational documents but Phase 4's own guard is
 * binary (OPEN/CLOSED), so SOFT_CLOSED in this build does not yet lock
 * ordinary postings — only HARD_CLOSED does (disclosed simplification,
 * docs/MONTH_CLOSE.md section J).
 */
@Injectable()
export class PeriodLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly financialPeriod: FinancialPeriodService,
    private readonly accountingPeriod: PeriodService,
  ) {}

  async softClose(tenantId: string, financialPeriodId: string, userId: string) {
    const period = await this.financialPeriod.assertStatus(tenantId, financialPeriodId, ['OPEN', 'PRE_CLOSE', 'CLOSE_IN_PROGRESS']);
    const updated = await this.financialPeriod.setStatus(tenantId, period.id, 'SOFT_CLOSED', { softCloseAt: new Date() });
    await this.audit.record({ tenantId, eventType: 'PERIOD_SOFT_CLOSED', entityType: 'FinancialPeriod', entityId: period.id, action: 'UPDATE', userId });
    return updated;
  }

  /** Hard close = the authoritative umbrella lock (spec section 115) —
   * flips the FinancialPeriod AND the underlying AccountingPeriod so
   * every ordinary posting flow (`PeriodService.assertDateIsOpen`) is
   * blocked from here on, not just this orchestrator's own writes. */
  async hardClose(tenantId: string, financialPeriodId: string, userId: string) {
    const period = await this.financialPeriod.assertStatus(tenantId, financialPeriodId, ['OPEN', 'PRE_CLOSE', 'CLOSE_IN_PROGRESS', 'SOFT_CLOSED']);

    let accountingPeriod = await this.prisma.accountingPeriod.findFirst({ where: { tenantId, organizationId: period.organizationId, year: period.fiscalYear, month: period.periodNumber } });
    if (!accountingPeriod) {
      accountingPeriod = await this.accountingPeriod.createPeriod(tenantId, { organizationId: period.organizationId, year: period.fiscalYear, month: period.periodNumber });
    }
    if (accountingPeriod.status === 'OPEN') {
      await this.accountingPeriod.close(tenantId, accountingPeriod.id, userId);
    }

    const updated = await this.financialPeriod.setStatus(tenantId, period.id, 'HARD_CLOSED', { hardCloseAt: new Date(), closedBy: userId });
    await this.audit.record({ tenantId, eventType: 'PERIOD_HARD_CLOSED', entityType: 'FinancialPeriod', entityId: period.id, action: 'UPDATE', userId });
    return updated;
  }

  /** Controlled reopen (spec sections 116-119) — always the caller's
   * (PeriodReopenService's) job to have already checked approval; this
   * method only performs the actual state transition + underlying
   * AccountingPeriod reopen. */
  async reopen(tenantId: string, financialPeriodId: string, userId: string, reason: string) {
    const period = await this.financialPeriod.assertStatus(tenantId, financialPeriodId, ['HARD_CLOSED', 'SOFT_CLOSED']);

    const accountingPeriod = await this.prisma.accountingPeriod.findFirst({ where: { tenantId, organizationId: period.organizationId, year: period.fiscalYear, month: period.periodNumber } });
    if (accountingPeriod && accountingPeriod.status === 'CLOSED') {
      await this.accountingPeriod.reopen(tenantId, accountingPeriod.id, userId, reason);
    }

    const updated = await this.financialPeriod.setStatus(tenantId, period.id, 'REOPENED', { reopenCount: { increment: 1 } });
    await this.audit.record({ tenantId, eventType: 'PERIOD_REOPENED', entityType: 'FinancialPeriod', entityId: period.id, action: 'UPDATE', userId, reason });
    return updated;
  }

  async assertNotHardClosed(tenantId: string, financialPeriodId: string) {
    const period = await this.financialPeriod.get(tenantId, financialPeriodId);
    if (period.status === 'HARD_CLOSED') throw new ValidationAppError('Period is HARD_CLOSED — no further close activity is permitted without a controlled reopen (spec section 114)');
  }
}
