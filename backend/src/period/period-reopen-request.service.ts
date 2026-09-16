import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PeriodService } from './period.service';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * Maker-checker gate in front of `PeriodService.reopen` (docs/PERIODS.md).
 * `reopen` itself stays a direct, permission-gated action — unchanged, and
 * still callable by anyone holding `periods.reopen` — this is an additive
 * parallel path: a holder of only `periods.reopen_request.create` files a
 * reasoned request, and a `periods.reopen` holder approves or rejects it.
 * Approving calls `PeriodService.reopen` internally; there is no second
 * reopen mechanism. The requester may never decide their own request —
 * the same creator-cannot-approve-their-own-document rule every other
 * approval flow in this codebase enforces (see `docs/APPROVALS.md`), kept
 * inline here rather than through the generic `ApprovalStep` engine since
 * this is a single fixed check against a flat permission, not a per-role
 * multi-step chain.
 */
@Injectable()
export class PeriodReopenRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly periods: PeriodService,
  ) {}

  async list(tenantId: string, periodId?: string) {
    return this.prisma.periodReopenRequest.findMany({
      where: { tenantId, ...(periodId ? { periodId } : {}) },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async request(tenantId: string, periodId: string, userId: string, reason: string) {
    const period = await this.prisma.accountingPeriod.findFirst({ where: { id: periodId, tenantId } });
    if (!period) throw new NotFoundAppError('AccountingPeriod', periodId);
    if (period.status !== 'CLOSED') throw new ValidationAppError('Only a closed period can have a reopen request');

    const existingPending = await this.prisma.periodReopenRequest.findFirst({ where: { tenantId, periodId, status: 'PENDING' } });
    if (existingPending) throw new ConflictAppError('A reopen request is already pending for this period');

    const created = await this.prisma.periodReopenRequest.create({
      data: { tenantId, periodId, reason, requestedBy: userId },
    });

    await this.audit.record({
      tenantId,
      eventType: 'PERIOD_REOPEN_REQUESTED',
      entityType: 'PeriodReopenRequest',
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { periodId, reason },
    });

    return created;
  }

  async approve(tenantId: string, requestId: string, userId: string, comment?: string) {
    const req = await this.getOwnedPending(tenantId, requestId);
    if (req.requestedBy === userId) {
      throw new ValidationAppError('You cannot approve or reject a reopen request you filed yourself');
    }

    // Not wrapped in one transaction with PeriodService.reopen (which owns
    // its own write + audit record): reopening the period is the
    // consequential action and must happen even if this request row's own
    // bookkeeping below were to fail — the reverse (marking APPROVED
    // without actually reopening) would be the dangerous inconsistency.
    await this.periods.reopen(tenantId, req.periodId, userId, req.reason);

    const result = await this.prisma.periodReopenRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'APPROVED', decidedBy: userId, decidedAt: new Date(), comment, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConflictAppError('The reopen request has already been decided');

    await this.audit.record({
      tenantId,
      eventType: 'PERIOD_REOPEN_REQUEST_APPROVED',
      entityType: 'PeriodReopenRequest',
      entityId: requestId,
      action: 'UPDATE',
      userId,
      newValues: { comment },
    });

    return this.prisma.periodReopenRequest.findFirst({ where: { id: requestId } });
  }

  async reject(tenantId: string, requestId: string, userId: string, comment?: string) {
    const req = await this.getOwnedPending(tenantId, requestId);
    if (req.requestedBy === userId) {
      throw new ValidationAppError('You cannot approve or reject a reopen request you filed yourself');
    }

    const result = await this.prisma.periodReopenRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'REJECTED', decidedBy: userId, decidedAt: new Date(), comment, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConflictAppError('The reopen request has already been decided');

    await this.audit.record({
      tenantId,
      eventType: 'PERIOD_REOPEN_REQUEST_REJECTED',
      entityType: 'PeriodReopenRequest',
      entityId: requestId,
      action: 'UPDATE',
      userId,
      newValues: { comment },
    });

    return this.prisma.periodReopenRequest.findFirst({ where: { id: requestId } });
  }

  private async getOwnedPending(tenantId: string, requestId: string) {
    const req = await this.prisma.periodReopenRequest.findFirst({ where: { id: requestId, tenantId } });
    if (!req) throw new NotFoundAppError('PeriodReopenRequest', requestId);
    if (req.status !== 'PENDING') throw new ValidationAppError('This reopen request has already been decided');
    return req;
  }
}
