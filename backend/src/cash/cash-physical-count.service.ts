import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { ValidationAppError } from '../common/errors/app-error';
import { CashMovementService } from './cash-movement.service';

/**
 * CashPhysicalCountService + CashDenominationService combined (spec
 * sections 48-52). The physical total is ALWAYS `Σ(denomination × quantity)`
 * when denomination lines are given (spec section 50) — a manual total is
 * only a configurable fallback for a count with no denomination lines.
 * Blind mode (spec section 51) simply omits `bookBalance` from what's
 * returned to the counter; the difference is still computed and stored,
 * only hidden from THAT caller's own response.
 */
@Injectable()
export class CashPhysicalCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly cashMovements: CashMovementService,
  ) {}

  async count(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: { cashDeskId: string; cashierId?: string; currencyId: string; denominations?: { value: number; quantity: number }[]; manualTotal?: number; blind?: boolean; notes?: string },
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const bookBalance = await this.cashMovements.getBalance(tenantId, dto.cashDeskId, dto.currencyId);

    let physicalBalance: Decimal;
    if (dto.denominations && dto.denominations.length > 0) {
      physicalBalance = dto.denominations.reduce((s, d) => s.plus(new Decimal(d.value).mul(d.quantity)), new Decimal(0));
    } else if (dto.manualTotal != null) {
      physicalBalance = new Decimal(dto.manualTotal);
    } else {
      throw new ValidationAppError('Either denomination lines or a manual total is required for a physical count');
    }

    const difference = physicalBalance.minus(bookBalance);

    return this.prisma.runInTransaction(async (tx) => {
      const count = await tx.cashPhysicalCount.create({
        data: { tenantId, cashDeskId: dto.cashDeskId, cashierId: dto.cashierId, currencyId: dto.currencyId, bookBalance: bookBalance.toString(), physicalBalance: physicalBalance.toString(), difference: difference.toString(), countMethod: dto.denominations ? 'DENOMINATION' : 'MANUAL_TOTAL', blind: dto.blind ?? false, notes: dto.notes },
      });

      if (dto.denominations && dto.denominations.length > 0) {
        const denomCount = await tx.cashDenominationCount.create({ data: { tenantId, cashDeskId: dto.cashDeskId, currencyId: dto.currencyId, countDate: new Date(), countedBy: userId, physicalCountId: count.id } });
        for (const d of dto.denominations) {
          await tx.cashDenominationCountLine.create({ data: { tenantId, countId: denomCount.id, denominationValue: d.value.toString(), quantity: d.quantity, totalAmount: new Decimal(d.value).mul(d.quantity).toString() } });
        }
      }

      await this.audit.record({ tenantId, eventType: 'CASH_PHYSICAL_COUNT_COMPLETED', entityType: 'CASH_PHYSICAL_COUNT', entityId: count.id, action: 'CREATE', userId, newValues: { bookBalance: bookBalance.toString(), physicalBalance: physicalBalance.toString(), difference: difference.toString() } }, tx);

      if (!difference.abs().lte('0.01')) {
        await this.audit.record({ tenantId, eventType: difference.gt(0) ? 'CASH_SURPLUS_DETECTED' : 'CASH_SHORTAGE_DETECTED', entityType: 'CASH_PHYSICAL_COUNT', entityId: count.id, action: 'CREATE', userId, newValues: { difference: difference.toString() } }, tx);
      }

      return dto.blind ? { ...count, bookBalance: undefined } : count;
    });
  }

  async listDenominationMaster(tenantId: string, currencyId: string) {
    return this.prisma.currencyDenomination.findMany({ where: { tenantId, currencyId, active: true }, orderBy: { value: 'desc' } });
  }

  async seedDenominationMaster(tenantId: string, currencyId: string, values: number[]) {
    return Promise.all(values.map((v) => this.prisma.currencyDenomination.upsert({ where: { tenantId_currencyId_value: { tenantId, currencyId, value: v.toString() } }, create: { tenantId, currencyId, value: v.toString() }, update: {} })));
  }
}
