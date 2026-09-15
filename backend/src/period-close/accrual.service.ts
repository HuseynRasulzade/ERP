import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * AccrualService (docx spec Phase 22, sections 55-62). Manual/estimate
 * driven, never auto-generated from a heuristic (spec section 62's own
 * "no arbitrary plug entry without reason/permission") — a human records
 * the estimate with its basis, this service only posts/reverses/matches
 * it.
 */
@Injectable()
export class AccrualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: AccountingPostingEngine,
    private readonly mapping: AccountingMappingService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: {
      organizationId: string;
      financialPeriodId: string;
      accrualType: string;
      category?: string;
      counterpartyId?: string;
      contractId?: string;
      costCenterId?: string;
      projectId?: string;
      amount: number;
      currencyId: string;
      basis: string;
      estimateSource?: string;
      reversalPolicy?: string;
    },
  ) {
    if (!dto.basis) throw new ValidationAppError('An accrual must include its estimate basis (spec section 62 — no plug entries without reason)');
    const accrual = await this.prisma.periodAccrual.create({
      data: {
        tenantId,
        organizationId: dto.organizationId,
        financialPeriodId: dto.financialPeriodId,
        accrualType: dto.accrualType,
        category: dto.category,
        counterpartyId: dto.counterpartyId,
        contractId: dto.contractId,
        costCenterId: dto.costCenterId,
        projectId: dto.projectId,
        amount: dto.amount.toString(),
        currencyId: dto.currencyId,
        basis: dto.basis,
        estimateSource: dto.estimateSource,
        reversalPolicy: dto.reversalPolicy ?? 'AUTO_REVERSE_NEXT_PERIOD',
        status: 'DRAFT',
        createdBy: userId,
      },
    });
    await this.audit.record({ tenantId, eventType: 'ACCRUAL_CREATED', entityType: 'PeriodAccrual', entityId: accrual.id, action: 'CREATE', userId, newValues: { amount: dto.amount, accrualType: dto.accrualType } });
    return accrual;
  }

  async post(tenantId: string, userId: string, accrualId: string, businessDate: Date) {
    const accrual = await this.get(tenantId, accrualId);
    if (accrual.status === 'POSTED') return accrual; // idempotent retry (spec section 28)
    if (accrual.status !== 'DRAFT') throw new ValidationAppError(`Cannot post accrual from status ${accrual.status}`);

    const isRevenue = accrual.accrualType === 'REVENUE_ACCRUAL';
    const expenseAccount = await this.mapping.resolve(tenantId, accrual.organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate);
    const liabilityAccount = await this.mapping.resolve(tenantId, accrual.organizationId, MappingKeys.ACCRUED_LIABILITY, businessDate);
    const receivableAccount = await this.mapping.resolve(tenantId, accrual.organizationId, MappingKeys.ACCRUED_RECEIVABLE, businessDate);
    const revenueAccount = await this.mapping.resolve(tenantId, accrual.organizationId, MappingKeys.OTHER_OPERATING_INCOME, businessDate);

    const amount = new Decimal(accrual.amount.toString());
    const lines = isRevenue
      ? [
          { accountId: receivableAccount.id, side: 'DEBIT' as const, amountBase: amount.toString(), description: `Accrual: ${accrual.category ?? accrual.accrualType}` },
          { accountId: revenueAccount.id, side: 'CREDIT' as const, amountBase: amount.toString(), description: `Accrual: ${accrual.category ?? accrual.accrualType}` },
        ]
      : [
          { accountId: expenseAccount.id, side: 'DEBIT' as const, amountBase: amount.toString(), description: `Accrual: ${accrual.category ?? accrual.accrualType}` },
          { accountId: liabilityAccount.id, side: 'CREDIT' as const, amountBase: amount.toString(), description: `Accrual: ${accrual.category ?? accrual.accrualType}` },
        ];

    const batch = await this.posting.postBatch(tenantId, userId, {
      organizationId: accrual.organizationId,
      businessDate,
      description: `Accrual ${accrual.accrualType} — ${accrual.basis}`,
      operationType: 'PERIOD_ACCRUAL',
      sourceDocumentType: 'PERIOD_ACCRUAL',
      sourceDocumentId: accrual.id,
      lines,
    });

    await this.audit.record({ tenantId, eventType: 'ACCRUAL_POSTED', entityType: 'PeriodAccrual', entityId: accrual.id, action: 'UPDATE', userId, newValues: { journalEntryId: batch.id } });
    return this.prisma.periodAccrual.update({ where: { id: accrual.id }, data: { status: 'POSTED', journalEntryId: batch.id } });
  }

  /** Reverses a posted accrual per its own policy (spec section 59) —
   * only AUTO_REVERSE_NEXT_PERIOD/MANUAL result in an actual reversing
   * entry; CLEAR_AGAINST_ACTUAL is handled by `matchActual` instead;
   * NO_REVERSAL is a no-op. */
  async reverse(tenantId: string, userId: string, accrualId: string, businessDate: Date) {
    const accrual = await this.get(tenantId, accrualId);
    if (accrual.status !== 'POSTED') throw new ValidationAppError(`Cannot reverse accrual from status ${accrual.status}`);
    if (accrual.reversalPolicy === 'NO_REVERSAL') return accrual;
    if (!accrual.journalEntryId) throw new ValidationAppError('Accrual has no journal entry to reverse');

    const original = await this.prisma.journalEntry.findFirstOrThrow({ where: { id: accrual.journalEntryId, tenantId } });
    const reversal = await this.posting.reverse(tenantId, accrual.journalEntryId, userId, original.version, businessDate);
    return this.prisma.periodAccrual.update({ where: { id: accrual.id }, data: { status: 'REVERSED', reversalJournalEntryId: reversal.id } });
  }

  /** Links the next period's actual document against this accrual (spec
   * sections 60-62) — records the match and variance without duplicating
   * the full expense; does not itself post anything (the actual
   * document's own posting handler already did). */
  async matchActual(tenantId: string, userId: string, accrualId: string, actualDocumentType: string, actualDocumentId: string, actualAmount: Decimal.Value) {
    const accrual = await this.get(tenantId, accrualId);
    const variance = new Decimal(actualAmount).minus(accrual.amount.toString());
    await this.audit.record({ tenantId, eventType: 'ACCRUAL_MATCHED', entityType: 'PeriodAccrual', entityId: accrual.id, action: 'UPDATE', userId, newValues: { actualDocumentType, actualDocumentId, variance: variance.toString() } });
    return this.prisma.periodAccrual.update({
      where: { id: accrual.id },
      data: { status: 'MATCHED', matchedActualDocumentType: actualDocumentType, matchedActualDocumentId: actualDocumentId, matchedVariance: variance.toString() },
    });
  }

  list(tenantId: string, organizationId: string, financialPeriodId?: string) {
    return this.prisma.periodAccrual.findMany({ where: { tenantId, organizationId, financialPeriodId } });
  }

  private async get(tenantId: string, id: string) {
    const accrual = await this.prisma.periodAccrual.findFirst({ where: { id, tenantId } });
    if (!accrual) throw new NotFoundAppError('PeriodAccrual', id);
    return accrual;
  }
}
