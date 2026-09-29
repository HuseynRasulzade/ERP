import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * ExpenseTaxService (docx spec Phase 20 sections 44-49) — every VAT
 * figure comes from the Phase 5 Tax Engine; this module never hardcodes
 * a rate or a recoverability rule. Amounts entered on a claim line are
 * treated as GROSS (tax-inclusive) — what the receipt actually shows —
 * so `calculateLine` is always called with `priceIncludesTax: true`
 * here; GL posting (task 48) is what turns the split into separate
 * Dr Expense (net) / Dr Recoverable VAT lines (spec test 177: "Expense
 * 100, VAT Receivable 18 — not expense 118").
 */
@Injectable()
export class ExpenseTaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculation: TaxCalculationService,
  ) {}

  async assessClaim(tenantId: string, organizationId: string, claimId: string, tx?: PrismaTransactionClient) {
    const client = tx ?? this.prisma;
    const claim = await client.expenseClaim.findFirst({ where: { id: claimId, tenantId }, include: { lines: true } });
    if (!claim) return [];

    const categories = await client.expenseCategory.findMany({
      where: { tenantId, id: { in: Array.from(new Set(claim.lines.map((l) => l.expenseCategoryId))) } },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const assessments = [];
    for (const line of claim.lines) {
      const category = categoryById.get(line.expenseCategoryId);
      const taxCategoryCode = category?.vatTreatmentProfile ?? DEFAULT_TAX_CATEGORY;
      const businessDate = line.expenseDate;

      const result = await this.taxCalculation.calculateLine(
        {
          tenantId,
          organizationId,
          businessDate,
          taxPointDate: businessDate,
          operationType: 'PURCHASE',
          taxCategoryCode,
          taxpayerSide: 'BUYER',
        },
        { sourceLineId: line.id, amount: line.baseAmount.toString(), priceIncludesTax: true, currency: line.transactionCurrencyId },
        tx,
      );

      const receiptCount = await client.expenseReceipt.count({ where: { claimLineId: line.id } });
      const taxStatus = result.taxAmount.lte(0)
        ? 'NOT_APPLICABLE'
        : receiptCount > 0
          ? 'VALID'
          : 'MISSING';

      const assessment = await client.expenseTaxAssessment.upsert({
        where: { claimLineId: line.id },
        create: {
          tenantId,
          claimLineId: line.id,
          taxable: result.taxAmount.gt(0),
          vatPresent: result.taxAmount.gt(0),
          recoverable: result.recoverableAmount.gt(0),
          nonrecoverable: result.nonrecoverableAmount.gt(0),
          exempt: result.treatment === 'EXEMPT',
          recoverableAmount: result.recoverableAmount,
          nonrecoverableAmount: result.nonrecoverableAmount,
          taxDocumentStatus: taxStatus,
          deductibleForTax: true,
          sourceRule: result.ruleId,
        },
        update: {
          taxable: result.taxAmount.gt(0),
          vatPresent: result.taxAmount.gt(0),
          recoverable: result.recoverableAmount.gt(0),
          nonrecoverable: result.nonrecoverableAmount.gt(0),
          exempt: result.treatment === 'EXEMPT',
          recoverableAmount: result.recoverableAmount,
          nonrecoverableAmount: result.nonrecoverableAmount,
          taxDocumentStatus: taxStatus,
          sourceRule: result.ruleId,
        },
      });

      await client.expenseClaimLine.update({
        where: { id: line.id },
        data: {
          taxAmount: result.taxAmount,
          vatAmount: result.taxAmount,
          recoverableVat: result.recoverableAmount,
          nonrecoverableVat: result.nonrecoverableAmount,
          taxStatus,
        },
      });
      assessments.push(assessment);
    }
    return assessments;
  }
}
