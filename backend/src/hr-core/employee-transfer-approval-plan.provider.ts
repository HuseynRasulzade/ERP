import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole, userHasRoleInDepartment } from '../approvals/role-resolution.util';
import { TRANSFER_TYPE } from './employee-transfer.service';

const DEPARTMENT_HEAD_ROLE = 'DEPARTMENT_HEAD';

/**
 * EmployeeTransfer approval plan: a single DEPARTMENT_HEAD step, resolved
 * against the employment's CURRENT department (the one releasing the
 * employee) — not `newDepartmentId`, which is optional and only set for a
 * DEPARTMENT_TRANSFER/COMBINED_TRANSFER (a PROMOTION or FTE_CHANGE, say,
 * never sets it, yet still needs sign-off from the employee's existing
 * department head). Only planned when a head is actually resolvable for
 * that department (same "usually NOT_REQUIRED" posture as
 * HireDocumentApprovalPlanProvider — see its header comment for why an
 * unconditional step would break every org without an appointed head).
 */
@Injectable()
export class EmployeeTransferApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = TRANSFER_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.employeeTransfer.findFirst({ where: { id: documentId, tenantId }, include: { employment: true } });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.employeeTransfer.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    const departmentId = document.employment?.departmentId ?? null;
    const required = !!departmentId && (await this.hasResolvableHead(tenantId, organizationId, departmentId, tx));
    // An empty plan (not a single SKIPPED step) is what tells
    // ApprovalService.createStepsForDocument to set approvalStatus straight
    // to NOT_REQUIRED — a lone SKIPPED step would leave it stuck at PENDING
    // forever, since nothing left to decide ever flips it to APPROVED.
    return required ? [{ sequence: 1, stepType: 'DEPARTMENT_HEAD' }] : [];
  }

  async resolveApprover(tenantId: string, organizationId: string, stepType: ApprovalStepType, document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'DEPARTMENT_HEAD') return false;
    const departmentId = document.employment?.departmentId ?? null;
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
