import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SettlementMovementService } from './settlement-movement.service';

/**
 * SettlementReconciliationService (spec sections 62-67, 168). Statement
 * lines are computed live from `SettlementMovement` (schema file header)
 * rather than persisted — `generate` snapshots only the header totals
 * into `SettlementReconciliation` for the confirm/status workflow.
 */
@Injectable()
export class SettlementReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly movements: SettlementMovementService,
  ) {}

  async statementLines(tenantId: string, organizationId: string, counterpartyId: string, counterpartyRole: 'CUSTOMER' | 'SUPPLIER', periodStart: Date, periodEnd: Date) {
    const opening = await this.movements.getBalanceAsOf(tenantId, organizationId, counterpartyId, counterpartyRole, new Date(periodStart.getTime() - 1));
    const periodMovements = await this.prisma.settlementMovement.findMany({
      where: { tenantId, organizationId, counterpartyId, counterpartyRole, effectiveDate: { gte: periodStart, lte: periodEnd } },
      orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
    });

    let running = opening;
    const lines = periodMovements.map((m) => {
      running = running.plus(m.baseCurrencyAmount.toString());
      return { date: m.effectiveDate, documentType: m.sourceDocumentType, documentId: m.sourceDocumentId, movementType: m.movementType, debit: m.debitAmount.toString(), credit: m.creditAmount.toString(), runningBalance: running.toString() };
    });

    return { opening: opening.toString(), lines, closing: running.toString() };
  }

  async generate(tenantId: string, membershipId: string, organizationId: string, userId: string, input: { counterpartyId: string; counterpartyRole: 'CUSTOMER' | 'SUPPLIER'; contractId?: string; currencyId: string; periodStart: string; periodEnd: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    const statement = await this.statementLines(tenantId, organizationId, input.counterpartyId, input.counterpartyRole, periodStart, periodEnd);
    const debitTurnover = statement.lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
    const creditTurnover = statement.lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.settlementReconciliation.create({
        data: {
          tenantId,
          organizationId,
          counterpartyId: input.counterpartyId,
          contractId: input.contractId,
          periodStart,
          periodEnd,
          currencyId: input.currencyId,
          openingBalance: statement.opening,
          debitTurnover: debitTurnover.toString(),
          creditTurnover: creditTurnover.toString(),
          closingBalance: statement.closing,
          status: 'GENERATED',
          createdBy: userId,
        },
      });
      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_RECONCILED', entityType: 'SETTLEMENT_RECONCILIATION', entityId: row.id, action: 'CREATE', userId, newValues: { closingBalance: statement.closing } }, tx);
      return { ...row, lines: statement.lines };
    });
  }

  async recordCounterpartyDifference(tenantId: string, membershipId: string, organizationId: string, userId: string, reconciliationId: string, theirBalance: number, differenceReason: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementReconciliation.findFirst({ where: { id: reconciliationId, tenantId } });
    if (!row) throw new NotFoundAppError('SettlementReconciliation', reconciliationId);
    const ourBalance = new Decimal(row.closingBalance.toString());
    const difference = ourBalance.minus(theirBalance);
    const status = difference.abs().lte('0.01') ? 'RECONCILED' : 'DIFFERENCE_FOUND';

    return this.prisma.settlementReconciliation.update({ where: { id: reconciliationId }, data: { theirBalance: theirBalance.toString(), differenceReason: status === 'DIFFERENCE_FOUND' ? differenceReason : undefined, status } });
  }

  async confirm(tenantId: string, membershipId: string, organizationId: string, userId: string, reconciliationId: string, by: 'US' | 'COUNTERPARTY') {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementReconciliation.findFirst({ where: { id: reconciliationId, tenantId } });
    if (!row) throw new NotFoundAppError('SettlementReconciliation', reconciliationId);
    const data = by === 'US' ? { confirmedByUs: true } : { confirmedByCounterparty: true };
    const updated = await this.prisma.settlementReconciliation.update({ where: { id: reconciliationId }, data: { ...data, status: (by === 'US' ? true : row.confirmedByUs) && (by === 'COUNTERPARTY' ? true : row.confirmedByCounterparty) ? 'RECONCILED' : row.status } });
    return updated;
  }

  async close(tenantId: string, membershipId: string, organizationId: string, userId: string, reconciliationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementReconciliation.findFirst({ where: { id: reconciliationId, tenantId } });
    if (!row) throw new NotFoundAppError('SettlementReconciliation', reconciliationId);
    if (row.status !== 'RECONCILED') throw new ValidationAppError('Cannot close a reconciliation that is not yet RECONCILED');
    return this.prisma.settlementReconciliation.update({ where: { id: reconciliationId }, data: { status: 'CLOSED' } });
  }
}
