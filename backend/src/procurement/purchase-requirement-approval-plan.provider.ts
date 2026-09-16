import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole, userHasRoleInDepartment } from '../approvals/role-resolution.util';
import { PURCHASE_REQUIREMENT_TYPE } from './purchase-requirement.service';

const DEPARTMENT_HEAD_ROLE = 'DEPARTMENT_HEAD';

/**
 * Purchase Requirement approval plan: a single DEPARTMENT_HEAD step. No
 * downstream document (Purchase Order, Contract, Goods Receipt, Invoice,
 * Payment) may be created from an unapproved requirement — enforced at
 * each of those creation paths, not here.
 */
@Injectable()
export class PurchaseRequirementApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = PURCHASE_REQUIREMENT_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.purchaseRequirement.findFirst({ where: { id: documentId, tenantId } });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.purchaseRequirement.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(_tenantId: string, _organizationId: string, _document: any): Promise<ApprovalStepPlanItem[]> {
    return [{ sequence: 1, stepType: 'DEPARTMENT_HEAD' }];
  }

  async resolveApprover(tenantId: string, organizationId: string, stepType: ApprovalStepType, document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'DEPARTMENT_HEAD') return false;
    if (!document.departmentId) {
      // No department on the requirement — any DEPARTMENT_HEAD in this
      // organization may approve (nothing more specific to scope against).
      return userHasRole(tenantId, userId, DEPARTMENT_HEAD_ROLE, tx);
    }

    const department = await tx.department.findFirst({ where: { id: document.departmentId, tenantId } });
    if (department?.managerPersonId) {
      const manager = await tx.responsiblePerson.findFirst({ where: { id: department.managerPersonId, tenantId } });
      if (manager?.userId) {
        if (manager.userId === userId) return userHasRole(tenantId, userId, DEPARTMENT_HEAD_ROLE, tx);
        return false;
      }
    }

    // No manager assigned to the department — fall back to any user
    // holding DEPARTMENT_HEAD whose home department (OrganizationAccess)
    // matches this requirement's department.
    return userHasRoleInDepartment(tenantId, organizationId, userId, DEPARTMENT_HEAD_ROLE, document.departmentId, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }
}
