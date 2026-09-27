import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PrismaService,
  PrismaTransactionClient,
} from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import {
  TransferUnpostBlockedError,
  ValidationAppError,
} from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CASH_DESK_TRANSFER_TYPE } from './cash-desk-transfer.repository';
import {
  CashBalanceService,
  CASH_MOVEMENT_REGISTER,
} from './cash-balance.service';

/**
 * Posting handler for CashDeskTransfer (docx spec Phase 15 section 8,
 * "Cash-to-Cash Transfer") — mirrors WarehouseTransfer's own INSTANT/
 * TWO_STEP pattern (spec sections 11-13 there), applied to cash instead
 * of stock.
 *
 * INSTANT: posting IS the whole transfer — Dr destination cash desk /
 * Cr source cash desk, both cash-desk balances move in the same
 * transaction, transferState goes straight to RECEIVED (see
 * CashDeskTransferRepository.applyStatusPatch).
 *
 * TWO_STEP: posting only ships — Cr source cash desk / Dr CASH_IN_TRANSIT
 * (account 222), transferState goes to IN_TRANSIT. The money is out of the
 * source desk's own book balance but not yet in the destination desk's —
 * exactly the bank-side "in transit" idea (spec section 36), just on cash.
 * The bespoke `receive()` action (CashDeskTransferService.receive) later
 * posts the mirror entry — Dr destination cash desk / Cr CASH_IN_TRANSIT —
 * using a distinct `sourceDocumentId` (`${transfer.id}:RECEIVE`) so it
 * never collides with this handler's own journal entry under
 * AccountingPostingEngine.postBatch's per-document duplicate guard.
 */
@Injectable()
export class CashDeskTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = CASH_DESK_TRANSFER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly cashBalance: CashBalanceService,
  ) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const transfer = await tx.cashDeskTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!transfer)
      throw new ValidationAppError('Document disappeared during posting');
    if (transfer.sourceCashboxId === transfer.destinationCashboxId)
      throw new ValidationAppError(
        'Source and destination cash desk must differ',
      );
    if (transfer.amount.lte(0))
      throw new ValidationAppError(
        'Cannot post a cash desk transfer with a non-positive amount',
      );

    const [source, destination] = await Promise.all([
      tx.cashbox.findFirst({
        where: { id: transfer.sourceCashboxId, tenantId },
      }),
      tx.cashbox.findFirst({
        where: { id: transfer.destinationCashboxId, tenantId },
      }),
    ]);
    if (!source || !source.active)
      throw new ValidationAppError(
        'Cannot post a transfer from a missing or inactive cash desk',
      );
    if (!destination || !destination.active)
      throw new ValidationAppError(
        'Cannot post a transfer to a missing or inactive cash desk',
      );

    if (source.negativeBalancePolicy === 'NEVER') {
      await this.cashBalance.lockCashbox(
        tenantId,
        transfer.sourceCashboxId,
        tx,
      );
      const current = await this.cashBalance.getBookBalance(
        tenantId,
        transfer.sourceCashboxId,
        new Date(),
        tx,
      );
      const amount = new Decimal(transfer.amount.toString());
      if (current.minus(amount).lt(0)) {
        throw new ValidationAppError(
          `Cash desk ${source.code} has only ${current.toFixed(2)} available; transfer of ${amount.toFixed(2)} cannot be posted`,
        );
      }
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const transfer = await tx.cashDeskTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!transfer)
      throw new ValidationAppError('Document disappeared during posting');
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = transfer.amount.toString();

    const movements: RegisterMovementInput[] = [
      {
        registerCode: CASH_MOVEMENT_REGISTER,
        businessDate,
        movementType: 'CASH_DESK_TRANSFER_OUT',
        dimensions: {
          organizationId: transfer.organizationId,
          cashboxId: transfer.sourceCashboxId,
        },
        resources: {
          amount,
          currencyId: transfer.currencyId,
          direction: 'PAYMENT',
        },
      },
    ];

    // TWO_STEP only debits the source at post time — the destination is
    // credited later by receive(), once the cash physically arrives.
    if (transfer.transferMode !== 'TWO_STEP') {
      movements.push({
        registerCode: CASH_MOVEMENT_REGISTER,
        businessDate,
        movementType: 'CASH_DESK_TRANSFER_IN',
        dimensions: {
          organizationId: transfer.organizationId,
          cashboxId: transfer.destinationCashboxId,
        },
        resources: {
          amount,
          currencyId: transfer.currencyId,
          direction: 'RECEIPT',
        },
      });
    }

    return movements;
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const transfer = await tx.cashDeskTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (!transfer)
      throw new ValidationAppError('Document disappeared during posting');
    const organizationId = transfer.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(transfer.amount.toString());

    let currencyId = transfer.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
      });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId)
      throw new ValidationAppError(
        'Cannot post a cash desk transfer: no currency on the transfer, organization, or tenant',
      );

    const cashAccount = await this.mappings.resolve(
      tenantId,
      organizationId,
      MappingKeys.CASH,
      businessDate,
      tx,
    );
    const sourceDimensions = [
      { dimensionCode: 'CASHBOX', referenceId: transfer.sourceCashboxId },
      { dimensionCode: 'CURRENCY', referenceId: currencyId },
    ];
    const destinationDimensions = [
      { dimensionCode: 'CASHBOX', referenceId: transfer.destinationCashboxId },
      { dimensionCode: 'CURRENCY', referenceId: currencyId },
    ];

    let lines: AccountingPostingLineInput[];
    if (transfer.transferMode === 'TWO_STEP') {
      const transitAccount = await this.mappings.resolve(
        tenantId,
        organizationId,
        MappingKeys.CASH_IN_TRANSIT,
        businessDate,
        tx,
      );
      lines = [
        {
          accountId: transitAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Cash desk transfer ${transfer.number ?? transfer.id} — in transit`,
          dimensions: destinationDimensions,
        },
        {
          accountId: cashAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Cash desk transfer ${transfer.number ?? transfer.id} — shipped`,
          dimensions: sourceDimensions,
        },
      ];
    } else {
      lines = [
        {
          accountId: cashAccount.id,
          side: 'DEBIT',
          amountBase: amount,
          description: `Cash desk transfer ${transfer.number ?? transfer.id} — received`,
          dimensions: destinationDimensions,
        },
        {
          accountId: cashAccount.id,
          side: 'CREDIT',
          amountBase: amount,
          description: `Cash desk transfer ${transfer.number ?? transfer.id} — sent`,
          dimensions: sourceDimensions,
        },
      ];
    }

    return {
      description: `Cash desk transfer ${transfer.number ?? transfer.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }

  async undoSideEffects(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const transfer = await tx.cashDeskTransfer.findFirst({
      where: { id: document.id, tenantId },
    });
    if (
      transfer &&
      (transfer.transferState === 'PARTIALLY_RECEIVED' ||
        transfer.transferState === 'RECEIVED') &&
      transfer.transferMode === 'TWO_STEP'
    ) {
      throw new TransferUnpostBlockedError(
        transfer.transferState === 'RECEIVED'
          ? 'Cannot unpost a cash desk transfer that has already been fully received'
          : 'Cannot unpost a cash desk transfer that has already been partially received',
      );
    }
  }
}
