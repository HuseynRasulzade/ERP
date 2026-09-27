import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  ValidationAppError,
} from '../common/errors/app-error';
import {
  CloseBankReconciliationDto,
  CreateBankReconciliationDto,
  ReopenBankReconciliationDto,
} from './dto/bank-reconciliation.dto';

const RECONCILIATION_TYPE = 'BANK_RECONCILIATION';
const TOLERANCE = new Decimal('0.01');

/**
 * Bank Reconciliation period close (spec sections 49-51, 95-99) — a
 * formal per-bank-account/per-period checkpoint layered ON TOP of
 * BankStatementLine's own line-level matching (BankReconciliationService),
 * never a second parallel matching mechanism: this only aggregates that
 * period's lines into book-vs-bank balances and gates CLOSED on every
 * line being resolved and the difference falling within tolerance.
 */
@Injectable()
export class BankReconciliationPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    bankAccountId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.bankReconciliation.findMany({
          where: {
            organizationId,
            ...(bankAccountId ? { bankAccountId } : {}),
          },
          orderBy: { periodStart: 'desc' },
        }),
      );
  }

  async get(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.bankReconciliation.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('BankReconciliation', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateBankReconciliationDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId },
    });
    if (!bankAccount)
      throw new ValidationAppError(
        'Bank account does not belong to this organization',
      );

    const periodStart = this.parseDate(dto.periodStart);
    const periodEnd = this.parseDate(dto.periodEnd);
    if (periodEnd < periodStart)
      throw new ValidationAppError('periodEnd must be on or after periodStart');

    // Opening-balance continuity (spec section 96): the previous
    // reconciliation's own closing balance should equal this one's
    // opening — a mismatch is a warning surfaced on the row, not a hard
    // block (the user may be entering historical/migration data).
    const previous = await this.prisma.bankReconciliation.findFirst({
      where: {
        organizationId,
        bankAccountId: dto.bankAccountId,
        periodEnd: { lt: periodStart },
      },
      orderBy: { periodEnd: 'desc' },
    });
    const continuityWarning =
      previous?.bookClosingBalance != null &&
      !new Decimal(previous.bookClosingBalance.toString())
        .sub(dto.bookOpeningBalance)
        .abs()
        .lte(TOLERANCE)
        ? `Previous reconciliation's book closing balance (${previous.bookClosingBalance.toString()}) does not match this period's opening balance (${dto.bookOpeningBalance})`
        : null;

    const created = await this.prisma.bankReconciliation.create({
      data: {
        tenantId,
        organizationId,
        bankAccountId: dto.bankAccountId,
        periodStart,
        periodEnd,
        bookOpeningBalance: new Decimal(dto.bookOpeningBalance.toString()),
        bankOpeningBalance: new Decimal(dto.bankOpeningBalance.toString()),
        status: 'DRAFT',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'BANK_RECONCILIATION_CREATED',
      entityType: RECONCILIATION_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: {
        bankAccountId: dto.bankAccountId,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
      },
    });
    return continuityWarning ? { ...created, continuityWarning } : created;
  }

  /** Pure computation — never writes anything, so both `refresh` (which
   * persists the result as a new version) and `close` (which only needs
   * fresh numbers to validate against, not another version bump) can call
   * it without fighting over the row's optimistic-lock version. */
  private async computeBalances(
    organizationId: string,
    reconciliation: {
      bankAccountId: string;
      periodStart: Date;
      periodEnd: Date;
      bankOpeningBalance: any;
      bookOpeningBalance: any;
    },
  ) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        organizationId,
        bankAccountId: reconciliation.bankAccountId,
        statementDate: {
          gte: reconciliation.periodStart,
          lte: reconciliation.periodEnd,
        },
      },
    });
    const bankMovements = lines.reduce(
      (s, l) => s.plus(l.amount.toString()),
      new Decimal(0),
    );
    const bankClosingBalance = new Decimal(
      reconciliation.bankOpeningBalance.toString(),
    ).plus(bankMovements);

    const matchedMovements = lines
      .filter((l) => l.status === 'MATCHED')
      .reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    const bookClosingBalance = new Decimal(
      reconciliation.bookOpeningBalance.toString(),
    ).plus(matchedMovements);

    const unmatchedLineCount = lines.filter(
      (l) => l.status !== 'MATCHED',
    ).length;
    const difference = bookClosingBalance.minus(bankClosingBalance);
    const status =
      unmatchedLineCount > 0 || difference.abs().gt(TOLERANCE)
        ? 'DIFFERENCE_FOUND'
        : 'READY_TO_CLOSE';
    return {
      bookClosingBalance,
      bankClosingBalance,
      difference,
      status,
      unmatchedLineCount,
    };
  }

  /** Recomputes and PERSISTS book/bank closing balances and the difference
   * from this period's own BankStatementLine rows — never manually edited
   * (spec section 100: "Manual arbitrary balance correction qadağandır"). */
  async refresh(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const reconciliation = await this.get(
      tenantId,
      membershipId,
      organizationId,
      id,
    );
    if (reconciliation.status === 'CLOSED')
      throw new ValidationAppError(
        'Cannot refresh a closed reconciliation — reopen it first',
      );

    const {
      bookClosingBalance,
      bankClosingBalance,
      difference,
      status,
      unmatchedLineCount,
    } = await this.computeBalances(organizationId, reconciliation);
    const updated = await this.prisma.bankReconciliation.update({
      where: { id },
      data: {
        bookClosingBalance,
        bankClosingBalance,
        difference,
        status,
        version: { increment: 1 },
      },
    });
    return { ...updated, unmatchedLineCount };
  }

  /**
   * Close (spec sections 95-99): every line resolved (MATCHED) and the
   * book-vs-bank difference within tolerance. Disclosed simplification:
   * a dedicated "executor != reconciliation closer" segregation-of-duties
   * check (spec section 106) is not enforced here — see docs/TREASURY.md.
   */
  async close(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: CloseBankReconciliationDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'CLOSED')
      throw new ValidationAppError(
        'Cannot close a reconciliation — reopen it first',
      );
    const {
      bookClosingBalance,
      bankClosingBalance,
      difference,
      status,
      unmatchedLineCount,
    } = await this.computeBalances(organizationId, current);
    if (status !== 'READY_TO_CLOSE') {
      throw new ValidationAppError(
        `Cannot close: status is ${status} (${unmatchedLineCount} unresolved line(s) or a difference outside tolerance)`,
      );
    }

    const result = await this.prisma.bankReconciliation.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        bookClosingBalance,
        bankClosingBalance,
        difference,
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: userId,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'BANK_RECONCILIATION_CLOSED',
      entityType: RECONCILIATION_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  /** Reopen (spec section 152) — only a closed period, reason mandatory. */
  async reopen(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    id: string,
    userId: string,
    dto: ReopenBankReconciliationDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status !== 'CLOSED')
      throw new ValidationAppError(
        'Only a CLOSED reconciliation can be reopened',
      );
    if (!dto.reason?.trim())
      throw new ValidationAppError('A reopen reason is required');

    const result = await this.prisma.bankReconciliation.updateMany({
      where: { id, organizationId, version: dto.expectedVersion },
      data: {
        status: 'REOPENED',
        reopenReason: dto.reason,
        reopenedAt: new Date(),
        reopenedBy: userId,
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'BANK_RECONCILIATION_REOPENED',
      entityType: RECONCILIATION_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
      newValues: { reason: dto.reason },
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid date');
    return date;
  }
}
