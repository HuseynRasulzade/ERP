import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { DEBT_ADJUSTMENT_TYPE } from './debt-adjustment.repository';
import { OpenItemService, OpenItemType } from './open-item.service';
import { SettlementMovementService } from './settlement-movement.service';

/**
 * Posting handler for DebtAdjustment (spec sections 38-40, 45-46, 96-97)
 * — the universal settlement correction document. `operationType`
 * dispatches to the right open-item effect; GL always resolves through
 * `AccountingMappingService` (spec section 45: "Account-lar hard-coded
 * olmamalıdır"), falling back to `OTHER_OPERATING_EXPENSE`/`INCOME` for
 * bad-debt/write-off legs since this build has no dedicated
 * `BAD_DEBT_EXPENSE` mapping key yet (disclosed simplification).
 * `COUNTERPARTY_TRANSFER` is blocked outright (spec section 97's own
 * default) — no special "controlled" path is built in this pass.
 */
@Injectable()
export class DebtAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = DEBT_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly openItems: OpenItemService,
    private readonly movements: SettlementMovementService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adj = await tx.debtAdjustment.findFirst({ where: { id: document.id, tenantId } });
    if (!adj) throw new ValidationAppError('Document disappeared during posting');
    if (adj.amount.lte(0)) throw new ValidationAppError('Cannot post a debt adjustment with non-positive amount');
    if (adj.operationType === 'COUNTERPARTY_TRANSFER') throw new ValidationAppError('Counterparty transfer is disabled by default — a controlled DebtTransfer procedure with special approval is required (spec section 97), not yet implemented.');
    if (['RECEIVABLE_DECREASE', 'PAYABLE_DECREASE', 'DEBT_WRITE_OFF', 'CREDIT_RECLASSIFICATION', 'CONTRACT_TRANSFER'].includes(adj.operationType) && !adj.targetOpenItemId) {
      throw new ValidationAppError(`Operation ${adj.operationType} requires a target open item`);
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const adj = await tx.debtAdjustment.findFirst({ where: { id: document.id, tenantId } });
    if (!adj) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = adj.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(adj.amount.toString());
    const isCustomer = adj.counterpartyRole === 'CUSTOMER';
    const openItemType: OpenItemType = isCustomer ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
    const dims = [{ dimensionCode: 'PARTNER', referenceId: adj.counterpartyId }, { dimensionCode: 'COUNTERPARTY', referenceId: adj.counterpartyId }, { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: adj.id }, { dimensionCode: 'CURRENCY', referenceId: adj.currencyId }];

    const receivableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, businessDate, tx).catch(() => null);
    const payableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, businessDate, tx).catch(() => null);
    const expenseAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx).catch(() => null);
    const incomeAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_INCOME, businessDate, tx).catch(() => null);
    const openItemAccount = isCustomer ? receivableAccount : payableAccount;

    switch (adj.operationType) {
      case 'RECEIVABLE_INCREASE':
      case 'PAYABLE_INCREASE': {
        const create = isCustomer ? this.openItems.createReceivable.bind(this.openItems) : this.openItems.createPayable.bind(this.openItems);
        const item = await create(tenantId, { organizationId, counterpartyId: adj.counterpartyId, contractId: adj.contractId, sourceDocumentType: DEBT_ADJUSTMENT_TYPE, sourceDocumentId: adj.id, currencyId: adj.currencyId, amount, baseCurrencyAmount: amount, dueDate: businessDate, effectiveDate: businessDate }, tx);
        if (!openItemAccount || (isCustomer ? !incomeAccount : !expenseAccount)) return null;
        return isCustomer
          ? { description: `Debit note ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: openItemAccount.id, side: 'DEBIT', amountBase: amount, description: 'Debit note', dimensions: dims }, { accountId: incomeAccount!.id, side: 'CREDIT', amountBase: amount, description: 'Debit note income', dimensions: dims }] }
          : { description: `Debit note ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: expenseAccount!.id, side: 'DEBIT', amountBase: amount, description: 'Additional charge from supplier', dimensions: dims }, { accountId: openItemAccount.id, side: 'CREDIT', amountBase: amount, description: 'Payable increase', dimensions: dims }] };
      }

      case 'RECEIVABLE_DECREASE':
      case 'PAYABLE_DECREASE':
      case 'DEBT_WRITE_OFF': {
        await this.openItems.applyToOpenItem(tenantId, openItemType, adj.targetOpenItemId!, amount, tx);
        const item = openItemType === 'SETTLEMENT_OBLIGATION' ? await tx.settlementObligation.findUniqueOrThrow({ where: { id: adj.targetOpenItemId! } }) : await tx.supplierPayable.findUniqueOrThrow({ where: { id: adj.targetOpenItemId! } });
        await this.movements.record(tenantId, { organizationId, counterpartyId: adj.counterpartyId, counterpartyRole: adj.counterpartyRole as 'CUSTOMER' | 'SUPPLIER', settlementDocumentType: item.sourceDocumentType, settlementDocumentId: adj.targetOpenItemId!, currencyId: adj.currencyId, transactionCurrencyAmount: isCustomer ? amount.negated() : amount, baseCurrencyAmount: isCustomer ? amount.negated() : amount, movementType: adj.operationType === 'DEBT_WRITE_OFF' ? 'WRITE_OFF' : isCustomer ? 'CREDIT_NOTE' : 'DEBIT_NOTE', sourceDocumentType: DEBT_ADJUSTMENT_TYPE, sourceDocumentId: adj.id, effectiveDate: businessDate }, tx);

        if (!openItemAccount) return null;
        const counterAccountForWriteOff = isCustomer ? expenseAccount : incomeAccount; // Dr Bad Debt Expense / Cr AR ; supplier credit write-off is Dr AP / Cr Other Income
        const counterAccount = adj.operationType === 'DEBT_WRITE_OFF' ? counterAccountForWriteOff : isCustomer ? expenseAccount : incomeAccount;
        if (!counterAccount) return null;
        return isCustomer
          ? { description: `${adj.operationType} ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: counterAccount.id, side: 'DEBIT', amountBase: amount, description: adj.operationType, dimensions: dims }, { accountId: openItemAccount.id, side: 'CREDIT', amountBase: amount, description: 'Receivable decrease', dimensions: dims }] }
          : { description: `${adj.operationType} ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: openItemAccount.id, side: 'DEBIT', amountBase: amount, description: 'Payable decrease', dimensions: dims }, { accountId: counterAccount.id, side: 'CREDIT', amountBase: amount, description: adj.operationType, dimensions: dims }] };
      }

      case 'CREDIT_RECLASSIFICATION':
      case 'CONTRACT_TRANSFER': {
        // Non-financial: moves the open item to a different contract —
        // no accounting consequence (spec section 96).
        if (openItemType === 'SETTLEMENT_OBLIGATION') await tx.settlementObligation.update({ where: { id: adj.targetOpenItemId! }, data: { contractId: adj.targetContractId ?? adj.contractId } });
        else await tx.supplierPayable.update({ where: { id: adj.targetOpenItemId! }, data: { contractId: adj.targetContractId ?? adj.contractId } });
        return null;
      }

      default:
        return null;
    }
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adj = await tx.debtAdjustment.findFirst({ where: { id: document.id, tenantId } });
    if (!adj) return;
    if (['RECEIVABLE_DECREASE', 'PAYABLE_DECREASE', 'DEBT_WRITE_OFF'].includes(adj.operationType) && adj.targetOpenItemId) {
      const type: OpenItemType = adj.counterpartyRole === 'CUSTOMER' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
      await this.openItems.unapplyFromOpenItem(tenantId, type, adj.targetOpenItemId, new Decimal(adj.amount.toString()), tx);
    }
    if (['RECEIVABLE_INCREASE', 'PAYABLE_INCREASE'].includes(adj.operationType)) {
      const type: OpenItemType = adj.counterpartyRole === 'CUSTOMER' ? 'SETTLEMENT_OBLIGATION' : 'SUPPLIER_PAYABLE';
      if (type === 'SETTLEMENT_OBLIGATION') {
        const existing = await tx.settlementObligation.findFirst({ where: { tenantId, sourceDocumentType: DEBT_ADJUSTMENT_TYPE, sourceDocumentId: document.id } });
        if (existing && existing.allocatedAmount.gt(0)) throw new ValidationAppError('Cannot unpost — this open item has already been (partially) settled');
        await tx.settlementObligation.deleteMany({ where: { tenantId, sourceDocumentType: DEBT_ADJUSTMENT_TYPE, sourceDocumentId: document.id } });
      } else {
        const existing = await tx.supplierPayable.findFirst({ where: { tenantId, sourceDocumentType: DEBT_ADJUSTMENT_TYPE, sourceDocumentId: document.id } });
        if (existing && existing.paidAmount.gt(0)) throw new ValidationAppError('Cannot unpost — this open item has already been (partially) settled');
        await tx.supplierPayable.deleteMany({ where: { tenantId, sourceDocumentType: DEBT_ADJUSTMENT_TYPE, sourceDocumentId: document.id } });
      }
    }
    await this.movements.reverse(tenantId, DEBT_ADJUSTMENT_TYPE, document.id, document.postedBy ?? undefined, tx);
  }
}
