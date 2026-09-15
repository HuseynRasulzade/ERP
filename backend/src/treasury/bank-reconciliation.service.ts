import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { BankCashMovementService } from './bank-cash-movement.service';

const TOLERANCE = new Decimal('0.02');

/**
 * BankReconciliationService (spec sections 49-53, 95-96, 173-174). The
 * reconciliation equation (spec section 51):
 *   Book Balance + unrecorded bank credits - unrecorded bank debits ± corrections
 *   = Adjusted Book Balance = Bank Statement Closing Balance.
 * `close` enforces spec section 95's full checklist; nothing here ever
 * edits a balance directly (spec section 100 — corrections need a real
 * source document, e.g. a `BankFee`).
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly bankCash: BankCashMovementService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, statementId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const statement = await this.prisma.bankStatement.findFirst({ where: { id: statementId, tenantId, organizationId } });
    if (!statement) throw new NotFoundAppError('BankStatement', statementId);

    const bookClosingBalance = await this.bankCash.getBookBalance(tenantId, statement.bankAccountId, undefined, statement.periodEnd);
    const bookOpeningBalance = await this.bankCash.getBookBalance(tenantId, statement.bankAccountId, undefined, new Date(statement.periodStart.getTime() - 1));

    const unmatchedBank = await this.prisma.bankStatementLine.count({ where: { tenantId, statementId, matchStatus: { in: ['UNMATCHED', 'SUGGESTED', 'EXCEPTION'] } } });
    // Outstanding book payments (spec section 52) — posted bank cash
    // movements in this account/period with no active statement match yet.
    const unmatchedBook = await this.prisma.settlementPayment.count({ where: { tenantId, bankAccountId: statement.bankAccountId, postingStatus: 'POSTED', matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] }, documentDate: { lte: statement.periodEnd } } });

    const difference = bookClosingBalance.minus(statement.closingBalance.toString());

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.bankReconciliation.create({
        data: {
          tenantId,
          organizationId,
          bankAccountId: statement.bankAccountId,
          statementId,
          periodStart: statement.periodStart,
          periodEnd: statement.periodEnd,
          bookOpeningBalance: bookOpeningBalance.toString(),
          bankOpeningBalance: statement.openingBalance.toString(),
          bookMovementsTotal: bookClosingBalance.minus(bookOpeningBalance).toString(),
          bankMovementsTotal: new Decimal(statement.totalCredits.toString()).minus(statement.totalDebits.toString()).toString(),
          unmatchedBookItemsCount: unmatchedBook,
          unmatchedBankItemsCount: unmatchedBank,
          adjustedBookBalance: bookClosingBalance.toString(),
          statementClosingBalance: statement.closingBalance.toString(),
          difference: difference.toString(),
          status: difference.abs().lte(TOLERANCE) && unmatchedBank === 0 ? 'READY_TO_CLOSE' : 'DIFFERENCE_FOUND',
        },
      });
      await this.audit.record({ tenantId, eventType: 'BANK_RECONCILIATION_CLOSED', entityType: 'BANK_RECONCILIATION', entityId: row.id, action: 'CREATE', userId, newValues: { difference: difference.toString(), status: row.status } }, tx);
      return row;
    });
  }

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.bankReconciliation.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('BankReconciliation', id);

    const problems: string[] = [];
    if (new Decimal(row.difference.toString()).abs().gt(TOLERANCE)) problems.push(`difference ${row.difference.toString()} exceeds tolerance`);
    if (row.unmatchedBankItemsCount > 0) problems.push(`${row.unmatchedBankItemsCount} unmatched bank statement line(s)`);

    // Opening-balance continuity (spec section 96): the previous
    // reconciliation for this account, if any, must actually be CLOSED.
    const previous = await this.prisma.bankReconciliation.findFirst({ where: { tenantId, bankAccountId: row.bankAccountId, periodEnd: { lt: row.periodStart } }, orderBy: { periodEnd: 'desc' } });
    if (previous && previous.status !== 'CLOSED') problems.push('the previous reconciliation for this account is not closed yet');

    if (problems.length > 0) throw new ValidationAppError(`Cannot close bank reconciliation: ${problems.join('; ')}`);

    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.bankReconciliation.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: userId } });
      await tx.bankStatement.update({ where: { id: row.statementId }, data: { status: 'RECONCILED', reconciledAt: new Date() } });
      await this.audit.record({ tenantId, eventType: 'BANK_RECONCILIATION_CLOSED', entityType: 'BANK_RECONCILIATION', entityId: id, action: 'UPDATE', userId, newValues: { status: 'CLOSED' } }, tx);
      return updated;
    });
  }

  async reopen(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, reason: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (!reason) throw new ValidationAppError('A reopen reason is required (spec section 152)');
    const row = await this.prisma.bankReconciliation.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('BankReconciliation', id);
    if (row.status !== 'CLOSED') throw new ValidationAppError('Only a closed reconciliation can be reopened');

    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.bankReconciliation.update({ where: { id }, data: { status: 'REOPENED', reopenedAt: new Date(), reopenedBy: userId, reopenReason: reason } });
      await this.audit.record({ tenantId, eventType: 'BANK_RECONCILIATION_CLOSED', entityType: 'BANK_RECONCILIATION', entityId: id, action: 'UPDATE', userId, oldValues: { status: 'CLOSED' }, newValues: { status: 'REOPENED', reason } }, tx);
      return updated;
    });
  }
}
