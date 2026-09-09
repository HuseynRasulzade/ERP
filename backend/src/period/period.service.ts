import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ConflictAppError,
  NotFoundAppError,
  PeriodClosedError,
  ValidationAppError,
} from '../common/errors/app-error';

/**
 * Accounting/business period foundation + central PeriodGuard (section 20/21).
 * Every future posting process calls `assertDateIsOpen` instead of
 * duplicating closed-period logic inside each business module.
 */
@Injectable()
export class PeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createPeriod(
    tenantId: string,
    params: { organizationId?: string; year: number; month: number },
  ) {
    const startDate = new Date(Date.UTC(params.year, params.month - 1, 1));
    const endDate = new Date(Date.UTC(params.year, params.month, 0));

    // Plain findFirst rather than findUnique: Prisma's compound-unique
    // `where` input rejects an explicit null for a nullable component.
    const existing = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        organizationId: params.organizationId ?? null,
        year: params.year,
        month: params.month,
      },
    });
    if (existing) throw new ConflictAppError('Period already exists for this year/month');

    return this.prisma.accountingPeriod.create({
      data: {
        tenantId,
        organizationId: params.organizationId,
        year: params.year,
        month: params.month,
        startDate,
        endDate,
      },
    });
  }

  list(tenantId: string) {
    return this.prisma.accountingPeriod.findMany({
      where: { tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  /**
   * Central guard: every posting/unposting flow must call this with the
   * document's business date before writing any movement. Blocks even a
   * user who otherwise holds ordinary posting permission — only an
   * explicit, audited period reopen can lift it (section 21, scenario C).
   */
  async assertDateIsOpen(tenantId: string, businessDate: Date, organizationId?: string) {
    // An organization-scoped document is governed by its own organization's
    // period when one exists for the date, but a tenant-wide period
    // (organizationId = null) still applies to every organization that has
    // no more specific period configured — it must not be invisible just
    // because the document itself belongs to an organization.
    const period = await this.prisma.accountingPeriod.findFirst({
      where: {
        tenantId,
        OR: organizationId ? [{ organizationId }, { organizationId: null }] : [{ organizationId: null }],
        startDate: { lte: businessDate },
        endDate: { gte: businessDate },
      },
      // Prefer the more specific (organization-scoped) period over the
      // tenant-wide one when both happen to cover the same date: Postgres
      // sorts NULLs last on ASC by default, so the org-specific row (if
      // any) is returned by findFirst before the tenant-wide fallback.
      orderBy: [{ organizationId: 'asc' }],
    });

    // No period configured at all is treated as open (Phase 0 does not
    // mandate periods exist for every date) — but an existing period that
    // is not OPEN always blocks.
    if (period && period.status !== 'OPEN') {
      throw new PeriodClosedError(businessDate.toISOString().slice(0, 10));
    }
  }

  async close(tenantId: string, periodId: string, closedBy: string) {
    const period = await this.getOwned(tenantId, periodId);
    if (period.status === 'CLOSED') throw new ConflictAppError('Period is already closed');

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED', closedAt: new Date(), closedBy, version: { increment: 1 } },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PERIOD_CLOSED',
      entityType: 'AccountingPeriod',
      entityId: periodId,
      action: 'UPDATE',
      userId: closedBy,
      newValues: { year: period.year, month: period.month },
    });

    return updated;
  }

  /** Controlled reopening — requires explicit permission (enforced at the
   * controller), always audited, never silent (section 22). */
  async reopen(tenantId: string, periodId: string, reopenedBy: string, reason?: string) {
    const period = await this.getOwned(tenantId, periodId);
    if (period.status !== 'CLOSED') throw new ValidationAppError('Only a closed period can be reopened');

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'OPEN', reopenedAt: new Date(), reopenedBy, version: { increment: 1 } },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PERIOD_REOPENED',
      entityType: 'AccountingPeriod',
      entityId: periodId,
      action: 'UPDATE',
      userId: reopenedBy,
      reason,
      newValues: { year: period.year, month: period.month },
    });

    return updated;
  }

  private async getOwned(tenantId: string, periodId: string) {
    const period = await this.prisma.accountingPeriod.findFirst({ where: { id: periodId, tenantId } });
    if (!period) throw new NotFoundAppError('AccountingPeriod', periodId);
    return period;
  }
}
