import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CashMovementService } from './cash-movement.service';

/**
 * CashierHandoverService (spec section 8: shift-change reconciliation
 * between an outgoing and incoming cashier). `initiate` records the book
 * vs. physical comparison at the moment of handover (mirrors
 * `CashPhysicalCountService`'s own comparison, but scoped to one shift
 * rather than a full count cycle); `complete` is only reachable once any
 * difference has a resolution note attached (spec: "yalnız fərq
 * resolution-dan sonra complete edilə bilər").
 */
@Injectable()
export class CashierHandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly cashMovements: CashMovementService,
  ) {}

  async initiate(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { cashDeskId: string; outgoingCashierId: string; incomingCashierId: string; currencyId: string; physicalBalance: number; denominationCountId?: string; notes?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    if (dto.outgoingCashierId === dto.incomingCashierId) throw new ValidationAppError('Outgoing and incoming cashier must differ');
    const bookBalance = await this.cashMovements.getBalance(tenantId, dto.cashDeskId, dto.currencyId);
    const physicalBalance = new Decimal(dto.physicalBalance);
    const difference = physicalBalance.minus(bookBalance);

    return this.prisma.runInTransaction(async (tx) => {
      const row = await tx.cashierHandover.create({
        data: {
          tenantId,
          cashDeskId: dto.cashDeskId,
          outgoingCashierId: dto.outgoingCashierId,
          incomingCashierId: dto.incomingCashierId,
          bookBalance: bookBalance.toString(),
          physicalBalance: physicalBalance.toString(),
          difference: difference.toString(),
          denominationCountId: dto.denominationCountId,
          status: difference.abs().lte('0.01') ? 'PENDING' : 'DIFFERENCE_PENDING',
          notes: dto.notes,
        },
      });
      await this.audit.record({ tenantId, eventType: 'CASHIER_HANDOVER_INITIATED', entityType: 'CASHIER_HANDOVER', entityId: row.id, action: 'CREATE', userId, newValues: { bookBalance: bookBalance.toString(), physicalBalance: physicalBalance.toString(), difference: difference.toString() } }, tx);
      return row;
    });
  }

  /** Resolves an open difference (a note, or a link to the
   * CashCountAdjustment that already wrote it off) without yet completing
   * the handover — kept separate from `complete` so the resolution is its
   * own audited step. */
  async resolveDifference(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, resolutionNote: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashierHandover.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('CashierHandover', id);
    if (row.status !== 'DIFFERENCE_PENDING') throw new ValidationAppError(`Cannot resolve — current status is ${row.status}`);
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.cashierHandover.update({ where: { id }, data: { status: 'PENDING', notes: [row.notes, resolutionNote].filter(Boolean).join(' | ') } });
      await this.audit.record({ tenantId, eventType: 'CASHIER_HANDOVER_DIFFERENCE_RESOLVED', entityType: 'CASHIER_HANDOVER', entityId: id, action: 'UPDATE', userId, newValues: { resolutionNote } }, tx);
      return updated;
    });
  }

  async complete(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashierHandover.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('CashierHandover', id);
    if (row.status !== 'PENDING') throw new ValidationAppError(`Cannot complete — current status is ${row.status} (a DIFFERENCE_PENDING handover must be resolved first)`);
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.cashierHandover.update({ where: { id }, data: { status: 'COMPLETED' } });
      await tx.cashierAssignment.updateMany({ where: { tenantId, cashDeskId: row.cashDeskId, userId: row.outgoingCashierId, status: 'ACTIVE' }, data: { status: 'ENDED', validTo: new Date(), closingHandoverDocumentId: id } });
      await this.audit.record({ tenantId, eventType: 'CASHIER_HANDOVER_COMPLETED', entityType: 'CASHIER_HANDOVER', entityId: id, action: 'UPDATE', userId, newValues: {} }, tx);
      return updated;
    });
  }

  async cancel(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const row = await this.prisma.cashierHandover.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundAppError('CashierHandover', id);
    if (row.status === 'COMPLETED') throw new ValidationAppError('Cannot cancel a completed handover');
    return this.prisma.runInTransaction(async (tx) => {
      const updated = await tx.cashierHandover.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record({ tenantId, eventType: 'CASHIER_HANDOVER_CANCELLED', entityType: 'CASHIER_HANDOVER', entityId: id, action: 'UPDATE', userId, newValues: {} }, tx);
      return updated;
    });
  }

  list(tenantId: string, membershipId: string, organizationId: string, cashDeskId: string) {
    return this.access.assertAccess(tenantId, membershipId, organizationId).then(() => this.prisma.cashierHandover.findMany({ where: { tenantId, cashDeskId }, orderBy: { handoverAt: 'desc' } }));
  }
}
