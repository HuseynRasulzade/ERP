import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { SettlementMovementService } from './settlement-movement.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

/**
 * SettlementOffsetService (spec sections 41-44) — nets one counterparty's
 * OWN receivable against its OWN payable. Cross-counterparty netting is
 * out of scope entirely (spec section 43's default-block — every open
 * item this touches is required to already belong to `counterpartyId`,
 * so there is no code path that could net two different counterparties).
 */
@Injectable()
export class SettlementOffsetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly movements: SettlementMovementService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.settlementOffset.findMany({ where: { tenantId, organizationId, ...(counterpartyId ? { counterpartyId } : {}) }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  }

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { counterpartyId: string; offsetDate: string; currencyId?: string; amount: number; reason?: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const receivables = await tx.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId: dto.counterpartyId, itemType: 'RECEIVABLE', status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, orderBy: { dueDate: 'asc' } });
      const payables = await tx.settlementOpenItem.findMany({ where: { tenantId, organizationId, counterpartyId: dto.counterpartyId, itemType: 'PAYABLE', status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } }, orderBy: { dueDate: 'asc' } });

      const availableReceivable = receivables.reduce((s, r) => s.plus(r.remainingAmount.toString()), new Decimal(0));
      const availablePayable = payables.reduce((s, r) => s.plus(r.remainingAmount.toString()), new Decimal(0));
      const amount = new Decimal(dto.amount);
      if (amount.lte(0)) throw new ValidationAppError('Offset amount must be positive');
      if (amount.gt(availableReceivable) || amount.gt(availablePayable)) {
        throw new ValidationAppError(`Offset amount ${amount.toFixed(2)} exceeds available receivable (${availableReceivable.toFixed(2)}) or payable (${availablePayable.toFixed(2)}) for this counterparty`);
      }

      const offset = await tx.settlementOffset.create({
        data: { tenantId, organizationId, counterpartyId: dto.counterpartyId, offsetDate: new Date(dto.offsetDate), currencyId: dto.currencyId, amount: amount.toString(), reason: dto.reason, createdBy: userId },
      });

      await this.writeLines(tx, offset.id, tenantId, receivables, amount, 'RECEIVABLE');
      await this.writeLines(tx, offset.id, tenantId, payables, amount, 'PAYABLE');

      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_OFFSET_CREATED', entityType: 'SETTLEMENT_OFFSET', entityId: offset.id, action: 'CREATE', userId, newValues: { counterpartyId: dto.counterpartyId, amount: amount.toString() } }, tx);
      return tx.settlementOffset.findFirst({ where: { id: offset.id }, include: { lines: true } });
    });
  }

  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const offset = await tx.settlementOffset.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
      if (!offset) throw new NotFoundAppError('SettlementOffset', id);
      if (offset.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (offset.status !== 'DRAFT') throw new ValidationAppError('Only a DRAFT offset can be posted');

      for (const line of offset.lines) {
        const delta = new Decimal(line.amount.toString()).negated();
        await this.movements.applyDelta(tenantId, line.openItemId, delta, delta, tx);
        const openItem = await tx.settlementOpenItem.findFirstOrThrow({ where: { id: line.openItemId } });
        await tx.settlementMovement.create({
          data: {
            tenantId,
            organizationId,
            counterpartyId: offset.counterpartyId,
            counterpartyRole: openItem.counterpartyRole,
            openItemId: line.openItemId,
            currencyId: offset.currencyId,
            movementType: 'OFFSET',
            amount: delta.toString(),
            baseAmount: delta.toString(),
            sourceDocumentType: 'SETTLEMENT_OFFSET',
            sourceDocumentId: offset.id,
            effectiveDate: offset.offsetDate,
            postingDate: offset.offsetDate,
            createdBy: userId,
          },
        });
      }

      const updated = await tx.settlementOffset.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedBy: userId, version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'SETTLEMENT_OFFSET_POSTED', entityType: 'SETTLEMENT_OFFSET', entityId: id, action: 'POST', userId }, tx);
      return updated;
    });
  }

  private async writeLines(tx: PrismaTransactionClient, offsetId: string, tenantId: string, items: { id: string; remainingAmount: any }[], amount: Decimal, side: 'RECEIVABLE' | 'PAYABLE') {
    let remaining = amount;
    for (const item of items) {
      if (remaining.lte(0)) break;
      const itemRemaining = new Decimal(item.remainingAmount.toString());
      const applied = Decimal.min(remaining, itemRemaining);
      if (applied.lte(0)) continue;
      await tx.settlementOffsetLine.create({ data: { tenantId, settlementOffsetId: offsetId, openItemId: item.id, side, amount: applied.toString() } });
      remaining = remaining.minus(applied);
    }
  }
}
