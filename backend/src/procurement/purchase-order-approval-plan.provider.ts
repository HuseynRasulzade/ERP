import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole, userHasRoleInDepartment } from '../approvals/role-resolution.util';
import { PURCHASE_ORDER_TYPE } from './purchase-order.repository';
import { checkContractLimit } from './contract-limit.util';

const PROCUREMENT_OFFICER_ROLE = 'PROCUREMENT_OFFICER';
const DEPARTMENT_HEAD_ROLE = 'DEPARTMENT_HEAD';
const DIRECTOR_ROLE = 'DIRECTOR';
const FINANCE_ROLE = 'FINANCE_USER';
const ACCOUNTING_ROLE = 'ACCOUNTING_USER';

/** PO grand total (AZN equivalent) above which Finance approval is required. */
export const PO_FINANCE_APPROVAL_THRESHOLD = new Decimal(10000);

const ROLE_BY_STEP: Record<ApprovalStepType, string> = {
  PROCUREMENT_OFFICER: PROCUREMENT_OFFICER_ROLE,
  DEPARTMENT_HEAD: DEPARTMENT_HEAD_ROLE,
  DIRECTOR: DIRECTOR_ROLE,
  FINANCE: FINANCE_ROLE,
  ACCOUNTING: ACCOUNTING_ROLE,
  // PurchaseOrder's own plan never emits this step — present only to
  // satisfy the shared ApprovalStepType union now that GoodsReceipt uses it.
  WAREHOUSE_SUPERVISOR: 'WAREHOUSE_SUPERVISOR',
};

/**
 * Purchase Order approval plan: PROCUREMENT_OFFICER -> DEPARTMENT_HEAD ->
 * DIRECTOR always; FINANCE appended when the order's AZN-equivalent grand
 * total exceeds PO_FINANCE_APPROVAL_THRESHOLD; ACCOUNTING appended when any
 * line's tax rate is non-standard (some lines taxed, others zero-rated) on
 * the same order. DEPARTMENT_HEAD resolves against the department of the
 * source Purchase Requirement(s) this order's lines were allocated from
 * (PurchaseOrderLine.requirementLineId has no Prisma relation configured —
 * it's a plain snapshot field, same convention as ShipmentLine's source
 * pointers — so it's resolved with an explicit lookup, not an `include`).
 */
@Injectable()
export class PurchaseOrderApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = PURCHASE_ORDER_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.purchaseOrder.findFirst({
      where: { id: documentId, tenantId },
      include: { lines: true },
    });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.purchaseOrder.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, _organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    const departmentId = await this.resolveDepartmentId(tenantId, document, tx);

    const steps: ApprovalStepPlanItem[] = [
      { sequence: 1, stepType: 'PROCUREMENT_OFFICER' },
      { sequence: 2, stepType: 'DEPARTMENT_HEAD', skipped: !departmentId },
      { sequence: 3, stepType: 'DIRECTOR' },
    ];

    // PurchaseOrder has no payment-terms field of its own today (it lives
    // on the counterparty/contract, not the order) — the finance trigger is
    // the AZN-equivalent grand total threshold only.
    const aznTotal = this.aznEquivalent(document);
    let financeStepAdded = false;
    if (aznTotal.gt(PO_FINANCE_APPROVAL_THRESHOLD)) {
      steps.push({ sequence: 4, stepType: 'FINANCE' });
      financeStepAdded = true;
    }

    // Contract spend-limit control (docs/APPROVALS.md): a contract with
    // limitPolicy=APPROVAL that this order would exceed also requires
    // FINANCE sign-off — reuses the same step, not a duplicate one, if the
    // amount threshold already added it.
    if (document.contractId && !financeStepAdded) {
      const limitCheck = await checkContractLimit(tx, tenantId, document.contractId, document.id, new Decimal(document.grandTotal.toString()));
      if (limitCheck?.exceeds && limitCheck.policy === 'APPROVAL') {
        steps.push({ sequence: 4, stepType: 'FINANCE' });
      }
    }

    if (this.hasNonStandardTax(document)) {
      steps.push({ sequence: 5, stepType: 'ACCOUNTING' });
    }

    return steps;
  }

  async resolveApprover(tenantId: string, organizationId: string, stepType: ApprovalStepType, document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    const roleCode = ROLE_BY_STEP[stepType];
    if (stepType !== 'DEPARTMENT_HEAD') {
      return userHasRole(tenantId, userId, roleCode, tx);
    }

    const departmentId = await this.resolveDepartmentId(tenantId, document, tx);
    if (!departmentId) return false; // step is SKIPPED in this case — never reached

    const department = await tx.department.findFirst({ where: { id: departmentId, tenantId } });
    if (department?.managerPersonId) {
      const manager = await tx.responsiblePerson.findFirst({ where: { id: department.managerPersonId, tenantId } });
      if (manager?.userId) {
        if (manager.userId !== userId) return false;
        return userHasRole(tenantId, userId, DEPARTMENT_HEAD_ROLE, tx);
      }
    }
    return userHasRoleInDepartment(tenantId, organizationId, userId, DEPARTMENT_HEAD_ROLE, departmentId, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }

  private async resolveDepartmentId(tenantId: string, document: any, tx: PrismaTransactionClient): Promise<string | null> {
    const requirementLineIds: string[] = (document.lines ?? [])
      .map((l: any) => l.requirementLineId)
      .filter((id: string | null): id is string => !!id);
    if (requirementLineIds.length === 0) return null;

    const requirementLines = await tx.purchaseRequirementLine.findMany({
      where: { id: { in: requirementLineIds }, tenantId },
      select: { purchaseRequirementId: true },
    });
    const requirementIds = Array.from(new Set(requirementLines.map((l) => l.purchaseRequirementId)));
    if (requirementIds.length === 0) return null;

    const requirement = await tx.purchaseRequirement.findFirst({
      where: { id: { in: requirementIds }, tenantId, departmentId: { not: null } },
      select: { departmentId: true },
    });
    return requirement?.departmentId ?? null;
  }

  private aznEquivalent(document: any): Decimal {
    const grandTotal = new Decimal(document.grandTotal?.toString() ?? '0');
    if (document.exchangeRate) return grandTotal.mul(new Decimal(document.exchangeRate.toString()));
    return grandTotal;
  }

  private hasNonStandardTax(document: any): boolean {
    const rates = new Set((document.lines ?? []).map((l: any) => new Decimal(l.taxRate?.toString() ?? '0').toString()));
    return rates.has('0') && rates.size > 1;
  }
}
