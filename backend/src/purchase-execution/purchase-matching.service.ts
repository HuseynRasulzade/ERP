import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundAppError } from '../common/errors/app-error';

export interface MatchingLineResult {
  invoiceLineId: string;
  productId: string | null;
  orderedQty: string | null;
  orderPrice: string | null;
  receivedQty: string | null;
  invoicedQty: string;
  invoicePrice: string;
  status: 'MATCHED' | 'QUANTITY_MISMATCH' | 'PRICE_MISMATCH' | 'OVER_INVOICED' | 'RECEIPT_MISSING' | 'ORDER_MISSING';
}

export type OverallMatchingStatus = 'MATCHED' | 'QUANTITY_MISMATCH' | 'PRICE_MISMATCH' | 'OVER_INVOICED' | 'RECEIPT_MISSING' | 'ORDER_MISSING' | 'MANUAL_REVIEW_REQUIRED';

/**
 * PurchaseMatchingService (spec sections 8, 54). Three-way comparison —
 * Supplier Order vs Goods Receipt vs Purchase Invoice — computed LIVE,
 * never a posting gate in this build (spec's own tolerance/approval
 * configuration is deferred — see docs/PURCHASE_EXECUTION.md). Tolerance
 * is 0 (any difference beyond currency rounding counts as a mismatch) —
 * a disclosed simplification of the spec's configurable
 * quantity/price/amount tolerance.
 */
@Injectable()
export class PurchaseMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async compute(tenantId: string, membershipId: string, organizationId: string, purchaseInvoiceId: string): Promise<{ overallStatus: OverallMatchingStatus; lines: MatchingLineResult[] }> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const invoice = await this.prisma.purchaseInvoice.findFirst({ where: { id: purchaseInvoiceId, organizationId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!invoice) throw new NotFoundAppError('PurchaseInvoice', purchaseInvoiceId);

    const lines: MatchingLineResult[] = [];
    for (const line of invoice.lines) {
      if (line.lineType !== 'INVENTORY' && line.lineType !== 'SERVICE') continue; // expense-like lines have no order/receipt to match

      let goodsReceiptLine = null;
      if (line.goodsReceiptLineId) {
        goodsReceiptLine = await this.prisma.goodsReceiptLine.findFirst({ where: { id: line.goodsReceiptLineId, tenantId } });
      }
      const supplierOrderLineId = line.supplierOrderLineId ?? goodsReceiptLine?.supplierOrderLineId ?? null;
      const orderLine = supplierOrderLineId ? await this.prisma.purchaseOrderLine.findFirst({ where: { id: supplierOrderLineId, tenantId } }) : null;

      const invoicedQty = new Decimal(line.quantity.toString());
      const invoicePrice = new Decimal(line.price.toString());
      const orderedQty = orderLine ? new Decimal(orderLine.quantity.toString()) : null;
      const orderPrice = orderLine ? new Decimal(orderLine.price.toString()) : null;
      const receivedQty = goodsReceiptLine ? new Decimal(goodsReceiptLine.quantity.toString()) : null;

      let status: MatchingLineResult['status'] = 'MATCHED';
      if (!orderLine) status = 'ORDER_MISSING';
      else if (!goodsReceiptLine && !line.goodsReceiptLineId) status = 'RECEIPT_MISSING';

      if (orderedQty && invoicedQty.gt(orderedQty)) status = 'OVER_INVOICED';
      else if ((orderedQty && !invoicedQty.eq(orderedQty)) || (receivedQty && !invoicedQty.eq(receivedQty))) {
        if (status === 'MATCHED') status = 'QUANTITY_MISMATCH';
      }
      if (status === 'MATCHED' && orderPrice && !invoicePrice.eq(orderPrice)) status = 'PRICE_MISMATCH';

      lines.push({
        invoiceLineId: line.id,
        productId: line.productId,
        orderedQty: orderedQty?.toString() ?? null,
        orderPrice: orderPrice?.toString() ?? null,
        receivedQty: receivedQty?.toString() ?? null,
        invoicedQty: invoicedQty.toString(),
        invoicePrice: invoicePrice.toString(),
        status,
      });
    }

    const overallStatus = deriveOverallStatus(lines);
    return { overallStatus, lines };
  }

  /** Computes and persists a `PurchaseMatchingResult` snapshot (spec's
   * `purchase_matching_results` table) — explicit, on-demand, never
   * automatic on every posting (see class docstring). */
  async checkAndPersist(tenantId: string, membershipId: string, organizationId: string, purchaseInvoiceId: string, userId: string) {
    const result = await this.compute(tenantId, membershipId, organizationId, purchaseInvoiceId);
    const row = await this.prisma.purchaseMatchingResult.create({
      data: { tenantId, purchaseInvoiceId, overallStatus: result.overallStatus, details: result.lines as any, computedBy: userId },
    });
    await this.audit.record({ tenantId, eventType: 'PURCHASE_MATCHING_CHECKED', entityType: 'PurchaseMatchingResult', entityId: row.id, action: 'CREATE', userId, newValues: { purchaseInvoiceId, overallStatus: result.overallStatus } });
    if (result.overallStatus !== 'MATCHED') {
      await this.audit.record({ tenantId, eventType: 'PURCHASE_MATCHING_FAILED', entityType: 'PurchaseInvoice', entityId: purchaseInvoiceId, action: 'UPDATE', userId, newValues: { overallStatus: result.overallStatus } });
    }
    return row;
  }

  history(tenantId: string, purchaseInvoiceId: string) {
    return this.prisma.purchaseMatchingResult.findMany({ where: { tenantId, purchaseInvoiceId }, orderBy: { computedAt: 'desc' } });
  }
}

function deriveOverallStatus(lines: MatchingLineResult[]): OverallMatchingStatus {
  if (lines.length === 0) return 'MANUAL_REVIEW_REQUIRED';
  if (lines.some((l) => l.status === 'OVER_INVOICED')) return 'OVER_INVOICED';
  if (lines.some((l) => l.status === 'ORDER_MISSING')) return 'ORDER_MISSING';
  if (lines.some((l) => l.status === 'RECEIPT_MISSING')) return 'RECEIPT_MISSING';
  if (lines.some((l) => l.status === 'QUANTITY_MISMATCH')) return 'QUANTITY_MISMATCH';
  if (lines.some((l) => l.status === 'PRICE_MISMATCH')) return 'PRICE_MISMATCH';
  return 'MATCHED';
}
