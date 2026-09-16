import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaTransactionClient } from '../prisma/prisma.service';
import { ApprovalPlanProvider, ApprovalStepPlanItem, ApprovalStepType } from '../approvals/approval-plan.interface';
import { userHasRole } from '../approvals/role-resolution.util';
import { PURCHASE_INVOICE_TYPE } from './purchase-invoice.repository';

const ACCOUNTING_ROLE = 'ACCOUNTING_USER';

/** Price line differing from its source by more than this percentage
 * requires ACCOUNTING approval before the invoice can post. */
export const PURCHASE_INVOICE_PRICE_VARIANCE_TOLERANCE_PERCENT = new Decimal(2);

/**
 * Purchase Invoice approval plan: usually empty (NOT_REQUIRED) — a single
 * ACCOUNTING step is required only when a line's price differs from its
 * source (the linked Goods Receipt line if any, else the linked Purchase
 * Order line) by more than the tolerance. Reuses the existing ACCOUNTING
 * step type — no new enum value needed. This is independent of
 * PurchaseMatchingService's own on-demand, 0-tolerance three-way-match
 * report — that stays a separate reporting feature.
 */
@Injectable()
export class PurchaseInvoiceApprovalPlanProvider implements ApprovalPlanProvider {
  readonly documentType = PURCHASE_INVOICE_TYPE;

  async loadDocument(tenantId: string, documentId: string, tx: PrismaTransactionClient) {
    return tx.purchaseInvoice.findFirst({ where: { id: documentId, tenantId }, include: { lines: true } });
  }

  async setApprovalStatus(tenantId: string, documentId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED', tx: PrismaTransactionClient) {
    await tx.purchaseInvoice.update({ where: { id: documentId }, data: { approvalStatus: status } });
  }

  async planSteps(tenantId: string, _organizationId: string, document: any, tx: PrismaTransactionClient): Promise<ApprovalStepPlanItem[]> {
    for (const line of document.lines ?? []) {
      const sourcePrice = await this.resolveSourcePrice(tenantId, line, tx);
      if (!sourcePrice || sourcePrice.eq(0)) continue;
      const invoicePrice = new Decimal(line.price.toString());
      const diffPercent = invoicePrice.minus(sourcePrice).abs().div(sourcePrice).mul(100);
      if (diffPercent.gt(PURCHASE_INVOICE_PRICE_VARIANCE_TOLERANCE_PERCENT)) {
        return [{ sequence: 1, stepType: 'ACCOUNTING' }];
      }
    }
    return [];
  }

  async resolveApprover(tenantId: string, _organizationId: string, stepType: ApprovalStepType, _document: any, userId: string, tx: PrismaTransactionClient): Promise<boolean> {
    if (stepType !== 'ACCOUNTING') return false;
    return userHasRole(tenantId, userId, ACCOUNTING_ROLE, tx);
  }

  getCreatedBy(document: any): string | null {
    return document.createdBy ?? null;
  }

  private async resolveSourcePrice(tenantId: string, line: any, tx: PrismaTransactionClient): Promise<Decimal | null> {
    if (line.goodsReceiptLineId) {
      const grLine = await tx.goodsReceiptLine.findFirst({ where: { id: line.goodsReceiptLineId, tenantId } });
      if (grLine) return new Decimal(grLine.price.toString());
    }
    if (line.supplierOrderLineId) {
      const poLine = await tx.purchaseOrderLine.findFirst({ where: { id: line.supplierOrderLineId, tenantId } });
      if (poLine?.price != null) return new Decimal(poLine.price.toString());
    }
    return null;
  }
}
