import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';

export interface ReportDateRange {
  fromDate: Date;
  toDate: Date;
}

/**
 * PurchaseReportingService (spec section 39). Live queries over posted
 * documents — no separate reporting warehouse/materialized table. Covers
 * the subset of spec section 39's report list this build implements in
 * full (Purchase Register, Supplier Invoice Register, GRNI, Price
 * Variance, Returns); Supplier Purchase Analysis and the dashboard
 * metrics of section 40 are deferred — see docs/PURCHASE_EXECUTION.md.
 */
@Injectable()
export class PurchaseReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  /** Purchase Register (spec section 39): every posted GoodsReceipt +
   * PurchaseInvoice line in range, quantity/net/VAT/gross. */
  async purchaseRegister(tenantId: string, membershipId: string, organizationId: string, range: ReportDateRange, counterpartyId?: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { organizationId, postingStatus: 'POSTED', documentDate: { gte: range.fromDate, lte: range.toDate }, ...(counterpartyId ? { counterpartyId } : {}) },
      include: { lines: true },
      orderBy: { documentDate: 'asc' },
    });

    return invoices.flatMap((inv) =>
      inv.lines.map((l) => ({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        documentDate: inv.documentDate.toISOString().slice(0, 10),
        counterpartyId: inv.counterpartyId,
        productId: l.productId,
        quantity: l.quantity.toString(),
        netAmount: l.lineTotal.toString(),
        vat: l.taxAmount.toString(),
        grossAmount: l.lineTotalWithTax.toString(),
        currencyId: inv.currencyId,
      })),
    );
  }

  /** Supplier Invoice Register (spec section 39). */
  async supplierInvoiceRegister(tenantId: string, membershipId: string, organizationId: string, range: ReportDateRange) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { organizationId, postingStatus: 'POSTED', documentDate: { gte: range.fromDate, lte: range.toDate } },
      orderBy: { documentDate: 'asc' },
    });
    const payables = await this.prisma.supplierPayable.findMany({ where: { organizationId, sourceDocumentType: 'PURCHASE_INVOICE', sourceDocumentId: { in: invoices.map((i) => i.id) } } });
    const payableByInvoice = new Map(payables.map((p) => [p.sourceDocumentId, p]));

    return invoices.map((inv) => {
      const payable = payableByInvoice.get(inv.id);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        counterpartyId: inv.counterpartyId,
        invoiceDate: inv.documentDate.toISOString().slice(0, 10),
        dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
        total: inv.grandTotal.toString(),
        paid: payable ? payable.paidAmount.toString() : '0.00',
        outstanding: payable ? new Decimal(payable.invoiceAmount.toString()).minus(payable.paidAmount.toString()).toFixed(2) : inv.grandTotal.toString(),
      };
    });
  }

  /** Goods Received Not Invoiced report (spec section 39): received
   * value vs invoiced value per goods receipt line — the remainder is
   * still sitting in the GRNI clearing account. */
  async goodsReceivedNotInvoiced(tenantId: string, membershipId: string, organizationId: string) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const receiptLines = await this.prisma.goodsReceiptLine.findMany({
      where: { tenantId, goodsReceipt: { organizationId, postingStatus: 'POSTED' } },
      include: { goodsReceipt: true },
    });

    const results = [];
    for (const line of receiptLines) {
      const receivedAmount = new Decimal(line.lineTotal.toString());
      const invoicedLines = await this.prisma.purchaseInvoiceLine.findMany({ where: { tenantId, goodsReceiptLineId: line.id, purchaseInvoice: { postingStatus: 'POSTED' } } });
      const invoicedAmount = invoicedLines.reduce((s, l) => s.plus(l.lineTotal.toString()), new Decimal(0));
      const remaining = receivedAmount.minus(invoicedAmount);
      if (remaining.lte(0)) continue;
      results.push({
        goodsReceiptId: line.goodsReceiptId,
        goodsReceiptNumber: line.goodsReceipt.number,
        goodsReceiptLineId: line.id,
        productId: line.productId,
        receivedAmount: receivedAmount.toFixed(2),
        invoicedAmount: invoicedAmount.toFixed(2),
        remainingUninvoicedAmount: remaining.toFixed(2),
      });
    }
    return results;
  }

  /** Purchase Price Variance (spec section 39): order price vs invoice
   * price, per invoice line linked to a Supplier Order line. */
  async purchasePriceVariance(tenantId: string, membershipId: string, organizationId: string, range: ReportDateRange) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { organizationId, postingStatus: 'POSTED', documentDate: { gte: range.fromDate, lte: range.toDate } },
      include: { lines: true },
    });

    const results = [];
    for (const inv of invoices) {
      for (const line of inv.lines) {
        let orderLineId = line.supplierOrderLineId;
        if (!orderLineId && line.goodsReceiptLineId) {
          const grLine = await this.prisma.goodsReceiptLine.findFirst({ where: { id: line.goodsReceiptLineId, tenantId } });
          orderLineId = grLine?.supplierOrderLineId ?? null;
        }
        if (!orderLineId) continue;
        const orderLine = await this.prisma.purchaseOrderLine.findFirst({ where: { id: orderLineId, tenantId } });
        if (!orderLine) continue;

        const orderPrice = new Decimal(orderLine.price.toString());
        const invoicePrice = new Decimal(line.price.toString());
        const diff = invoicePrice.minus(orderPrice);
        if (diff.isZero()) continue;
        results.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          productId: line.productId,
          orderPrice: orderPrice.toString(),
          invoicePrice: invoicePrice.toString(),
          difference: diff.toFixed(6),
          differencePercent: orderPrice.gt(0) ? diff.div(orderPrice).mul(100).toFixed(2) : null,
        });
      }
    }
    return results;
  }

  /** Purchase Returns report (spec section 39). */
  async purchaseReturns(tenantId: string, membershipId: string, organizationId: string, range: ReportDateRange) {
    await this.access.assertAccess(tenantId, membershipId, organizationId);
    const returns = await this.prisma.purchaseReturn.findMany({
      where: { organizationId, postingStatus: 'POSTED', documentDate: { gte: range.fromDate, lte: range.toDate } },
      include: { lines: true },
    });
    return returns.flatMap((r) =>
      r.lines.map((l) => ({
        returnId: r.id,
        returnNumber: r.number,
        counterpartyId: r.counterpartyId,
        productId: l.productId,
        quantity: l.quantity.toString(),
        returnAmount: l.returnGross.toString(),
        reason: l.reason ?? r.returnReason,
      })),
    );
  }
}
