import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole, userHasRoleInDepartment } from '../approvals/role-resolution.util';
import { HIRE_DOCUMENT_TYPE } from './hire-document.service';

const DEPARTMENT_HEAD_ROLE = 'DEPARTMENT_HEAD';

/**
 * HireDocument approval plan: a single DEPARTMENT_HEAD step — but, unlike
 * PurchaseOrder's always-required chain, only planned when a department
 * head is actually resolvable for the hiring department (via
 * `Department.managerPersonId` or a DEPARTMENT_HEAD role holder scoped to
 * it). Deliberate: `HireDocument.departmentId` is a required field, always
 * present, so an unconditional step would block every hire in every
 * organization that hasn't yet appointed a head for that department —
 * including the many Phase 18/19/20 test fixtures that hire an employee
 * purely as setup and immediately post the document. Same "usually
 * NOT_REQUIRED" posture as GoodsReceiptApprovalPlanProvider, not PurchaseOrder's.
 */
@Injectable()
export class HireDocumentApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = HIRE_DOCUMENT_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.hireDocument.findFirst({ where: { id: documentId, tenantId } });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.hireDocument.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    const departmentId = document.departmentId;
    const required = !!departmentId && (await this.hasResolvableHead(tenantId, organizationId, departmentId, tx));
    // An empty plan (not a single SKIPPED step) is what tells
    // ApprovalService.createStepsForDocument to set approvalStatus straight
    // to NOT_REQUIRED — a lone SKIPPED step would leave it stuck at PENDING
    // forever, since nothing left to decide ever flips it to APPROVED.
    return required ? [{ sequence: 1, stepType: 'DEPARTMENT_HEAD' }] : [];
  }

  async resolveApprover(tenantId: string, organizationId: string, stepType: ApprovalStepType, document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'DEPARTMENT_HEAD') return false;
    const departmentId = document.departmentId;
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

  private async hasResolvableHead(tenantId: string, organizationId: string, departmentId: string, tx: PrismaTransactionClient): Promise<boolean> {
    const department = await tx.department.findFirst({ where: { id: departmentId, tenantId } });
    if (department?.managerPersonId) {
      const manager = await tx.responsiblePerson.findFirst({ where: { id: department.managerPersonId, tenantId } });
      if (manager?.userId) return true;
    }
    const count = await tx.membershipRole.count({
      where: {
        role: { tenantId, code: DEPARTMENT_HEAD_ROLE },
        membership: { tenantId, status: 'ACTIVE', organizationAccess: { some: { organizationId, departmentId } } },
      },
    });
    return count > 0;
  }
}
