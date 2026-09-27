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
import { CashBalanceService } from './cash-balance.service';

const ENTITY_TYPE = 'CashierHandover';

/**
 * CashierHandover (docx spec Phase 15, "Cashier Handover") — the shift
 * changeover record between two cashiers of the same cash desk. Only
 * completable once any physical-count difference tied to it is resolved
 * (a POSTED CashCountAdjustment, exactly the same resolution rule
 * CashDeskDailyCloseService uses) — spec: a handover must never paper
 * over an unexplained shortage.
 *
 * Disclosed simplification: completing a handover does not itself end
 * the outgoing cashier's CashierAssignment or start the incoming one's —
 * that stays a separate, explicit CashierAssignmentService call (see
 * docs/CASH_DESK.md). A handover records the fact and the numbers; it is
 * not the thing that grants operating rights on the desk.
 */
@Injectable()
export class CashierHandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly cashBalance: CashBalanceService,
  ) {}

  list(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    cashboxId?: string,
  ) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.cashierHandover.findMany({
          where: { organizationId, ...(cashboxId ? { cashboxId } : {}) },
          orderBy: { handoverAt: 'desc' },
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
    const row = await this.prisma.cashierHandover.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError(ENTITY_TYPE, id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    input: {
      cashboxId: string;
      outgoingCashierId: string;
      incomingCashierId: string;
      denominationCountId?: string;
      notes?: string;
    },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (input.outgoingCashierId === input.incomingCashierId)
      throw new ValidationAppError('Outgoing and incoming cashier must differ');

    const cashbox = await this.prisma.cashbox.findFirst({
      where: { id: input.cashboxId, organizationId },
    });
    if (!cashbox)
      throw new ValidationAppError(
        'Cashbox does not belong to this organization',
      );
    const [outgoing, incoming] = await Promise.all([
      this.prisma.responsiblePerson.findFirst({
        where: { id: input.outgoingCashierId, tenantId },
      }),
      this.prisma.responsiblePerson.findFirst({
        where: { id: input.incomingCashierId, tenantId },
      }),
    ]);
    if (!outgoing)
      throw new ValidationAppError(
        'Outgoing cashier does not belong to this tenant',
      );
    if (!incoming)
      throw new ValidationAppError(
        'Incoming cashier does not belong to this tenant',
      );

    const bookBalance = await this.cashBalance.getBookBalance(
      tenantId,
      input.cashboxId,
      new Date(),
    );

    let physicalBalance: Decimal | null = null;
    let difference: Decimal | null = null;
    if (input.denominationCountId) {
      const count = await this.prisma.cashPhysicalCount.findFirst({
        where: { id: input.denominationCountId, organizationId },
      });
      if (!count)
        throw new ValidationAppError(
          'Physical count does not belong to this organization',
        );
      if (count.cashboxId !== input.cashboxId)
        throw new ValidationAppError(
          'Physical count is against a different cash desk',
        );
      if (count.physicalBalance != null) {
        physicalBalance = new Decimal(count.physicalBalance.toString());
        difference = physicalBalance.minus(bookBalance);
      }
    }

    const status =
      difference && !difference.isZero() ? 'PENDING_RESOLUTION' : 'DRAFT';

    const created = await this.prisma.cashierHandover.create({
      data: {
        tenantId,
        organizationId,
        cashboxId: input.cashboxId,
        outgoingCashierId: input.outgoingCashierId,
        incomingCashierId: input.incomingCashierId,
        bookBalance,
        physicalBalance,
        difference,
        denominationCountId: input.denominationCountId,
        status,
        notes: input.notes,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'CASHIER_HANDOVER_CREATED',
      entityType: ENTITY_TYPE,
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: { cashboxId: input.cashboxId, status },
    });
    return created;
  }

  async complete(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const current = await this.get(tenantId, membershipId, organizationId, id);
    if (current.status === 'COMPLETE')
      throw new ValidationAppError('Handover is already complete');

    if (
      current.difference != null &&
      !new Decimal(current.difference.toString()).isZero()
    ) {
      if (!current.denominationCountId)
        throw new ValidationAppError(
          'Cannot complete: outstanding difference has no linked physical count',
        );
      const adjustment = await this.prisma.cashCountAdjustment.findFirst({
        where: { countId: current.denominationCountId },
      });
      if (!adjustment || adjustment.postingStatus !== 'POSTED') {
        throw new ValidationAppError(
          'Cannot complete: the linked physical count difference is not yet resolved by a posted CashCountAdjustment',
        );
      }
    }

    const result = await this.prisma.cashierHandover.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        status: 'COMPLETE',
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();
    await this.audit.record({
      tenantId,
      eventType: 'CASHIER_HANDOVER_COMPLETED',
      entityType: ENTITY_TYPE,
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.get(tenantId, membershipId, organizationId, id);
  }
}
