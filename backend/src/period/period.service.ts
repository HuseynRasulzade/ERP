import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
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
    if (params.organizationId) {
      // Never let a period row point at another tenant's organization
      // (Phase 0 section 61: every tenant-owned object belongs to one tenant).
      const org = await this.prisma.organization.findFirst({ where: { id: params.organizationId, tenantId } });
      if (!org) throw new NotFoundAppError('Organization', params.organizationId);
    }

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
  async assertDateIsOpen(
    tenantId: string,
    businessDate: Date,
    organizationId?: string,
    tx?: PrismaTransactionClient,
  ) {
    // An organization-scoped document is governed by its own organization's
    // period when one exists for the date, but a tenant-wide period
    // (organizationId = null) still applies to every organization that has
    // no more specific period configured — it must not be invisible just
    // because the document itself belongs to an organization.
    //
    // When called with the caller's posting transaction (`tx`), the
    // governing period row is read with `FOR SHARE`: a concurrent
    // `close()` (which takes `FOR UPDATE` on the same row) then has to wait
    // for this posting to commit or roll back, and a posting that starts
    // after the close committed sees CLOSED. Without the lock a posting
    // could read OPEN, the period could close, and the posting could still
    // commit into the now-closed period (Phase 0 section 61: "closed
    // periods cannot receive new postings").
    const day = businessDate.toISOString().slice(0, 10);
    let period: { status: string } | null;
    if (tx) {
      const rows = await tx.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status::text AS status
           FROM accounting_periods
          WHERE tenant_id = $1
            AND (organization_id = $2 OR organization_id IS NULL)
            AND start_date <= $3::date AND end_date >= $3::date
          ORDER BY organization_id ASC NULLS LAST
          LIMIT 1
          FOR SHARE`,
        tenantId,
        organizationId ?? null,
        day,
      );
      period = rows[0] ?? null;
    } else {
      period = await this.prisma.accountingPeriod.findFirst({
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
    }

    // No period configured at all is treated as open (Phase 0 does not
    // mandate periods exist for every date) — but an existing period that
    // is not OPEN always blocks.
    if (period && period.status !== 'OPEN') {
      throw new PeriodClosedError(day);
    }
  }

  /** Close is atomic (Phase 0 section 35): row lock + status flip + audit
   * in one transaction. The `FOR UPDATE` lock waits for any in-flight
   * posting that already read this period with `FOR SHARE` (see
   * assertDateIsOpen), so no posting can land after the close commits. */
  async close(tenantId: string, periodId: string, closedBy: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const period = await this.lockOwned(tx, tenantId, periodId);
      if (period.status === 'CLOSED') throw new ConflictAppError('Period is already closed');

      const updated = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: 'CLOSED', closedAt: new Date(), closedBy, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'PERIOD_CLOSED',
          entityType: 'AccountingPeriod',
          entityId: periodId,
          action: 'UPDATE',
          userId: closedBy,
          newValues: { year: period.year, month: period.month },
        },
        tx,
      );

      return updated;
    });
  }

  /** Controlled reopening — requires explicit permission (enforced at the
   * controller), always audited, never silent (section 22). Atomic: the
   * status flip and its PERIOD_REOPENED audit event commit together. */
  async reopen(tenantId: string, periodId: string, reopenedBy: string, reason?: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const period = await this.lockOwned(tx, tenantId, periodId);
      if (period.status !== 'CLOSED') throw new ValidationAppError('Only a closed period can be reopened');

      const updated = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: 'OPEN', reopenedAt: new Date(), reopenedBy, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'PERIOD_REOPENED',
          entityType: 'AccountingPeriod',
          entityId: periodId,
          action: 'UPDATE',
          userId: reopenedBy,
          reason,
          newValues: { year: period.year, month: period.month },
        },
        tx,
      );

      return updated;
    });
  }

  private async lockOwned(tx: PrismaTransactionClient, tenantId: string, periodId: string) {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM accounting_periods WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      periodId,
      tenantId,
    );
    if (rows.length === 0) throw new NotFoundAppError('AccountingPeriod', periodId);
    return tx.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } });
  }
}
