import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { SettlementReportingService } from './settlement-reporting.service';

const EPSILON = new Decimal('0.01');

/**
 * SettlementReconciliationService (spec sections 62-67) — the header
 * persists the confirmed/agreed state; the lines are always the live
 * `SettlementMovement` rows for the period (`SettlementReportingService.statement`),
 * never duplicated into a stored line table.
 */
@Injectable()
export class SettlementReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly reporting: SettlementReportingService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.settlementReconciliation.findMany({ where: { tenantId, organizationId, ...(counterpartyId ? { counterpartyId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async generate(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { counterpartyId: string; contractId?: string; periodStart: string; periodEnd: string; currencyId?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    const statement = await this.reporting.statement(tenantId, membershipId, organizationId, dto.counterpartyId, periodStart, periodEnd, dto.contractId);

    const row = await this.prisma.settlementReconciliation.create({
      data: {
        tenantId,
        organizationId,
        counterpartyId: dto.counterpartyId,
        contractId: dto.contractId,
        periodStart,
        periodEnd,
        currencyId: dto.currencyId,
        openingBalance: statement.openingBalance,
        debitTurnover: statement.debitTurnover,
        creditTurnover: statement.creditTurnover,
        closingBalance: statement.closingBalance,
        status: 'GENERATED',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'SETTLEMENT_RECONCILIATION_GENERATED', entityType: 'SETTLEMENT_RECONCILIATION', entityId: row.id, action: 'CREATE', userId, newValues: { closingBalance: statement.closingBalance } });
    return { ...row, lines: statement.lines };
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementReconciliation.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('SettlementReconciliation', id);
    const statement = await this.reporting.statement(tenantId, membershipId, organizationId, row.counterpartyId, row.periodStart, row.periodEnd, row.contractId ?? undefined);
    return { ...row, lines: statement.lines };
  }

  /** Records the counterparty's own confirmation/difference (spec
   * sections 65-67). A `theirBalance` beyond tolerance of our own
   * closing balance flips status to DIFFERENCE_FOUND rather than
   * silently accepting the counterparty's number. */
  async confirm(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: { confirmedByUs?: boolean; confirmedByCounterparty?: boolean; theirBalance?: number; differenceReason?: string; notes?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.settlementReconciliation.findFirst({ where: { id, tenantId, organizationId } });
    if (!row) throw new NotFoundAppError('SettlementReconciliation', id);
    if (['RECONCILED', 'CANCELLED'].includes(row.status)) throw new ValidationAppError(`Cannot update a reconciliation that is already ${row.status}`);

    const confirmedByUs = dto.confirmedByUs ?? row.confirmedByUs;
    const confirmedByCounterparty = dto.confirmedByCounterparty ?? row.confirmedByCounterparty;
    const theirBalance = dto.theirBalance != null ? new Decimal(dto.theirBalance) : row.theirBalance ? new Decimal(row.theirBalance.toString()) : null;
    const hasDifference = theirBalance !== null && theirBalance.minus(row.closingBalance.toString()).abs().gt(EPSILON);

    const status = hasDifference ? 'DIFFERENCE_FOUND' : confirmedByUs && confirmedByCounterparty ? 'RECONCILED' : confirmedByCounterparty ? 'COUNTERPARTY_CONFIRMED' : 'SENT';

    const updated = await this.prisma.settlementReconciliation.update({
      where: { id },
      data: { confirmedByUs, confirmedByCounterparty, theirBalance: theirBalance?.toString(), differenceReason: dto.differenceReason, notes: dto.notes ?? row.notes, status, signedDate: status === 'RECONCILED' ? new Date() : row.signedDate },
    });
    await this.audit.record({ tenantId, eventType: 'SETTLEMENT_RECONCILIATION_CONFIRMED', entityType: 'SETTLEMENT_RECONCILIATION', entityId: id, action: 'UPDATE', userId, newValues: { status } });
    return updated;
  }
}
