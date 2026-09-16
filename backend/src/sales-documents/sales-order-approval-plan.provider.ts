import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole } from '../approvals/role-resolution.util';
import { calculateCreditCheck } from '../sales-preorder/credit-check.util';
import { SALES_ORDER_TYPE } from './sales-order.repository';

const SALES_MANAGER_ROLE = 'SALES_MANAGER';

/** SalesOrder grand total (AZN equivalent) above which Sales Manager
 * approval is required, mirroring PurchaseOrder's finance threshold. */
export const SALES_ORDER_MANAGER_APPROVAL_THRESHOLD = new Decimal(15000);

/**
 * Sales Order approval plan: a single SALES_MANAGER step, added when
 * either the order's AZN-equivalent grand total exceeds
 * SALES_ORDER_MANAGER_APPROVAL_THRESHOLD, or the counterparty's credit
 * check comes back APPROVAL_REQUIRED (see credit-check.util.ts) — one
 * step either way, not two. A hard BLOCKED credit result is NOT
 * resolved by approval here: `SalesOrderPostingHandler.validateForPosting`
 * still re-runs the same check at posting time and throws regardless of
 * approvalStatus, since no approval should override a breach beyond the
 * grace band.
 */
@Injectable()
export class SalesOrderApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = SALES_ORDER_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.salesOrder.findFirst({
      where: { id: documentId, tenantId },
      include: { lines: true, counterparty: true },
    });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.salesOrder.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, _organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    const steps: ApprovalStepPlanItem[] = [];

    const aznTotal = this.aznEquivalent(document);
    const overThreshold = aznTotal.gt(SALES_ORDER_MANAGER_APPROVAL_THRESHOLD);

    const creditLimit = document.counterparty?.creditLimit ? new Decimal(document.counterparty.creditLimit.toString()) : null;
    const creditCalc = calculateCreditCheck(creditLimit, aznTotal);
    const creditRequiresApproval = creditCalc.actionPolicy === 'REQUIRE_APPROVAL';

    if (overThreshold || creditRequiresApproval) {
      steps.push({ sequence: 1, stepType: 'SALES_MANAGER' });
    }

    return steps;
  }

  async resolveApprover(tenantId: string, _organizationId: string, stepType: ApprovalStepType, _document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'SALES_MANAGER') return false;
    return userHasRole(tenantId, userId, SALES_MANAGER_ROLE, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }

  private aznEquivalent(document: any): Decimal {
    const grandTotal = new Decimal(document.grandTotal?.toString() ?? '0');
    if (document.exchangeRate) return grandTotal.mul(new Decimal(document.exchangeRate.toString()));
    return grandTotal;
  }
}
