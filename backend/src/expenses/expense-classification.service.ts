import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ExpenseClassifications, PaymentSourceTypes } from './expense-codes';

/**
 * ExpenseClassificationService (docx spec Phase 20 sections 29-32) —
 * decides each approved line's GL destination. Automated by default;
 * `capitalizableCandidate`/`prepaidCandidate` are the human-reviewed
 * signal a claim line carries INTO this decision (spec section 30: some
 * cases — "Laptop 3,000: office expense? inventory? fixed asset?" —
 * need review, not a silent default), so this engine trusts those flags
 * rather than re-deriving them from amount/category alone.
 */
@Injectable()
export class ExpenseClassificationService {
  classifyLine(line: {
    paymentSourceType: string;
    sourceDocumentType: string | null;
    sourceDocumentId: string | null;
    prepaidCandidate: boolean;
    capitalizableCandidate: boolean;
  }, category: { capitalizableEligible: boolean; prepaidEligible: boolean; inventoryCostEligible: boolean }): string {
    // Spec section 97-98: a line that only references/reclassifies a cost
    // already recognized by another source document (typically a
    // Supplier Invoice) must never recognize the expense a second time.
    if (line.paymentSourceType === PaymentSourceTypes.SUPPLIER_PAYABLE && line.sourceDocumentType && line.sourceDocumentId) {
      return ExpenseClassifications.SUPPLIER_SETTLEMENT;
    }
    if (category.capitalizableEligible && line.capitalizableCandidate) {
      return ExpenseClassifications.FIXED_ASSET;
    }
    if (category.prepaidEligible && line.prepaidCandidate) {
      return ExpenseClassifications.PREPAID_EXPENSE;
    }
    if (category.inventoryCostEligible) {
      // Disclosed simplification (spec section 32): the Additional
      // Purchase Cost handoff (Phase 9/11) is document-linked to a
      // specific goods receipt, which an employee expense claim has no
      // natural reference to in this build — classified but not
      // auto-wired into that workflow; see docs/EXPENSES.md.
      return ExpenseClassifications.INVENTORY_COST;
    }
    return ExpenseClassifications.CURRENT_EXPENSE;
  }

  async classifyClaim(claimId: string, tx: PrismaTransactionClient) {
    const claim = await tx.expenseClaim.findFirst({ where: { id: claimId }, include: { lines: true } });
    if (!claim) return;
    const categories = await tx.expenseCategory.findMany({
      where: { id: { in: Array.from(new Set(claim.lines.map((l) => l.expenseCategoryId))) } },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    for (const line of claim.lines) {
      const category = categoryById.get(line.expenseCategoryId);
      if (!category) continue;
      const classification = this.classifyLine(line, category);
      await tx.expenseClaimLine.update({ where: { id: line.id }, data: { classification } });
    }
  }
}
