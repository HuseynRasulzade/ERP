import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { TaxLineResult } from '../tax-engine/tax-calculation-result';
import { EXPENSE_CLAIM_TYPE } from './expense-claim.service';
import { buildExpenseMovements } from './expense-movement-register.service';
import { PaymentSourceTypes, ExpenseClassifications } from './expense-codes';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

const CLASSIFICATION_MAPPING_KEY: Record<string, string> = {
  [ExpenseClassifications.PREPAID_EXPENSE]: 'PREPAID_EXPENSE_ASSET',
  [ExpenseClassifications.FIXED_ASSET]: 'FIXED_ASSET_CIP',
  [ExpenseClassifications.CIP]: 'FIXED_ASSET_CIP',
};

const PAYMENT_SOURCE_MAPPING_KEY: Record<string, string> = {
  [PaymentSourceTypes.EMPLOYEE_PERSONAL_FUNDS]: 'EMPLOYEE_REIMBURSEMENT_PAYABLE',
  [PaymentSourceTypes.EMPLOYEE_ADVANCE]: 'ACCOUNTABLE_PERSON_RECEIVABLE',
  [PaymentSourceTypes.CASH_DESK]: 'CASH',
  [PaymentSourceTypes.BANK]: 'BANK',
  [PaymentSourceTypes.CORPORATE_CARD]: 'BANK',
  [PaymentSourceTypes.SUPPLIER_PAYABLE]: 'SUPPLIER_PAYABLE',
  [PaymentSourceTypes.OTHER]: 'EMPLOYEE_REIMBURSEMENT_PAYABLE',
};

/**
 * Posting handler for ExpenseClaim (docx spec Phase 20 sections 92-101).
 * Per approved line (never a SUPPLIER_SETTLEMENT-classified one — spec
 * sections 97-98, the cost is already recognized by another source
 * document):
 *
 *   Dr <Expense/Prepaid/CIP account, by classification>  = net taxable base
 *   Dr Recoverable/Nonrecoverable VAT (via TaxRegisterService)
 *   Cr <Employee Reimbursement Payable/Accountable Person Receivable/
 *       Cash/Bank/Supplier Payable, by paymentSourceType> = full approved
 *       (gross) amount
 *
 * Balanced by construction: Dr(net + recoverable + nonrecoverable) ==
 * gross == Cr. Tax is recomputed fresh on the APPROVED amount here
 * (never reused from ExpenseTaxAssessment's claimed-amount figures) —
 * same convention as PurchaseInvoicePostingHandler. Dimensioned by
 * COST_CENTER/PROJECT (spec section 100).
 */
@Injectable()
export class ExpenseClaimPostingHandler implements DocumentPostingHandler {
  readonly documentType = EXPENSE_CLAIM_TYPE;

  constructor(
    private readonly mappings: AccountingMappingService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const claim = await tx.expenseClaim.findFirst({ where: { id: document.id, tenantId } });
    if (!claim) throw new ValidationAppError('Document disappeared during posting');
    if (claim.claimStatus !== 'APPROVED' && claim.claimStatus !== 'PARTIALLY_APPROVED' && claim.claimStatus !== 'POSTED')
      throw new ValidationAppError(`Cannot post an expense claim in status ${claim.claimStatus}`);
    if (new Decimal(claim.totalApprovedAmount.toString()).lte(0))
      throw new ValidationAppError('Cannot post an expense claim with no approved amount');
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const claim = await tx.expenseClaim.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!claim) throw new ValidationAppError('Document disappeared during posting');
    return buildExpenseMovements(claim, claim.lines);
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const claim = await tx.expenseClaim.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!claim) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = document.organizationId!;
    const businessDate = document.postingDate ?? document.documentDate;

    const categories = await tx.expenseCategory.findMany({
      where: { tenantId, id: { in: Array.from(new Set(claim.lines.map((l) => l.expenseCategoryId))) } },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const lines: AccountingPostingLineInput[] = [];
    const taxResults: TaxLineResult[] = [];

    for (const line of claim.lines) {
      const approvedAmount = new Decimal(line.approvedAmount?.toString() ?? '0');
      if (approvedAmount.lte(0)) continue;
      if (line.classification === ExpenseClassifications.SUPPLIER_SETTLEMENT) continue;

      const category = categoryById.get(line.expenseCategoryId);
      const taxCategoryCode = category?.vatTreatmentProfile ?? DEFAULT_TAX_CATEGORY;
      const taxResult = await this.taxCalculation.calculateLine(
        { tenantId, organizationId, businessDate: line.expenseDate, taxPointDate: line.expenseDate, operationType: 'PURCHASE', taxCategoryCode, taxpayerSide: 'BUYER' },
        { sourceLineId: line.id, amount: approvedAmount.toString(), priceIncludesTax: true, currency: line.transactionCurrencyId },
        tx,
      );
      taxResults.push(taxResult);

      const dims: AccountingPostingLineInput['dimensions'] = [];
      if (line.costCenterId) dims.push({ dimensionCode: 'COST_CENTER', referenceId: line.costCenterId });
      if (line.projectId) dims.push({ dimensionCode: 'PROJECT', referenceId: line.projectId });

      const expenseMappingKey =
        CLASSIFICATION_MAPPING_KEY[line.classification ?? ''] ?? category?.defaultAccountingMappingKey ?? 'ADMIN_EXPENSE';
      const expenseAccount = await this.mappings.resolve(tenantId, organizationId, expenseMappingKey, businessDate, tx);
      lines.push({
        accountId: expenseAccount.id,
        side: 'DEBIT',
        amountBase: taxResult.taxableBase,
        description: `Expense claim ${claim.number ?? claim.id} — ${category?.name ?? line.expenseCategoryId}`,
        dimensions: dims,
      });

      const creditMappingKey = PAYMENT_SOURCE_MAPPING_KEY[line.paymentSourceType] ?? 'EMPLOYEE_REIMBURSEMENT_PAYABLE';
      const creditAccount = await this.mappings.resolve(tenantId, organizationId, creditMappingKey, businessDate, tx);
      const creditDims: AccountingPostingLineInput['dimensions'] =
        line.paymentSourceType === PaymentSourceTypes.EMPLOYEE_PERSONAL_FUNDS ||
        line.paymentSourceType === PaymentSourceTypes.EMPLOYEE_ADVANCE ||
        line.paymentSourceType === PaymentSourceTypes.OTHER
          ? [{ dimensionCode: 'EMPLOYEE', referenceId: claim.responsiblePersonId ?? claim.employmentId }]
          : [];
      lines.push({
        accountId: creditAccount.id,
        side: 'CREDIT',
        amountBase: approvedAmount,
        description: `Expense claim ${claim.number ?? claim.id} — ${line.paymentSourceType}`,
        dimensions: creditDims,
      });
    }

    if (taxResults.length > 0) {
      const { accountingLines: vatLines } = await this.taxRegister.registerTaxable(
        tenantId,
        document.postedBy ?? document.createdBy ?? 'system',
        {
          organizationId,
          sourceDocumentType: EXPENSE_CLAIM_TYPE,
          sourceDocumentId: document.id,
          taxPointDate: businessDate,
          currencyId: claim.currencyId ?? undefined,
          operationType: 'PURCHASE',
          lines: taxResults,
        },
        tx,
      );
      lines.push(...vatLines);
    }

    if (lines.length === 0) return null;
    return {
      description: `Expense claim ${claim.number ?? claim.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
