import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SalesOrderService } from '../sales-documents/sales-order.service';
import { SalesInvoiceService } from '../sales-documents/sales-invoice.service';
import { PurchaseOrderService } from '../procurement/purchase-order.service';
import { PaymentOrderService } from '../treasury/payment-order.service';
import { buildPrintFormPdf, buildPaymentOrderPdf } from './print-form-builder';
import type { PrintFormLine } from './print-form-builder';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator';
import { CurrentMembershipId } from '../common/decorators/current-membership.decorator';
import { PermissionCodes } from '../rbac/permission-codes';

interface RawLine {
  position: number;
  productId: string;
  unitId: string;
  quantity: unknown;
  price: unknown;
  taxRate: unknown;
  lineTotal: unknown;
  taxAmount: unknown;
  lineTotalWithTax: unknown;
}

/**
 * Simple PDF print forms (1C parity gap: "çap formaları") — one route per
 * document type rather than a fully generic renderer, since only the
 * three DocumentRepositoryAdapter.findById() shapes don't carry line
 * items; each of these already has a working `get()` with lines, so
 * reusing it is simpler than teaching the document-framework about print.
 */
@Controller('organizations/:organizationId')
export class PrintFormsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesOrders: SalesOrderService,
    private readonly salesInvoices: SalesInvoiceService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly paymentOrders: PaymentOrderService,
  ) {}

  private async resolveNames(tenantId: string, organizationId: string, counterpartyId: string, lines: RawLine[]) {
    const [org, counterparty, products, units] = await Promise.all([
      this.prisma.organization.findFirst({ where: { id: organizationId, tenantId } }),
      this.prisma.counterparty.findFirst({ where: { id: counterpartyId, organizationId } }),
      this.prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } }),
      this.prisma.unitOfMeasure.findMany({ where: { id: { in: lines.map((l) => l.unitId) } } }),
    ]);
    return {
      organizationName: org?.name ?? organizationId,
      counterpartyName: counterparty?.name ?? counterpartyId,
      productName: (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8),
      unitName: (id: string) => units.find((u) => u.id === id)?.symbol ?? units.find((u) => u.id === id)?.name ?? id.slice(0, 8),
    };
  }

  private toPrintLines(lines: RawLine[], productName: (id: string) => string, unitName: (id: string) => string): PrintFormLine[] {
    return lines.map((l) => ({
      position: l.position + 1,
      productName: productName(l.productId),
      unitName: unitName(l.unitId),
      quantity: String(l.quantity ?? ''),
      price: String(l.price ?? ''),
      taxRate: String(l.taxRate ?? ''),
      lineTotal: String(l.lineTotal ?? ''),
      taxAmount: String(l.taxAmount ?? ''),
      lineTotalWithTax: String(l.lineTotalWithTax ?? ''),
    }));
  }

  private sendPdf(res: Response, buffer: Buffer, fileName: string) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }

  @RequirePermissions(PermissionCodes.SALES_ORDER_VIEW)
  @Get('sales-orders/:id/print')
  async printSalesOrder(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.salesOrders.get(tenantId, membershipId, organizationId, id);
    const { organizationName, counterpartyName, productName, unitName } = await this.resolveNames(tenantId, organizationId, doc.counterpartyId, doc.lines as unknown as RawLine[]);
    const buffer = await buildPrintFormPdf({
      title: 'Sales Order',
      number: doc.number ?? id,
      documentDate: doc.documentDate.toISOString().slice(0, 10),
      organizationName,
      counterpartyName,
      lines: this.toPrintLines(doc.lines as unknown as RawLine[], productName, unitName),
      subtotal: String(doc.subtotal),
      taxTotal: String(doc.taxTotal),
      grandTotal: String(doc.grandTotal),
    });
    this.sendPdf(res, buffer, `${doc.number ?? id}.pdf`);
  }

  @RequirePermissions(PermissionCodes.SALES_INVOICE_VIEW)
  @Get('sales-invoices/:id/print')
  async printSalesInvoice(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.salesInvoices.get(tenantId, membershipId, organizationId, id);
    const { organizationName, counterpartyName, productName, unitName } = await this.resolveNames(tenantId, organizationId, doc.counterpartyId, doc.lines as unknown as RawLine[]);
    const buffer = await buildPrintFormPdf({
      title: 'Sales Invoice',
      number: doc.number ?? id,
      documentDate: doc.documentDate.toISOString().slice(0, 10),
      organizationName,
      counterpartyName,
      lines: this.toPrintLines(doc.lines as unknown as RawLine[], productName, unitName),
      subtotal: String(doc.subtotal),
      taxTotal: String(doc.taxTotal),
      grandTotal: String(doc.grandTotal),
    });
    this.sendPdf(res, buffer, `${doc.number ?? id}.pdf`);
  }

  @RequirePermissions(PermissionCodes.PURCHASE_ORDER_VIEW)
  @Get('purchase-orders/:id/print')
  async printPurchaseOrder(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.purchaseOrders.get(tenantId, membershipId, organizationId, id);
    const { organizationName, counterpartyName, productName, unitName } = await this.resolveNames(tenantId, organizationId, doc.counterpartyId, doc.lines as unknown as RawLine[]);
    const buffer = await buildPrintFormPdf({
      title: 'Purchase Order',
      number: doc.number ?? id,
      documentDate: doc.documentDate.toISOString().slice(0, 10),
      organizationName,
      counterpartyName,
      lines: this.toPrintLines(doc.lines as unknown as RawLine[], productName, unitName),
      subtotal: String(doc.subtotal),
      taxTotal: String(doc.taxTotal),
      grandTotal: String(doc.grandTotal),
    });
    this.sendPdf(res, buffer, `${doc.number ?? id}.pdf`);
  }

  @RequirePermissions(PermissionCodes.PAYMENT_ORDER_VIEW)
  @Get('payment-orders/:id/print')
  async printPaymentOrder(
    @CurrentTenantId() tenantId: string,
    @CurrentMembershipId() membershipId: string,
    @Param('organizationId') organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const order = await this.paymentOrders.get(tenantId, membershipId, organizationId, id);
    const [org, bankAccount, counterparty, counterpartyBankAccount] = await Promise.all([
      this.prisma.organization.findFirst({ where: { id: organizationId, tenantId } }),
      this.prisma.bankAccount.findFirst({ where: { id: order.bankAccountId, organizationId } }),
      this.prisma.counterparty.findFirst({ where: { id: order.counterpartyId, organizationId } }),
      order.counterpartyBankAccountId
        ? this.prisma.counterpartyBankAccount.findFirst({ where: { id: order.counterpartyBankAccountId } })
        : Promise.resolve(null),
    ]);
    const buffer = await buildPaymentOrderPdf({
      number: order.number ?? id,
      documentDate: order.documentDate.toISOString().slice(0, 10),
      organizationName: org?.name ?? organizationId,
      organizationBankName: bankAccount?.bankName ?? '—',
      organizationAccountIban: bankAccount?.iban ?? '—',
      counterpartyName: counterparty?.name ?? order.counterpartyId,
      counterpartyBankName: counterpartyBankAccount?.bankName,
      counterpartyAccountIban: counterpartyBankAccount?.iban ?? counterpartyBankAccount?.accountNumber,
      amount: String(order.amount),
      description: order.description ?? undefined,
    });
    this.sendPdf(res, buffer, `${order.number ?? id}.pdf`);
  }
}
