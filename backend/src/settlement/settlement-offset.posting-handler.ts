import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { SETTLEMENT_OFFSET_TYPE } from './settlement-offset.repository';
import { OpenItemService, OpenItemType } from './open-item.service';
import { SettlementMovementService } from './settlement-movement.service';

/**
 * Posting handler for SettlementOffset (spec sections 41-44, 158) —
 * nets a customer receivable against a supplier payable for the SAME
 * counterparty. Cross-counterparty offset is not representable by this
 * document at all (its own `counterpartyId` is singular, spec section
 * 43's default block enforced by construction, not a runtime check).
 */
@Injectable()
export class SettlementOffsetPostingHandler implements DocumentPostingHandler {
  readonly documentType = SETTLEMENT_OFFSET_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly openItems: OpenItemService,
    private readonly movements: SettlementMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const offset = await tx.settlementOffset.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!offset) throw new ValidationAppError('Document disappeared during posting');
    if (offset.lines.length === 0) throw new ValidationAppError('Cannot post an offset with no lines');
    const receivableTotal = offset.lines.filter((l) => l.side === 'RECEIVABLE').reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    const payableTotal = offset.lines.filter((l) => l.side === 'PAYABLE').reduce((s, l) => s.plus(l.amount.toString()), new Decimal(0));
    if (!receivableTotal.equals(payableTotal)) throw new ValidationAppError('Offset receivable and payable lines must total the same amount');
    if (!receivableTotal.equals(offset.amount.toString())) throw new ValidationAppError('Offset line totals must equal the document amount');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const offset = await tx.settlementOffset.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!offset) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = offset.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    for (const line of offset.lines) {
      const type: OpenItemType = line.side === 'RECEIVABLE' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
      const amount = new Decimal(line.amount.toString());
      await this.openItems.applyToOpenItem(tenantId, type, line.openItemId, amount, tx);
      const item = type === 'SETTLEMENT_OBLIGATION' ? await tx.settlementObligation.findUniqueOrThrow({ where: { id: line.openItemId } }) : await tx.supplierPayable.findUniqueOrThrow({ where: { id: line.openItemId } });
      await this.movements.record(
        tenantId,
        {
          organizationId,
          counterpartyId: offset.counterpartyId,
          counterpartyRole: line.side === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER',
          settlementDocumentType: item.sourceDocumentType,
          settlementDocumentId: line.openItemId,
          currencyId: offset.currencyId,
          transactionCurrencyAmount: line.side === 'RECEIVABLE' ? amount.negated() : amount,
          baseCurrencyAmount: line.side === 'RECEIVABLE' ? amount.negated() : amount,
          movementType: 'OFFSET',
          sourceDocumentType: SETTLEMENT_OFFSET_TYPE,
          sourceDocumentId: offset.id,
          effectiveDate: businessDate,
        },
        tx,
      );
    }

    const receivable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, businessDate, tx).catch(() => null);
    const payable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, businessDate, tx).catch(() => null);
    if (!receivable || !payable) return null;

    const dims = [{ dimensionCode: 'PARTNER', referenceId: offset.counterpartyId }, { dimensionCode: 'COUNTERPARTY', referenceId: offset.counterpartyId }, { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: offset.id }, { dimensionCode: 'CURRENCY', referenceId: offset.currencyId }];
    return {
      description: `Settlement offset ${offset.number ?? offset.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines: [
        { accountId: payable.id, side: 'DEBIT', amountBase: new Decimal(offset.amount.toString()), description: 'Payable settled by offset', dimensions: dims },
        { accountId: receivable.id, side: 'CREDIT', amountBase: new Decimal(offset.amount.toString()), description: 'Receivable settled by offset', dimensions: dims },
      ],
    };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const offset = await tx.settlementOffset.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!offset) return;
    for (const line of offset.lines) {
      const type: OpenItemType = line.side === 'RECEIVABLE' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
      await this.openItems.unapplyFromOpenItem(tenantId, type, line.openItemId, new Decimal(line.amount.toString()), tx);
    }
    await this.movements.reverse(tenantId, SETTLEMENT_OFFSET_TYPE, document.id, document.postedBy ?? undefined, tx);
  }
}
