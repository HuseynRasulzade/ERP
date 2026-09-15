import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { CASH_DESK_TRANSFER_TYPE } from './cash-desk-transfer.repository';
import { CashMovementService } from './cash-movement.service';

/**
 * Posting handler for CashDeskTransfer (spec sections 33-37). Never a
 * customer/supplier settlement (spec section 33). No GL consequence for
 * the principal (same-currency cash relocation between two physical
 * desks) — matches `WarehouseTransferPostingHandler`'s own convention.
 * `INSTANT` posts both legs together; `TWO_STEP` posts only the source
 * OUTFLOW here — `CashDeskTransferService.receive` posts the destination
 * leg (possibly partial, spec section 37) later.
 */
@Injectable()
export class CashDeskTransferPostingHandler implements DocumentPostingHandler {
  readonly documentType = CASH_DESK_TRANSFER_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashMovements: CashMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.cashDeskTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    if (transfer.amount.lte(0)) throw new ValidationAppError('Cannot post a transfer with non-positive amount');
    if (transfer.sourceCashDeskId === transfer.destinationCashDeskId) throw new ValidationAppError('Source and destination cash desk must differ');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const transfer = await tx.cashDeskTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (!transfer) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = transfer.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(transfer.amount.toString());

    await this.cashMovements.record(tenantId, { organizationId, cashDeskId: transfer.sourceCashDeskId, currencyId: transfer.currencyId, direction: 'OUTFLOW', amount, baseAmount: amount, sourceDocumentType: CASH_DESK_TRANSFER_TYPE, sourceDocumentId: transfer.id, effectiveDate: businessDate }, tx);

    const isTwoStep = transfer.transferMode === 'TWO_STEP';
    if (!isTwoStep) {
      await this.cashMovements.record(tenantId, { organizationId, cashDeskId: transfer.destinationCashDeskId, currencyId: transfer.currencyId, direction: 'INFLOW', amount, baseAmount: amount, sourceDocumentType: CASH_DESK_TRANSFER_TYPE, sourceDocumentId: transfer.id, effectiveDate: businessDate }, tx);
      await tx.cashDeskTransfer.update({ where: { id: transfer.id }, data: { transferState: 'RECEIVED', receivedAmount: amount.toString() } });
    } else {
      await tx.cashDeskTransfer.update({ where: { id: transfer.id }, data: { transferState: 'IN_TRANSIT' } });
    }

    return null; // no GL consequence — see class doc
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const transfer = await tx.cashDeskTransfer.findFirst({ where: { id: document.id, tenantId } });
    if (transfer && ['PARTIALLY_RECEIVED', 'RECEIVED'].includes(transfer.transferState) && transfer.transferMode === 'TWO_STEP') {
      throw new ValidationAppError('Cannot unpost — the destination has already (partially) received this transfer.');
    }
    await this.cashMovements.reverse(tenantId, CASH_DESK_TRANSFER_TYPE, document.id, tx);
    await tx.cashDeskTransfer.update({ where: { id: document.id }, data: { transferState: 'DRAFT', receivedAmount: '0' } });
  }
}
