import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingEngine } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import {
  ConcurrencyConflictError,
  NotFoundAppError,
  TransferAlreadyReceivedError,
  TransferReceiveExceedsShippedError,
  ValidationAppError,
} from '../common/errors/app-error';
import { CASH_DESK_TRANSFER_TYPE } from './cash-desk-transfer.repository';
import { CASH_MOVEMENT_REGISTER } from './cash-balance.service';
import {
  CreateCashDeskTransferDto,
  ReceiveCashDeskTransferDto,
} from './dto/cash-desk.dto';

const SEQUENCE_PREFIX = 'CDT';

/**
 * CashDeskTransfer (docx spec Phase 15 section 8, "Cash-to-Cash
 * Transfer") — same INSTANT/TWO_STEP shape as WarehouseTransfer (Phase
 * 10), applied to two cash desks of the same tenant instead of two
 * warehouses. `create`/`get`/`list` behave like every other document; the
 * bespoke `receive` command (TWO_STEP only) is the forward-moving event
 * that finally lands the money in the destination desk — see
 * CashDeskTransferPostingHandler's own class doc for the accounting.
 */
@Injectable()
export class CashDeskTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly access: OrganizationAccessService,
    private readonly mappings: AccountingMappingService,
    private readonly accountingEngine: AccountingPostingEngine,
  ) {}

  list(tenantId: string, membershipId: string, organizationId: string) {
    return this.access
      .assertAccess(tenantId, membershipId, organizationId)
      .then(() =>
        this.prisma.cashDeskTransfer.findMany({
          where: { organizationId },
          orderBy: { createdAt: 'desc' },
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
    const row = await this.prisma.cashDeskTransfer.findFirst({
      where: { id, organizationId },
    });
    if (!row) throw new NotFoundAppError('CashDeskTransfer', id);
    return row;
  }

  async create(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    dto: CreateCashDeskTransferDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const businessDate = this.parseDate(dto.documentDate);
    if (dto.sourceCashboxId === dto.destinationCashboxId)
      throw new ValidationAppError(
        'Source and destination cash desk must differ',
      );

    const [source, destination] = await Promise.all([
      this.prisma.cashbox.findFirst({
        where: { id: dto.sourceCashboxId, organizationId },
      }),
      this.prisma.cashbox.findFirst({
        where: { id: dto.destinationCashboxId, organizationId },
      }),
    ]);
    if (!source)
      throw new ValidationAppError(
        'Source cash desk does not belong to this organization',
      );
    if (!destination)
      throw new ValidationAppError(
        'Destination cash desk does not belong to this organization',
      );
    if (!source.active)
      throw new ValidationAppError('Source cash desk is inactive');
    if (!destination.active)
      throw new ValidationAppError('Destination cash desk is inactive');

    const amount = new Decimal(dto.amount.toString());
    if (!amount.isFinite() || amount.lte(0))
      throw new ValidationAppError('Amount must be positive');

    await this.ensureSequence(tenantId);
    return this.prisma.runInTransaction(async (tx) => {
      const allocated = await this.numbering.allocateNumber(
        tenantId,
        CASH_DESK_TRANSFER_TYPE,
        businessDate,
        tx,
      );
      const created = await tx.cashDeskTransfer.create({
        data: {
          tenantId,
          organizationId,
          number: allocated.formatted,
          documentDate: businessDate,
          sourceCashboxId: dto.sourceCashboxId,
          destinationCashboxId: dto.destinationCashboxId,
          currencyId: dto.currencyId ?? source.currencyId,
          amount,
          transferMode: dto.transferMode ?? 'INSTANT',
          description: dto.description,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'CASH_DESK_TRANSFER_CREATED',
          entityType: CASH_DESK_TRANSFER_TYPE,
          entityId: created.id,
          action: 'CREATE',
          userId,
          newValues: { number: created.number, amount: amount.toString() },
        },
        tx,
      );

      return created;
    });
  }

  /**
   * Bespoke partial-capable receive command for a TWO_STEP transfer —
   * moves shipped-but-in-transit money at the destination desk from
   * CASH_IN_TRANSIT into its own book balance. Each call posts its own
   * distinct-`sourceDocumentId` journal entry (`${transfer.id}:RECEIVE:n`)
   * so repeated partial receives never collide with
   * AccountingPostingEngine.postBatch's per-document duplicate guard.
   */
  async receive(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    userId: string,
    id: string,
    dto: ReceiveCashDeskTransferDto,
  ) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    return this.prisma.runInTransaction(async (tx) => {
      const transfer = await tx.cashDeskTransfer.findFirst({
        where: { id, tenantId, organizationId },
      });
      if (!transfer) throw new NotFoundAppError('CashDeskTransfer', id);
      if (transfer.transferMode !== 'TWO_STEP')
        throw new ValidationAppError(
          'Only a TWO_STEP transfer supports a separate receive step',
        );
      if (transfer.postingStatus !== 'POSTED')
        throw new ValidationAppError(
          'Cannot receive a transfer that has not been shipped (posted) yet',
        );
      if (transfer.transferState === 'RECEIVED')
        throw new TransferAlreadyReceivedError();
      if (transfer.version !== dto.expectedVersion)
        throw new ConcurrencyConflictError();

      const shipped = new Decimal(transfer.amount.toString());
      const alreadyReceived = new Decimal(transfer.receivedAmount.toString());
      const remaining = shipped.minus(alreadyReceived);
      const qty =
        dto.amount !== undefined
          ? new Decimal(dto.amount.toString())
          : remaining;
      if (qty.lte(0))
        throw new ValidationAppError('Receive amount must be positive');
      if (qty.gt(remaining))
        throw new TransferReceiveExceedsShippedError(
          remaining.toFixed(2),
          qty.toFixed(2),
        );

      const businessDate = new Date();
      const existingCount = await tx.registerMovement.count({
        where: {
          tenantId,
          registerCode: CASH_MOVEMENT_REGISTER,
          recorderDocumentType: CASH_DESK_TRANSFER_TYPE,
          recorderDocumentId: transfer.id,
        },
      });
      await tx.registerMovement.create({
        data: {
          tenantId,
          registerCode: CASH_MOVEMENT_REGISTER,
          recorderDocumentType: CASH_DESK_TRANSFER_TYPE,
          recorderDocumentId: transfer.id,
          businessDate,
          movementType: 'CASH_DESK_TRANSFER_RECEIVE',
          dimensions: {
            organizationId,
            cashboxId: transfer.destinationCashboxId,
          },
          resources: {
            amount: qty.toString(),
            currencyId: transfer.currencyId,
            direction: 'RECEIPT',
          },
          sequence: BigInt(existingCount + 1),
        },
      });

      let currencyId = transfer.currencyId;
      if (!currencyId) {
        const org = await tx.organization.findUnique({
          where: { id: organizationId },
        });
        currencyId = org?.baseCurrencyId ?? null;
      }
      if (!currencyId)
        throw new ValidationAppError(
          'Cannot receive a cash desk transfer: no currency on the transfer or organization',
        );

      const cashAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.CASH,
        businessDate,
        tx,
      );
      const transitAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.CASH_IN_TRANSIT,
        businessDate,
        tx,
      );
      const destinationDimensions = [
        {
          dimensionCode: 'CASHBOX',
          referenceId: transfer.destinationCashboxId,
        },
        { dimensionCode: 'CURRENCY', referenceId: currencyId },
      ];

      const receiveCount = await tx.journalEntry.count({
        where: {
          tenantId,
          sourceDocumentType: CASH_DESK_TRANSFER_TYPE,
          sourceDocumentId: { startsWith: `${transfer.id}:RECEIVE:` },
        },
      });

      await this.accountingEngine.postBatch(
        tenantId,
        userId,
        {
          organizationId,
          businessDate,
          postingDate: businessDate,
          description: `Cash desk transfer ${transfer.number ?? transfer.id} — received`,
          operationType: 'SYSTEM_DOCUMENT',
          sourceDocumentType: CASH_DESK_TRANSFER_TYPE,
          sourceDocumentId: `${transfer.id}:RECEIVE:${receiveCount + 1}`,
          lines: [
            {
              accountId: cashAccount.id,
              side: 'DEBIT',
              amountBase: qty,
              description: `Cash desk transfer ${transfer.number ?? transfer.id} — received`,
              dimensions: destinationDimensions,
            },
            {
              accountId: transitAccount.id,
              side: 'CREDIT',
              amountBase: qty,
              description: `Cash desk transfer ${transfer.number ?? transfer.id} — out of transit`,
              dimensions: destinationDimensions,
            },
          ],
        },
        tx,
      );

      const newReceived = alreadyReceived.plus(qty);
      const fullyReceived = newReceived.gte(shipped);

      const updated = await tx.cashDeskTransfer.update({
        where: { id: transfer.id },
        data: {
          receivedAmount: newReceived,
          transferState: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          tenantId,
          eventType: 'CASH_DESK_TRANSFER_RECEIVED',
          entityType: CASH_DESK_TRANSFER_TYPE,
          entityId: transfer.id,
          action: 'UPDATE',
          userId,
          newValues: {
            transferState: updated.transferState,
            receivedAmount: newReceived.toString(),
          },
        },
        tx,
      );

      return updated;
    });
  }

  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new ValidationAppError('Invalid document date');
    return date;
  }

  private async ensureSequence(tenantId: string) {
    const existing = await this.prisma.numberSequence.findUnique({
      where: { tenantId_code: { tenantId, code: CASH_DESK_TRANSFER_TYPE } },
    });
    if (existing) return;
    try {
      await this.prisma.numberSequence.create({
        data: {
          tenantId,
          code: CASH_DESK_TRANSFER_TYPE,
          documentType: CASH_DESK_TRANSFER_TYPE,
          prefix: SEQUENCE_PREFIX,
          padding: 6,
          resetPolicy: 'YEARLY',
        },
      });
    } catch {
      // Lost the race to create the sequence for this tenant — fine.
    }
  }
}
