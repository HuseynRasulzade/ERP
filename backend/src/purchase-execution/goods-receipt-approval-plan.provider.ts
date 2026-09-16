import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole } from '../approvals/role-resolution.util';
import { GOODS_RECEIPT_TYPE } from './goods-receipt.repository';
import { PurchaseFulfillmentService } from './purchase-fulfillment.service';

const WAREHOUSE_SUPERVISOR_ROLE = 'WAREHOUSE_SUPERVISOR';

/**
 * Goods Receipt approval plan: usually empty (NOT_REQUIRED) — a single
 * WAREHOUSE_SUPERVISOR step is only required when at least one line
 * receives more than its source PO line's remaining quantity.
 */
@Injectable()
export class GoodsReceiptApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = GOODS_RECEIPT_TYPE;

  constructor(private readonly fulfillment: PurchaseFulfillmentService) {}

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.goodsReceipt.findFirst({ where: { id: documentId, tenantId }, include: { lines: true } });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.goodsReceipt.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, _organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    for (const line of document.lines ?? []) {
      if (!line.supplierOrderLineId) continue;
      const remaining = await this.fulfillment.remainingToReceive(tenantId, line.supplierOrderLineId, tx);
      if (new Decimal(line.quantity.toString()).gt(remaining)) {
        return [{ sequence: 1, stepType: 'WAREHOUSE_SUPERVISOR' }];
      }
    }
    return [];
  }

  async resolveApprover(tenantId: string, _organizationId: string, stepType: ApprovalStepType, _document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'WAREHOUSE_SUPERVISOR') return false;
    return userHasRole(tenantId, userId, WAREHOUSE_SUPERVISOR_ROLE, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }
}
