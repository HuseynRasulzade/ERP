import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { SettlementMovementService } from './settlement-movement.service';
import { ConcurrencyConflictError, NotFoundAppError, ValidationAppError } from '../common/errors/app-error';

const SEQUENCE_TYPE = 'DEBT_ADJUSTMENT';
const SEQUENCE_PREFIX = 'DADJ';

const MOVEMENT_TYPE_BY_OPERATION: Record<string, string> = {
  RECEIVABLE_INCREASE: 'DEBIT_NOTE',
  RECEIVABLE_DECREASE: 'CREDIT_NOTE',
  PAYABLE_INCREASE: 'DEBIT_NOTE',
  PAYABLE_DECREASE: 'CREDIT_NOTE',
  DEBT_WRITE_OFF: 'WRITE_OFF',
  CREDIT_RECLASSIFICATION: 'RECLASSIFICATION',
  CONTRACT_TRANSFER: 'RECLASSIFICATION',
  COUNTERPARTY_TRANSFER: 'RECLASSIFICATION',
  OTHER: 'RECLASSIFICATION',
};

/**
 * DebtAdjustmentService — the universal manual settlement correction
 * (spec sections 40, 45-48, 96-98), one `operationType` axis instead of
 * separate Credit Note / Debit Note / Write-Off / Reclassification /
 * Transfer document classes (the same consolidation InventoryAdjustment
 * used in Phase 10 — disclosed in docs/SETTLEMENT.md). Requires
 * `SETTLEMENT_CREATE_ADJUSTMENT` to draft, `SETTLEMENT_APPROVE_ADJUSTMENT`
 * to approve (a different user than the creator — spec section 134), and
 * posting applies the real `SettlementMovement`/open-item consequence.
 */
@Injectable()
export class DebtAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly movements: SettlementMovementService,
  ) {}

  async list(tenantId: string, membershipId: string, organizationId: string, counterpartyId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.debtAdjustment.findMany({ where: { tenantId, organizationId, ...(counterpartyId ? { counterpartyId } : {}) }, include: { lines: true }, orderBy: { createdAt: 'desc' } });
  }

  async get(tenantId: string, membershipId: string, organizationId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.debtAdjustment.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
    if (!row) throw new NotFoundAppError('DebtAdjustment', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: {
      counterpartyId: string;
      documentDate: string;
      operationType: string;
      reasonCode?: string;
      description?: string;
      lines: { openItemId?: string; amount: number; targetContractId?: string; targetCounterpartyId?: string; description?: string }[];
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.lines.length === 0) throw new ValidationAppError('A debt adjustment requires at least one line');
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, SEQUENCE_TYPE, new Date(dto.documentDate), tx);
      const header = await tx.debtAdjustment.create({
        data: { tenantId, organizationId, counterpartyId: dto.counterpartyId, number: allocated.formatted, documentDate: new Date(dto.documentDate), operationType: dto.operationType, reasonCode: dto.reasonCode, description: dto.description, createdBy: userId },
      });
      for (const line of dto.lines) {
        await tx.debtAdjustmentLine.create({
          data: { tenantId, debtAdjustmentId: header.id, openItemId: line.openItemId, targetContractId: line.targetContractId, targetCounterpartyId: line.targetCounterpartyId, amount: new Decimal(line.amount).toString(), description: line.description },
        });
      }
      await this.audit.record({ tenantId, eventType: 'DEBT_ADJUSTMENT_CREATED', entityType: 'DEBT_ADJUSTMENT', entityId: header.id, action: 'CREATE', userId, newValues: { operationType: dto.operationType, lineCount: dto.lines.length } }, tx);
      return tx.debtAdjustment.findFirst({ where: { id: header.id }, include: { lines: true } });
    });
  }

  async approve(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const adj = await tx.debtAdjustment.findFirst({ where: { id, tenantId, organizationId } });
      if (!adj) throw new NotFoundAppError('DebtAdjustment', id);
      if (adj.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (adj.status !== 'DRAFT') throw new ValidationAppError('Only a DRAFT debt adjustment can be approved');
      if (adj.createdBy === userId) throw new ValidationAppError('The creator of a debt adjustment cannot also approve it (segregation of duties)');

      const updated = await tx.debtAdjustment.update({ where: { id }, data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'DEBT_ADJUSTMENT_APPROVED', entityType: 'DEBT_ADJUSTMENT', entityId: id, action: 'UPDATE', userId }, tx);
      return updated;
    });
  }

  async post(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, expectedVersion: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    return this.prisma.runInTransaction(async (tx) => {
      const adj = await tx.debtAdjustment.findFirst({ where: { id, tenantId, organizationId }, include: { lines: true } });
      if (!adj) throw new NotFoundAppError('DebtAdjustment', id);
      if (adj.version !== expectedVersion) throw new ConcurrencyConflictError();
      if (adj.status !== 'APPROVED') throw new ValidationAppError('Only an APPROVED debt adjustment can be posted');

      const movementType = MOVEMENT_TYPE_BY_OPERATION[adj.operationType] ?? 'RECLASSIFICATION';
      const isIncrease = adj.operationType === 'RECEIVABLE_INCREASE' || adj.operationType === 'PAYABLE_INCREASE';
      const isDecreaseLike = ['RECEIVABLE_DECREASE', 'PAYABLE_DECREASE', 'DEBT_WRITE_OFF'].includes(adj.operationType);

      for (const line of adj.lines) {
        const amount = new Decimal(line.amount.toString());

        if (adj.operationType === 'CONTRACT_TRANSFER' && line.openItemId && line.targetContractId) {
          await tx.settlementOpenItem.update({ where: { id: line.openItemId }, data: { contractId: line.targetContractId } });
          await this.writeZeroMovement(tx, tenantId, organizationId, adj, line.openItemId, 'RECLASSIFICATION', userId);
          continue;
        }
        if (adj.operationType === 'COUNTERPARTY_TRANSFER' && line.openItemId && line.targetCounterpartyId) {
          await tx.settlementOpenItem.update({ where: { id: line.openItemId }, data: { counterpartyId: line.targetCounterpartyId } });
          await this.writeZeroMovement(tx, tenantId, organizationId, adj, line.openItemId, 'RECLASSIFICATION', userId);
          continue;
        }

        if (!line.openItemId) {
          if (!isIncrease) throw new ValidationAppError('A decrease/write-off/reclassification line requires an existing open item');
          const role = adj.operationType === 'RECEIVABLE_INCREASE' ? 'CUSTOMER' : 'SUPPLIER';
          const openItem = await tx.settlementOpenItem.findFirst({ where: { tenantId, organizationId, counterpartyId: adj.counterpartyId, itemType: role === 'CUSTOMER' ? 'RECEIVABLE' : 'PAYABLE' } });
          const currencyId = openItem?.currencyId ?? (await this.resolveOrgBaseCurrency(tx, tenantId, organizationId));
          if (role === 'CUSTOMER') {
            await this.movements.createReceivable(tenantId, { organizationId, counterpartyId: adj.counterpartyId, sourceDocumentType: 'DEBT_ADJUSTMENT', sourceDocumentId: adj.id, sourceDate: adj.documentDate, currencyId: currencyId!, grossAmount: amount, baseAmount: amount, defaultDueDate: adj.documentDate, createdBy: userId }, tx);
          } else {
            await this.movements.createPayable(tenantId, { organizationId, counterpartyId: adj.counterpartyId, sourceDocumentType: 'DEBT_ADJUSTMENT', sourceDocumentId: adj.id, sourceDate: adj.documentDate, currencyId: currencyId!, grossAmount: amount, baseAmount: amount, defaultDueDate: adj.documentDate, createdBy: userId }, tx);
          }
          continue;
        }

        const openItem = await tx.settlementOpenItem.findFirstOrThrow({ where: { id: line.openItemId, tenantId } });
        const delta = isDecreaseLike ? amount.negated() : amount;
        await this.movements.applyDelta(tenantId, line.openItemId, delta, delta, tx);
        if (adj.operationType === 'DEBT_WRITE_OFF') {
          await tx.settlementOpenItem.update({ where: { id: line.openItemId }, data: { status: 'WRITTEN_OFF' } });
        }
        await tx.settlementMovement.create({
          data: {
            tenantId,
            organizationId,
            counterpartyId: adj.counterpartyId,
            counterpartyRole: openItem.counterpartyRole,
            openItemId: line.openItemId,
            currencyId: openItem.currencyId,
            movementType,
            amount: delta.toString(),
            baseAmount: delta.toString(),
            sourceDocumentType: 'DEBT_ADJUSTMENT',
            sourceDocumentId: adj.id,
            effectiveDate: adj.documentDate,
            postingDate: adj.documentDate,
            createdBy: userId,
          },
        });
      }

      const updated = await tx.debtAdjustment.update({ where: { id }, data: { status: 'POSTED', postedBy: userId, postedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ tenantId, eventType: 'DEBT_ADJUSTMENT_POSTED', entityType: 'DEBT_ADJUSTMENT', entityId: id, action: 'POST', userId }, tx);
      return updated;
    });
  }

  private async writeZeroMovement(tx: PrismaTransactionClient, tenantId: string, organizationId: string, adj: { id: string; documentDate: Date; counterpartyId: string }, openItemId: string, movementType: string, userId: string) {
    const openItem = await tx.settlementOpenItem.findFirstOrThrow({ where: { id: openItemId, tenantId } });
    await tx.settlementMovement.create({
      data: { tenantId, organizationId, counterpartyId: adj.counterpartyId, counterpartyRole: openItem.counterpartyRole, openItemId, currencyId: openItem.currencyId, movementType, amount: '0', baseAmount: '0', sourceDocumentType: 'DEBT_ADJUSTMENT', sourceDocumentId: adj.id, effectiveDate: adj.documentDate, postingDate: adj.documentDate, createdBy: userId },
    });
  }

  private async resolveOrgBaseCurrency(tx: PrismaTransactionClient, tenantId: string, organizationId: string): Promise<string | null> {
    const org = await tx.organization.findUnique({ where: { id: organizationId } });
    if (org?.baseCurrencyId) return org.baseCurrencyId;
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    return tenant?.baseCurrencyId ?? null;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: SEQUENCE_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: SEQUENCE_TYPE, documentType: SEQUENCE_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
