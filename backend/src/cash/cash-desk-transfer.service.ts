import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { NotFoundAppError, ValidationAppError } from '../common/errors/app-error';
import { CASH_DESK_TRANSFER_TYPE } from './cash-desk-transfer.repository';
import { CashMovementService } from './cash-movement.service';

const SEQUENCE_PREFIX = 'CDT';

@Injectable()
export class CashDeskTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly cashMovements: CashMovementService,
  ) {}

  async create(tenantId: string, membershipId: string, organizationId: string, userId: string, dto: { sourceCashDeskId: string; destinationCashDeskId: string; currencyId: string; amount: number; transferMode?: string; documentDate: string }) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const documentDate = this.parseDate(dto.documentDate);
    await this.ensureSequence(tenantId);

    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(tenantId, CASH_DESK_TRANSFER_TYPE, documentDate, tx);
      const row = await tx.cashDeskTransfer.create({
        data: { tenantId, organizationId, sourceCashDeskId: dto.sourceCashDeskId, destinationCashDeskId: dto.destinationCashDeskId, currencyId: dto.currencyId, amount: dto.amount.toString(), transferMode: dto.transferMode ?? 'INSTANT', number: allocated.formatted, documentDate, createdBy: userId, updatedBy: userId },
      });
      await this.audit.record({ tenantId, eventType: 'CASH_TRANSFER_INITIATED', entityType: CASH_DESK_TRANSFER_TYPE, entityId: row.id, action: 'CREATE', userId, newValues: { amount: dto.amount } }, tx);
      return row;
    });
  }

  /** Completes (possibly partially, spec section 37) a TWO_STEP
   * transfer's destination leg. Any shortfall between `amount` and what's
   * actually received stays visible as an investigation item, never
   * silently absorbed. */
  async receive(tenantId: string, membershipId: string, organizationId: string, userId: string, id: string, receivedAmount: number) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const transfer = await this.prisma.cashDeskTransfer.findFirst({ where: { id, tenantId, organizationId } });
    if (!transfer) throw new NotFoundAppError('CashDeskTransfer', id);
    if (transfer.transferMode !== 'TWO_STEP') throw new ValidationAppError('receive only applies to a TWO_STEP transfer');
    if (!['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(transfer.transferState)) throw new ValidationAppError(`Cannot receive — transfer is in state ${transfer.transferState}`);

    const already = new Decimal(transfer.receivedAmount.toString());
    const total = new Decimal(transfer.amount.toString());
    const thisReceipt = new Decimal(receivedAmount);
    if (already.plus(thisReceipt).gt(total.plus('0.01'))) throw new ValidationAppError(`Received amount would exceed the transferred total of ${total.toString()}.`);

    return this.prisma.runInTransaction(async (tx) => {
      await this.cashMovements.record(tenantId, { organizationId, cashDeskId: transfer.destinationCashDeskId, currencyId: transfer.currencyId, direction: 'INFLOW', amount: thisReceipt, baseAmount: thisReceipt, sourceDocumentType: CASH_DESK_TRANSFER_TYPE, sourceDocumentId: transfer.id, effectiveDate: new Date() }, tx);
      const newReceived = already.plus(thisReceipt);
      const fullyReceived = newReceived.gte(total.minus('0.01'));
      const updated = await tx.cashDeskTransfer.update({ where: { id }, data: { receivedAmount: newReceived.toString(), transferState: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
      await this.audit.record({ tenantId, eventType: 'CASH_TRANSFER_RECEIVED', entityType: CASH_DESK_TRANSFER_TYPE, entityId: id, action: 'UPDATE', userId, newValues: { receivedAmount: newReceived.toString(), shortfall: total.minus(newReceived).toString() } }, tx);
      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: CASH_DESK_TRANSFER_TYPE } } });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({ data: { tenantId, code: CASH_DESK_TRANSFER_TYPE, documentType: CASH_DESK_TRANSFER_TYPE, prefix: SEQUENCE_PREFIX, padding: 6, resetPolicy: 'YEARLY' } });
    } catch {
      // Lost the race — fine.
    }
  }
}
