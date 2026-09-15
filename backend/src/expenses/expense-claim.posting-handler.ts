import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { AccountablePersonService } from '../cash/accountable-person.service';
import { FixedAssetAcquisitionCandidateService } from '../fixed-assets/fixed-asset-acquisition-candidate.service';
import { EXPENSE_CLAIM_TYPE } from './expense-claim.repository';

/**
 * Posting handler for ExpenseClaim (spec sections 11-32, 44-49). Each
 * line's `classification` decides its destination:
 *  - `CURRENT_EXPENSE` (default) — Dr the category's own expense account
 *    (falls back to OTHER_OPERATING_EXPENSE) + Dr recoverable VAT.
 *  - `PREPAID_EXPENSE` — Dr PREPAID_EXPENSE instead, and creates the
 *    `PrepaidExpense` schedule (spec sections 33-40) rather than
 *    expensing immediately.
 *  - `FIXED_ASSET`/`CIP` — hands off to Phase 16's own
 *    `FixedAssetAcquisitionCandidateService.createFromSource` (spec
 *    section 31's own "don't duplicate FA capitalization engine") instead
 *    of posting an expense line at all.
 *  - Every other classification (`INVENTORY_COST`, `SUPPLIER_SETTLEMENT`,
 *    `NONDEDUCTIBLE_EXPENSE`, `OTHER`) posts as a current expense in this
 *    build — the Phase 9/11 inventory-cost handoff (spec section 32) and
 *    the tax-deductibility dimension (spec section 49) are not wired end
 *    -to-end (disclosed simplification, see docs/EXPENSES.md).
 * The credit side depends on `paymentSourceType`: `EMPLOYEE_ADVANCE` draws
 * down the Phase 15 `AccountablePersonMovement` balance (spec sections
 * 21-27); everything else (including `EMPLOYEE_PERSONAL_FUNDS`) credits
 * `EMPLOYEE_EXPENSE_PAYABLE` — the company-owes-employee liability spec
 * section 24 describes; a real per-payment-source cash/bank/supplier
 * posting for `CASH_DESK`/`BANK`/`CORPORATE_CARD`/`SUPPLIER_PAYABLE` is
 * not wired (disclosed simplification).
 */
@Injectable()
export class ExpenseClaimPostingHandler implements DocumentPostingHandler {
  readonly documentType = EXPENSE_CLAIM_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mappings: AccountingMappingService,
    private readonly accountablePersons: AccountablePersonService,
    private readonly fixedAssetCandidates: FixedAssetAcquisitionCandidateService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const claim = await tx.expenseClaim.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!claim) throw new ValidationAppError('Document disappeared during posting');
    if (claim.approvalStatus === 'PENDING' || claim.approvalStatus === 'REJECTED') throw new ValidationAppError(`Cannot post a claim with approval status ${claim.approvalStatus}`);
    const approvedLines = claim.lines.filter((l) => l.approvedAmount != null && new Decimal(l.approvedAmount.toString()).gt(0));
    if (approvedLines.length === 0) throw new ValidationAppError('No approved lines to post');
    for (const line of approvedLines) {
      if (line.policyStatus === 'MISSING_RECEIPT' || line.policyStatus === 'MISSING_BUSINESS_PURPOSE') throw new ValidationAppError(`Line ${line.id} has an unresolved policy issue (${line.policyStatus}) — approve an exception first (spec section 17).`);
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const claim = await tx.expenseClaim.findFirst({ where: { id: document.id, tenantId }, include: { lines: { include: { category: true } } } });
    if (!claim) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = claim.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;
    const approvedLines = claim.lines.filter((l) => l.approvedAmount != null && new Decimal(l.approvedAmount.toString()).gt(0));

    const lines: { accountId: string; side: 'DEBIT' | 'CREDIT'; amountBase: Decimal; description: string; dimensions: { dimensionCode: string; referenceId: string }[] }[] = [];
    let advanceSettled = new Decimal(0);
    let payableCreated = new Decimal(0);

    for (const line of approvedLines) {
      const approved = new Decimal(line.approvedAmount!.toString());
      const dims = line.costCenterId ? [{ dimensionCode: 'COST_CENTER', referenceId: line.costCenterId }] : [];

      if (line.classification === 'FIXED_ASSET' || line.classification === 'CIP') {
        await this.fixedAssetCandidates.createFromSource(tenantId, organizationId, document.createdBy ?? 'system', { sourceDocumentType: EXPENSE_CLAIM_TYPE, sourceDocumentId: claim.id, sourceDocumentLineId: line.id, description: line.description ?? line.merchant ?? undefined, currencyId: line.transactionCurrencyId, transactionAmount: Number(line.transactionAmount.toString()), baseAmount: approved.toNumber(), candidateType: 'MANUAL' });
        continue; // no expense GL line — the FA module owns this cost from here
      }

      const recoverableVat = new Decimal(line.recoverableVat.toString());
      const netAmount = approved.minus(recoverableVat);

      if (line.classification === 'PREPAID_EXPENSE') {
        const prepaidAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.PREPAID_EXPENSE, businessDate, tx).catch(() => null);
        if (prepaidAccount) lines.push({ accountId: prepaidAccount.id, side: 'DEBIT', amountBase: netAmount, description: `Prepaid expense — ${line.description ?? line.category.name}`, dimensions: dims });
      } else {
        const expenseAccount = await this.mappings.resolve(tenantId, organizationId, line.category.accountingMappingProfile ?? MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx).catch(() => null);
        if (expenseAccount) lines.push({ accountId: expenseAccount.id, side: 'DEBIT', amountBase: netAmount, description: `${line.category.name} — ${line.description ?? line.merchant ?? ''}`, dimensions: dims });
      }

      if (recoverableVat.gt(0)) {
        const vatAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.VAT_INPUT_RECOVERABLE, businessDate, tx).catch(() => null);
        if (vatAccount) lines.push({ accountId: vatAccount.id, side: 'DEBIT', amountBase: recoverableVat, description: 'Recoverable input VAT', dimensions: dims });
      }

      if (line.paymentSourceType === 'EMPLOYEE_ADVANCE') {
        await this.accountablePersons.record(tenantId, { organizationId, employeeId: claim.employeeId, currencyId: line.transactionCurrencyId, movementType: 'EXPENSE_REPORTED', amount: approved, sourceDocumentType: EXPENSE_CLAIM_TYPE, sourceDocumentId: claim.id, effectiveDate: businessDate }, tx);
        const receivableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_ADVANCE, businessDate, tx).catch(() => null);
        if (receivableAccount) lines.push({ accountId: receivableAccount.id, side: 'CREDIT', amountBase: approved, description: 'Accountable person advance settled (stand-in account, see docs/EXPENSES.md)', dimensions: dims });
        advanceSettled = advanceSettled.plus(approved);
      } else {
        const payableAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.EMPLOYEE_EXPENSE_PAYABLE, businessDate, tx).catch(() => null);
        if (payableAccount) lines.push({ accountId: payableAccount.id, side: 'CREDIT', amountBase: approved, description: 'Employee expense reimbursement payable', dimensions: dims });
        payableCreated = payableCreated.plus(approved);
      }
    }

    const totalApproved = approvedLines.reduce((s, l) => s.plus(l.approvedAmount!.toString()), new Decimal(0));
    await tx.expenseClaim.update({ where: { id: claim.id }, data: { totalApprovedAmount: totalApproved.toString(), reimbursementDue: payableCreated.toString() } });

    if (lines.length === 0) return null;
    const debitTotal = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s.plus(l.amountBase), new Decimal(0));
    const creditTotal = lines.filter((l) => l.side === 'CREDIT').reduce((s, l) => s.plus(l.amountBase), new Decimal(0));
    if (!debitTotal.eq(creditTotal)) return null; // an account mapping was unavailable for some line — skip GL, subledger effects already recorded

    return { description: `Expense claim ${claim.number ?? claim.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.accountablePersons.reverse(tenantId, EXPENSE_CLAIM_TYPE, document.id, tx);
    await tx.expenseClaim.update({ where: { id: document.id }, data: { totalApprovedAmount: '0', reimbursementDue: '0' } });
  }
}
