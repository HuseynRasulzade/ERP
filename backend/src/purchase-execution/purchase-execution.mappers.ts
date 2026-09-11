import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateBasedOnMapper } from '../document-link/create-based-on.interfaces';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { PURCHASE_ORDER_TYPE } from '../procurement/purchase-order.repository';
import { GOODS_RECEIPT_TYPE } from './goods-receipt.repository';
import { PURCHASE_INVOICE_TYPE } from './purchase-invoice.repository';
import { PURCHASE_RETURN_TYPE } from './purchase-return.repository';
import { PurchaseFulfillmentService } from './purchase-fulfillment.service';

async function ensureSequence(prisma: PrismaService, tenantId: string, documentType: string, prefix: string) {
  const existing = await prisma.numberSequence.findUnique({ where: { tenantId_code: { tenantId, code: documentType } } });
  if (existing) return;
  try {
    await prisma.numberSequence.create({ data: { tenantId, code: documentType, documentType, prefix, padding: 6, resetPolicy: 'YEARLY' } });
  } catch {
    // Lost the race to create it concurrently.
  }
}

/**
 * PURCHASE_ORDER => GOODS_RECEIPT (spec section 25). Defaults every goods
 * line to its remaining-to-receive quantity only — never the full
 * original order quantity — mirroring SalesOrderToShipmentMapper exactly.
 */
@Injectable()
export class SupplierOrderToGoodsReceiptMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = PURCHASE_ORDER_TYPE;
  readonly targetDocumentType = GOODS_RECEIPT_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly fulfillment: PurchaseFulfillmentService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;
    const order = await client.purchaseOrder.findFirst({ where: { id: source.id, tenantId: source.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!order) throw new ValidationAppError(`Supplier order not found: ${source.id}`);
    if (!order.warehouseId) throw new ValidationAppError('Supplier order has no warehouse — set one before creating a goods receipt from it');

    const lines = [];
    for (const line of order.lines) {
      if (line.isService) continue; // services never receive physical goods
      const remaining = await this.fulfillment.remainingToReceive(source.tenantId, line.id, tx as PrismaTransactionClient | undefined);
      if (remaining.lte(0)) continue;
      lines.push({ supplierOrderLineId: line.id, productId: line.productId, unitId: line.unitId, quantity: remaining.toString(), price: line.price.toString(), lineTotal: remaining.mul(line.price.toString()).toDecimalPlaces(2).toString(), warehouseId: line.warehouseId ?? order.warehouseId });
    }
    if (lines.length === 0) throw new ValidationAppError('This supplier order has no remaining receivable goods lines');

    await ensureSequence(this.prisma, source.tenantId, GOODS_RECEIPT_TYPE, 'GR');
    const allocated = await this.numbering.allocateNumber(source.tenantId, GOODS_RECEIPT_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: order.organizationId,
      counterpartyId: order.counterpartyId,
      warehouseId: order.warehouseId,
      supplierOrderId: order.id,
      currencyId: order.currencyId,
      number: allocated.formatted,
      documentDate: new Date(),
      description: `Based on supplier order ${order.number ?? order.id}`,
      lines,
    };
  }
}

/** PURCHASE_ORDER => PURCHASE_INVOICE (spec section 25) — the "Supplier
 * Order -> Purchase Invoice" flow without a Goods Receipt in between. */
@Injectable()
export class SupplierOrderToPurchaseInvoiceMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = PURCHASE_ORDER_TYPE;
  readonly targetDocumentType = PURCHASE_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly fulfillment: PurchaseFulfillmentService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;
    const order = await client.purchaseOrder.findFirst({ where: { id: source.id, tenantId: source.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!order) throw new ValidationAppError(`Supplier order not found: ${source.id}`);

    const lines = [];
    for (const line of order.lines) {
      const remaining = await this.fulfillment.remainingToInvoice(source.tenantId, 'SUPPLIER_ORDER_LINE', line.id, tx as PrismaTransactionClient | undefined);
      if (remaining.lte(0)) continue;
      const net = remaining.mul(line.price.toString()).toDecimalPlaces(2);
      const tax = net.mul(line.taxRate.toString()).div(100).toDecimalPlaces(2);
      lines.push({ supplierOrderLineId: line.id, lineType: line.isService ? 'SERVICE' : 'INVENTORY', productId: line.productId, unitId: line.unitId, quantity: remaining.toString(), price: line.price.toString(), lineTotal: net.toString(), taxRate: line.taxRate.toString(), taxAmount: tax.toString(), lineTotalWithTax: net.plus(tax).toString(), warehouseId: line.warehouseId ?? order.warehouseId });
    }
    if (lines.length === 0) throw new ValidationAppError('This supplier order has no remaining invoiceable lines');

    const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const taxTotal = lines.reduce((s, l) => s + Number(l.taxAmount), 0);

    await ensureSequence(this.prisma, source.tenantId, PURCHASE_INVOICE_TYPE, 'PI');
    const allocated = await this.numbering.allocateNumber(source.tenantId, PURCHASE_INVOICE_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: order.organizationId,
      counterpartyId: order.counterpartyId,
      supplierOrderId: order.id,
      currencyId: order.currencyId,
      number: allocated.formatted,
      documentDate: new Date(),
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      grandTotal: (subtotal + taxTotal).toFixed(2),
      description: `Based on supplier order ${order.number ?? order.id}`,
      lines,
    };
  }
}

/** GOODS_RECEIPT => PURCHASE_INVOICE (spec section 25) — every field
 * (supplier, contract-equivalent, currency, products, quantity,
 * warehouse, linked receipt lines) inherited from the receipt, capped at
 * its remaining invoiceable quantity. */
@Injectable()
export class GoodsReceiptToPurchaseInvoiceMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = GOODS_RECEIPT_TYPE;
  readonly targetDocumentType = PURCHASE_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly fulfillment: PurchaseFulfillmentService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;
    const receipt = await client.goodsReceipt.findFirst({ where: { id: source.id, tenantId: source.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!receipt) throw new ValidationAppError(`Goods receipt not found: ${source.id}`);

    const lines = [];
    for (const line of receipt.lines) {
      const remaining = await this.fulfillment.remainingToInvoice(source.tenantId, 'GOODS_RECEIPT_LINE', line.id, tx as PrismaTransactionClient | undefined);
      if (remaining.lte(0)) continue;
      const net = remaining.mul(line.price.toString()).toDecimalPlaces(2);
      lines.push({ goodsReceiptLineId: line.id, supplierOrderLineId: line.supplierOrderLineId, lineType: 'INVENTORY', productId: line.productId, unitId: line.unitId, quantity: remaining.toString(), price: line.price.toString(), lineTotal: net.toString(), taxRate: '0', taxAmount: '0', lineTotalWithTax: net.toString(), warehouseId: line.warehouseId ?? receipt.warehouseId });
    }
    if (lines.length === 0) throw new ValidationAppError('This goods receipt has no remaining invoiceable lines');

    const subtotal = lines.reduce((s, l) => s + Number(l.lineTotal), 0);

    await ensureSequence(this.prisma, source.tenantId, PURCHASE_INVOICE_TYPE, 'PI');
    const allocated = await this.numbering.allocateNumber(source.tenantId, PURCHASE_INVOICE_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: receipt.organizationId,
      counterpartyId: receipt.counterpartyId,
      supplierOrderId: receipt.supplierOrderId,
      goodsReceiptId: receipt.id,
      currencyId: receipt.currencyId,
      number: allocated.formatted,
      documentDate: new Date(),
      subtotal: subtotal.toFixed(2),
      taxTotal: '0.00',
      grandTotal: subtotal.toFixed(2),
      description: `Based on goods receipt ${receipt.number ?? receipt.id}`,
      lines,
    };
  }
}

/** GOODS_RECEIPT => PURCHASE_RETURN (spec section 25) — pre-invoice
 * return, defaults to the full returnable (not-yet-returned) quantity. */
@Injectable()
export class GoodsReceiptToPurchaseReturnMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = GOODS_RECEIPT_TYPE;
  readonly targetDocumentType = PURCHASE_RETURN_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly fulfillment: PurchaseFulfillmentService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;
    const receipt = await client.goodsReceipt.findFirst({ where: { id: source.id, tenantId: source.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!receipt) throw new ValidationAppError(`Goods receipt not found: ${source.id}`);

    const lines = [];
    for (const line of receipt.lines) {
      const max = await this.fulfillment.maxReturnable(source.tenantId, 'GOODS_RECEIPT_LINE', line.id, tx as PrismaTransactionClient | undefined);
      if (max.lte(0)) continue;
      lines.push({ sourceReceiptLineId: line.id, productId: line.productId, unitId: line.unitId, quantity: max.toString(), originalUnitPrice: line.price.toString() });
    }
    if (lines.length === 0) throw new ValidationAppError('This goods receipt has no remaining returnable lines');

    await ensureSequence(this.prisma, source.tenantId, PURCHASE_RETURN_TYPE, 'PRTN');
    const allocated = await this.numbering.allocateNumber(source.tenantId, PURCHASE_RETURN_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: receipt.organizationId,
      counterpartyId: receipt.counterpartyId,
      originalGoodsReceiptId: receipt.id,
      warehouseId: receipt.warehouseId,
      currencyId: receipt.currencyId,
      number: allocated.formatted,
      documentDate: new Date(),
      description: `Based on goods receipt ${receipt.number ?? receipt.id}`,
      lines,
    };
  }
}

/** PURCHASE_INVOICE => PURCHASE_RETURN (spec section 25) — post-invoice
 * return, defaults to the full returnable (not-yet-returned) quantity. */
@Injectable()
export class PurchaseInvoiceToPurchaseReturnMapper implements CreateBasedOnMapper<BaseDocumentFields, Record<string, unknown>> {
  readonly sourceDocumentType = PURCHASE_INVOICE_TYPE;
  readonly targetDocumentType = PURCHASE_RETURN_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly fulfillment: PurchaseFulfillmentService,
  ) {}

  async mapHeader(source: BaseDocumentFields, tx?: unknown): Promise<Record<string, unknown>> {
    const client = (tx as PrismaTransactionClient | undefined) ?? this.prisma;
    const invoice = await client.purchaseInvoice.findFirst({ where: { id: source.id, tenantId: source.tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!invoice) throw new ValidationAppError(`Purchase invoice not found: ${source.id}`);

    const lines = [];
    for (const line of invoice.lines) {
      if (!line.productId || !line.unitId) continue; // expense-like lines are never returnable stock
      const max = await this.fulfillment.maxReturnable(source.tenantId, 'PURCHASE_INVOICE_LINE', line.id, tx as PrismaTransactionClient | undefined);
      if (max.lte(0)) continue;
      lines.push({ sourceInvoiceLineId: line.id, productId: line.productId, unitId: line.unitId, quantity: max.toString(), originalUnitPrice: line.price.toString() });
    }
    if (lines.length === 0) throw new ValidationAppError('This purchase invoice has no remaining returnable lines');

    await ensureSequence(this.prisma, source.tenantId, PURCHASE_RETURN_TYPE, 'PRTN');
    const allocated = await this.numbering.allocateNumber(source.tenantId, PURCHASE_RETURN_TYPE, new Date(), tx as PrismaTransactionClient | undefined);

    return {
      organizationId: invoice.organizationId,
      counterpartyId: invoice.counterpartyId,
      originalPurchaseInvoiceId: invoice.id,
      currencyId: invoice.currencyId,
      number: allocated.formatted,
      documentDate: new Date(),
      description: `Based on purchase invoice ${invoice.number ?? invoice.id}`,
      lines,
    };
  }
}
