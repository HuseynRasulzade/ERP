import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { ExpensePolicyService } from './expense-policy.service';

export interface ExpenseLineViolation {
  lineId: string;
  code: string;
  message: string;
  /** Blocking violations refuse submission outright (spec section 17:
   * "Silent approval etmə") — a missing mandatory receipt with no
   * exception workflow wired in this build is always blocking. */
  blocking: boolean;
  /** A policy-limit violation that is NOT blocking still marks the line
   * `policyStatus = EXCEEDED` so an approver sees it (spec section 51:
   * "Policy exception -> finance regardless amount"). */
  exceeded: boolean;
}

/**
 * ExpenseValidationService (docx spec Phase 20 sections 9-10, 16-19) —
 * policy limit + receipt requirement + business purpose checks, resolved
 * entirely from `ExpensePolicy`/`ExpenseCategory` DATA, never a hardcoded
 * per-category amount.
 */
@Injectable()
export class ExpenseValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: ExpensePolicyService,
  ) {}

  async validateClaim(
    tenantId: string,
    organizationId: string,
    claim: { lines: Array<{ id: string; expenseCategoryId: string; expenseDate: Date; baseAmount: Decimal | string; description: string | null }> },
  ): Promise<ExpenseLineViolation[]> {
    const violations: ExpenseLineViolation[] = [];
    const categoryIds = Array.from(new Set(claim.lines.map((l) => l.expenseCategoryId)));
    const categories = await this.prisma.expenseCategory.findMany({ where: { tenantId, id: { in: categoryIds } } });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    for (const line of claim.lines) {
      const category = categoryById.get(line.expenseCategoryId);
      if (!category) continue;
      const amount = new Decimal(line.baseAmount.toString());

      const policyRows = await this.policies.resolveForCategory(tenantId, organizationId, line.expenseCategoryId, line.expenseDate);
      const maxAmountRow = policyRows.find((p) => p.maxAmount !== null);
      if (maxAmountRow?.maxAmount && amount.gt(new Decimal(maxAmountRow.maxAmount.toString()))) {
        violations.push({
          lineId: line.id,
          code: 'POLICY_LIMIT_EXCEEDED',
          message: `${category.name} amount ${amount.toFixed(2)} exceeds the policy limit ${maxAmountRow.maxAmount.toString()}`,
          blocking: false,
          exceeded: true,
        });
      }

      const receiptRequirement =
        policyRows.find((p) => p.receiptRequiredOverride)?.receiptRequiredOverride ?? category.receiptRequirement;
      if (receiptRequirement === 'REQUIRED' || receiptRequirement === 'REQUIRED_ABOVE_THRESHOLD') {
        const threshold = category.receiptRequiredThreshold ? new Decimal(category.receiptRequiredThreshold.toString()) : null;
        const requiredNow = receiptRequirement === 'REQUIRED' || (threshold !== null && amount.gt(threshold));
        if (requiredNow) {
          const receiptCount = await this.prisma.expenseReceipt.count({
            where: { claimLineId: line.id, validationStatus: { notIn: ['INVALID', 'DUPLICATE'] } },
          });
          if (receiptCount === 0) {
            violations.push({
              lineId: line.id,
              code: 'RECEIPT_REQUIRED',
              message: `${category.name} requires a receipt but none is attached`,
              blocking: true,
              exceeded: false,
            });
          }
        }
      }

      // businessPurposeRequired is already enforced at claim-creation time
      // (ExpenseClaimService.create) — never re-checked against
      // `description` here, since a bare description is explicitly not
      // sufficient (spec section 19).
    }
    return violations;
  }
}
