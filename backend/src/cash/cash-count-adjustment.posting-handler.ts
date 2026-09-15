import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CASH_COUNT_ADJUSTMENT_TYPE } from './cash-count-adjustment.repository';
import { CashMovementService } from './cash-movement.service';
import { AccountablePersonService } from './accountable-person.service';

/**
 * Posting handler for CashCountAdjustment (spec sections 53-54) —
 * resolves a physical-count difference (or a standalone correction) into
 * the cash register and, where the type has a clear GL meaning, into the
 * ledger. `adjustmentType` dispatches:
 *  - CASH_SURPLUS: extra cash found — cash INFLOW, Dr Cash / Cr CASH_SURPLUS
 *    (falls back to OTHER_OPERATING_INCOME if unmapped).
 *  - CASH_SHORTAGE: cash missing — cash OUTFLOW, Dr CASH_SHORTAGE / Cr Cash
 *    (falls back to OTHER_OPERATING_EXPENSE if unmapped).
 *  - CASHIER_RECEIVABLE: shortage charged to a specific cashier/employee
 *    instead of written off — cash OUTFLOW plus an AccountablePersonMovement
 *    (ISSUE-shaped) rather than an expense leg; GL uses SUPPLIER_ADVANCE as
 *    a stand-in for "accountable person receivable" (disclosed
 *    simplification — no dedicated mapping key exists yet, matches the
 *    same simplification already used in SettlementPaymentPostingHandler
 *    for employee advances).
 *  - DOCUMENT_CORRECTION / OTHER: a manual correction with no fixed GL
 *    shape — posts the cash register movement only; any ledger entry for
 *    these two is expected to be recorded through a separate manual
 *    journal entry (disclosed simplification, spec doesn't prescribe a
 *    fixed account for either).
 */
@Injectable()
export class CashCountAdjustmentPostingHandler implements DocumentPostingHandler {
  readonly documentType = CASH_COUNT_ADJUSTMENT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly cashMovements: CashMovementService,
    private readonly accountablePersons: AccountablePersonService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adj = await tx.cashCountAdjustment.findFirst({ where: { id: document.id, tenantId } });
    if (!adj) throw new ValidationAppError('Document disappeared during posting');
    if (adj.amount.lte(0)) throw new ValidationAppError('Cannot post a cash count adjustment with non-positive amount');
    if (adj.adjustmentType === 'CASHIER_RECEIVABLE' && !adj.employeeId) throw new ValidationAppError('CASHIER_RECEIVABLE requires an employeeId');
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const adj = await tx.cashCountAdjustment.findFirst({ where: { id: document.id, tenantId } });
    if (!adj) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = adj.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const amount = new Decimal(adj.amount.toString());
    const isInflow = adj.adjustmentType === 'CASH_SURPLUS';
    const isOutflow = ['CASH_SHORTAGE', 'CASHIER_RECEIVABLE', 'DOCUMENT_CORRECTION', 'OTHER'].includes(adj.adjustmentType);

    await this.cashMovements.record(tenantId, { organizationId, cashDeskId: adj.cashDeskId, currencyId: adj.currencyId, direction: isInflow ? 'INFLOW' : 'OUTFLOW', amount, baseAmount: amount, sourceDocumentType: CASH_COUNT_ADJUSTMENT_TYPE, sourceDocumentId: adj.id, effectiveDate: businessDate }, tx);
    if (!isInflow && !isOutflow) return null; // exhaustive today, kept for future adjustmentType additions

    const cashAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.CASH, businessDate, tx).catch(() => null);
    if (!cashAccount) return null;
    const dims = [{ dimensionCode: 'CASHBOX', referenceId: adj.cashDeskId }, { dimensionCode: 'CURRENCY', referenceId: adj.currencyId }];

    if (adj.adjustmentType === 'CASH_SURPLUS') {
      const surplusAccount = (await this.mappings.resolve(tenantId, organizationId, MappingKeys.CASH_SURPLUS, businessDate, tx).catch(() => null)) ?? (await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_INCOME, businessDate, tx).catch(() => null));
      if (!surplusAccount) return null;
      return { description: `Cash surplus ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: cashAccount.id, side: 'DEBIT', amountBase: amount, description: 'Cash surplus found on count', dimensions: dims }, { accountId: surplusAccount.id, side: 'CREDIT', amountBase: amount, description: 'Cash surplus income', dimensions: dims }] };
    }

    if (adj.adjustmentType === 'CASH_SHORTAGE') {
      const shortageAccount = (await this.mappings.resolve(tenantId, organizationId, MappingKeys.CASH_SHORTAGE, businessDate, tx).catch(() => null)) ?? (await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx).catch(() => null));
      if (!shortageAccount) return null;
      return { description: `Cash shortage ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: shortageAccount.id, side: 'DEBIT', amountBase: amount, description: 'Cash shortage written off', dimensions: dims }, { accountId: cashAccount.id, side: 'CREDIT', amountBase: amount, description: 'Cash shortage on count', dimensions: dims }] };
    }

    if (adj.adjustmentType === 'CASHIER_RECEIVABLE') {
      await this.accountablePersons.record(tenantId, { organizationId, employeeId: adj.employeeId!, currencyId: adj.currencyId, movementType: 'ISSUE', amount, sourceDocumentType: CASH_COUNT_ADJUSTMENT_TYPE, sourceDocumentId: adj.id, effectiveDate: businessDate }, tx);
      const receivableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_ADVANCE, businessDate, tx).catch(() => null);
      if (!receivableAccount) return null;
      return { description: `Cashier receivable ${adj.number ?? adj.id}`, operationType: 'SYSTEM_DOCUMENT', lines: [{ accountId: receivableAccount.id, side: 'DEBIT', amountBase: amount, description: 'Charged to cashier (accountable person receivable stand-in)', dimensions: dims }, { accountId: cashAccount.id, side: 'CREDIT', amountBase: amount, description: 'Cash shortage charged to cashier', dimensions: dims }] };
    }

    return null; // DOCUMENT_CORRECTION / OTHER — cash register only, see class doc
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const adj = await tx.cashCountAdjustment.findFirst({ where: { id: document.id, tenantId } });
    await this.cashMovements.reverse(tenantId, CASH_COUNT_ADJUSTMENT_TYPE, document.id, tx);
    if (adj?.adjustmentType === 'CASHIER_RECEIVABLE' && adj.employeeId) {
      await this.accountablePersons.reverse(tenantId, CASH_COUNT_ADJUSTMENT_TYPE, document.id, tx);
    }
  }
}
