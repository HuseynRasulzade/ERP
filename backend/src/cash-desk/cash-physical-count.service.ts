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
import {
  CashCountLineDto,
  StartCashPhysicalCountDto,
  SubmitCashPhysicalCountDto,
} from './dto/cash-desk.dto';

/**
 * CashPhysicalCount (docx spec Phase 15, "Denomination Count") — a
 * counting session against one cash desk. `start` snapshots the live book
 * balance (CashBalanceService, never a mutable field — same principle as
 * every other balance in this build); `submitLines` records the counted
 * denominations and derives physicalBalance/difference from them, never
 * from a typed-in total (spec: the physical total must always foot from
 * its own denomination lines).
 *
 * BLIND vs OPEN (`countMethod`) is stored as recorded, but this build does
 * not withhold `bookBalance` from the API response during a BLIND session
 * — hiding it is a client-side/UI concern, not a data-model one, and is
 * disclosed as a simplification in docs/CASH_DESK.md.
 */
@Injectable()
export class CashPhysicalCountService {
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
        this.prisma.cashPhysicalCount.findMany({
          where: { organizationId, ...(cashboxId ? { cashboxId } : {}) },
          orderBy: { countTimestamp: 'desc' },
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
    const row = await this.prisma.cashPhysicalCount.findFirst({
      where: { id, organizationId },
      include: { lines: true },
    });
    if (!row) throw new NotFoundAppError('CashPhysicalCount', id);
    return row;
  }

  async start(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: StartCashPhysicalCountDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const cashbox = await this.prisma.cashbox.findFirst({
      where: { id: dto.cashboxId, organizationId },
    });
    if (!cashbox)
      throw new ValidationAppError(
        'Cashbox does not belong to this organization',
      );

    const bookBalance = await this.cashBalance.getBookBalance(
      tenantId,
      dto.cashboxId,
      new Date(),
    );

    const created = await this.prisma.cashPhysicalCount.create({
      data: {
        tenantId,
        organizationId,
        cashboxId: dto.cashboxId,
        cashierId: dto.cashierId,
        bookBalance,
        countMethod: dto.countMethod ?? 'OPEN',
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'CASH_PHYSICAL_COUNT_STARTED',
      entityType: 'CashPhysicalCount',
      entityId: created.id,
      action: 'CREATE',
      userId,
      newValues: {
        cashboxId: dto.cashboxId,
        bookBalance: bookBalance.toString(),
      },
    });
    return created;
  }

  async submitLines(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: SubmitCashPhysicalCountDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.cashPhysicalCount.findFirst({
      where: { id, organizationId },
    });
    if (!count) throw new NotFoundAppError('CashPhysicalCount', id);
    if (count.status !== 'DRAFT')
      throw new ValidationAppError(
        'Only a DRAFT physical count can have its lines submitted',
      );
    if (count.version !== dto.expectedVersion)
      throw new ConcurrencyConflictError();

    const seen = new Set<string>();
    for (const line of dto.lines) {
      const key = new Decimal(line.faceValue.toString()).toFixed(2);
      if (seen.has(key))
        throw new ValidationAppError(
          `Duplicate face value ${key} in submitted lines`,
        );
      seen.add(key);
    }

    const physicalBalance = dto.lines.reduce(
      (sum, line) => sum.plus(this.lineSubtotal(line)),
      new Decimal(0),
    );
    const difference = physicalBalance.minus(
      new Decimal(count.bookBalance.toString()),
    );

    return this.prisma.runInTransaction(async (tx) => {
      await tx.cashDenominationCountLine.deleteMany({ where: { countId: id } });
      for (const line of dto.lines) {
        if (line.quantity === 0) continue;
        await tx.cashDenominationCountLine.create({
          data: {
            tenantId,
            countId: id,
            faceValue: new Decimal(line.faceValue.toString()),
            quantity: line.quantity,
            subtotal: this.lineSubtotal(line),
          },
        });
      }

      const result = await tx.cashPhysicalCount.updateMany({
        where: { id, organizationId, version: dto.expectedVersion },
        data: {
          physicalBalance,
          difference,
          status: 'SUBMITTED',
          notes: dto.notes,
          updatedBy: userId,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw new ConcurrencyConflictError();

      await this.audit.record(
        {
          tenantId,
          eventType: 'CASH_PHYSICAL_COUNT_SUBMITTED',
          entityType: 'CashPhysicalCount',
          entityId: id,
          action: 'UPDATE',
          userId,
          newValues: {
            physicalBalance: physicalBalance.toString(),
            difference: difference.toString(),
          },
        },
        tx,
      );

      return tx.cashPhysicalCount.findFirst({
        where: { id },
        include: { lines: true },
      });
    });
  }

  async approve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    return this.decide(
      tenantId,
      membershipId,
      organizationId,
      userId,
      id,
      expectedVersion,
      'APPROVED',
    );
  }

  async reject(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
  ) {
    return this.decide(
      tenantId,
      membershipId,
      organizationId,
      userId,
      id,
      expectedVersion,
      'REJECTED',
    );
  }

  private async decide(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    expectedVersion: number,
    status: 'APPROVED' | 'REJECTED',
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const count = await this.prisma.cashPhysicalCount.findFirst({
      where: { id, organizationId },
    });
    if (!count) throw new NotFoundAppError('CashPhysicalCount', id);
    if (count.status !== 'SUBMITTED')
      throw new ValidationAppError(
        'Only a SUBMITTED physical count can be approved or rejected',
      );

    const result = await this.prisma.cashPhysicalCount.updateMany({
      where: { id, organizationId, version: expectedVersion },
      data: {
        status,
        approvedBy: userId,
        approvedAt: new Date(),
        updatedBy: userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConcurrencyConflictError();

    await this.audit.record({
      tenantId,
      eventType: `CASH_PHYSICAL_COUNT_${status}`,
      entityType: 'CashPhysicalCount',
      entityId: id,
      action: 'UPDATE',
      userId,
    });
    return this.prisma.cashPhysicalCount.findFirst({
      where: { id },
      include: { lines: true },
    });
  }

  private lineSubtotal(line: CashCountLineDto): Decimal {
    return new Decimal(line.faceValue.toString()).times(line.quantity);
  }
}
