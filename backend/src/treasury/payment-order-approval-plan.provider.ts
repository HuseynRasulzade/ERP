import { Injectable } from '@nestjs/common';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole } from '../approvals/role-resolution.util';
import { PAYMENT_ORDER_TYPE } from './payment-order.repository';

const FINANCE_ROLE = 'FINANCE_USER';

/**
 * Payment Order approval plan: always exactly one FINANCE step (spec:
 * "Ödəniş Tapşırığı maliyyə tərəfindən təsdiqlənsin") — unlike GoodsReceipt/
 * PurchaseInvoice's usually-empty plans, this one is never NOT_REQUIRED.
 */
@Injectable()
export class PaymentOrderApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = PAYMENT_ORDER_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.paymentOrder.findFirst({ where: { id: documentId, tenantId } });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.paymentOrder.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(): Promise<ApprovalStepPlanItem[]> {
    return [{ sequence: 1, stepType: 'FINANCE' }];
  }

  async resolveApprover(tenantId: string, _organizationId: string, stepType: ApprovalStepType, _document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'FINANCE') return false;
    return userHasRole(tenantId, userId, FINANCE_ROLE, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }
}
