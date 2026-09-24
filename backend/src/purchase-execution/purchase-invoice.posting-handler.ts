import { Injectable } from '@nestjs/common';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { grniClearingAmount } from '../inventory-costing/cost-source.service';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { PurchaseInvoiceHasReturnsError, PurchaseInvoiceQuantityExceedsSourceError, ValidationAppError } from '../common/errors/app-error';
import { PURCHASE_INVOICE_TYPE } from './purchase-invoice.repository';
import { GOODS_RECEIPT_TYPE } from './goods-receipt.repository';
import { PURCHASE_ORDER_TYPE } from '../procurement/purchase-order.repository';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { PurchaseFulfillmentService, RelationTypes } from './purchase-fulfillment.service';
import { FixedAssetsIntegrationService } from '../fixed-assets/fixed-assets-integration.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';
const EXPENSE_LIKE_TYPES = ['SERVICE', 'EXPENSE', 'FIXED_ASSET', 'PREPAYMENT', 'OTHER'];

/**
 * Posting handler for PurchaseInvoice — the purchase-side mirror of
 * SalesInvoicePostingHandler (spec sections 6-10). Real input VAT via
 * TaxRegisterService and a real Accounts Payable consequence:
 *
 *   Receipt-linked INVENTORY line:
 *     Dr Goods Received Not Invoiced (GRNI clearing)   line net
 *   Non-receipt INVENTORY line (spec's "Invoice without Goods Receipt"):
 *     Dr Inventory (GOODS_INVENTORY)                   line net
 *   SERVICE/EXPENSE/FIXED_ASSET/PREPAYMENT/OTHER line:
 *     Dr expenseAccountId, else ADMIN_EXPENSE           line net
 *   Every taxable line:
 *     Dr Recoverable/Non-recoverable Input VAT (via Tax Register)
 *   Always:
 *     Cr Accounts Payable (SUPPLIER_PAYABLE)            gross total
 *
 * A receipt-linked line is NEVER debited to inventory again here — the
 * physical GoodsReceipt already did that at receipt time (Model A); this
 * posting only clears the GRNI clearing liability that created. Only
 * GoodsReceipt/PurchaseReturn ever write a physical inventory quantity
 * movement — PurchaseInvoice posts VALUE only, matching the platform's
 * "one register writes quantity" rule from Sales Execution.
 */
@Injectable()
export class PurchaseInvoicePostingHandler implements DocumentPostingHandler {
  readonly documentType = PURCHASE_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
    private readonly mappings: AccountingMappingService,
    private readonly fulfillment: PurchaseFulfillmentService,
    private readonly costing: InventoryCostingService,
    private readonly fixedAssets: FixedAssetsIntegrationService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const invoice = await tx.purchaseInvoice.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');
    if ((invoice as any).approvalStatus !== 'APPROVED' && (invoice as any).approvalStatus !== 'NOT_REQUIRED') {
      throw new ValidationAppError('Cannot post a purchase invoice until its price-variance approval is resolved');
    }
    if (invoice.lines.length === 0) throw new ValidationAppError('Cannot post a purchase invoice with no lines');

    for (const line of invoice.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a purchase invoice line with non-positive quantity');
      if (line.price.lt(0)) throw new ValidationAppError('Cannot post a purchase invoice line with negative price');

      if (line.goodsReceiptLineId) {
        const remaining = await this.fulfillment.remainingToInvoice(tenantId, 'GOODS_RECEIPT_LINE', line.goodsReceiptLineId, tx);
        if (new Decimal(line.quantity.toString()).gt(remaining)) {
          throw new PurchaseInvoiceQuantityExceedsSourceError(remaining.toFixed(6), line.quantity.toString());
        }
      } else if (line.supplierOrderLineId) {
        const remaining = await this.fulfillment.remainingToInvoice(tenantId, 'SUPPLIER_ORDER_LINE', line.supplierOrderLineId, tx);
        if (new Decimal(line.quantity.toString()).gt(remaining)) {
          throw new PurchaseInvoiceQuantityExceedsSourceError(remaining.toFixed(6), line.quantity.toString());
        }
      }
    }

    const supplier = await tx.counterparty.findFirst({ where: { id: invoice.counterpartyId, tenantId } });
    if (!supplier || !supplier.active) throw new ValidationAppError('Cannot post a purchase invoice for a missing or inactive supplier');
  }

  async buildMovements(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<RegisterMovementInput[]> {
    const invoice = await tx.purchaseInvoice.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');

    return invoice.lines.map((line) => ({
      registerCode: 'PURCHASE_SETTLEMENT_REGISTER',
      recorderLineId: line.id,
      businessDate: document.postingDate ?? document.documentDate,
      movementType: 'PAYABLE_ACCRUAL',
      dimensions: { organizationId: document.organizationId ?? null, counterpartyId: invoice.counterpartyId, productId: line.productId, lineType: line.lineType },
      resources: { quantity: line.quantity.toString(), price: line.price.toString(), lineTotal: line.lineTotal.toString(), taxAmount: line.taxAmount.toString(), lineTotalWithTax: line.lineTotalWithTax.toString(), currencyId: invoice.currencyId },
    }));
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const invoice = await tx.purchaseInvoice.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');

    const organizationId = document.organizationId!;
    const businessDate = document.postingDate ?? document.documentDate;
    const taxPointDate = invoice.taxPointDate ?? businessDate;

    let currencyId = invoice.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) throw new ValidationAppError('Cannot post a purchase invoice: no currency on the invoice, organization, or tenant');

    const taxResults = [];
    for (const line of invoice.lines) {
      let taxCategoryCode = DEFAULT_TAX_CATEGORY;
      if (line.productId) {
        const profile = await tx.productTaxProfile.findFirst({
          where: { tenantId, productId: line.productId, active: true, validFrom: { lte: taxPointDate }, OR: [{ validTo: null }, { validTo: { gte: taxPointDate } }], AND: [{ OR: [{ organizationId }, { organizationId: null }] }] },
          include: { taxCategory: true },
          orderBy: { validFrom: 'desc' },
        });
        taxCategoryCode = profile?.taxCategory.code ?? DEFAULT_TAX_CATEGORY;
      }

      const result = await this.taxCalculation.calculateLine(
        { tenantId, organizationId, businessDate, taxPointDate, operationType: 'PURCHASE', taxCategoryCode, taxpayerSide: 'BUYER' },
        { sourceLineId: line.id, amount: line.lineTotal, priceIncludesTax: false, currency: currencyId },
        tx,
      );
      taxResults.push(result);
    }

    const { accountingLines: vatLines } = await this.taxRegister.registerTaxable(
      tenantId,
      document.postedBy ?? document.createdBy ?? 'system',
      { organizationId, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: document.id, taxPointDate, currencyId, operationType: 'PURCHASE', lines: taxResults },
      tx,
    );

    const grni = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_RECEIVED_NOT_INVOICED, businessDate, tx);
    const inventoryAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
    const adminExpense = await this.mappings.resolve(tenantId, organizationId, MappingKeys.ADMIN_EXPENSE, businessDate, tx);
    const payable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, businessDate, tx);
    const faLines = invoice.lines.filter((l) => l.lineType === 'FIXED_ASSET' && !l.expenseAccountId);
    if (faLines.length > 0) await this.fixedAssets.prepare(tenantId);
    const faCip = faLines.length > 0 ? await this.mappings.resolve(tenantId, organizationId, MappingKeys.FA_CIP, businessDate, tx) : adminExpense;

    const debitLines: AccountingPostingLineInput[] = [];
    for (const [i, line] of invoice.lines.entries()) {
      let net = taxResults[i].taxableBase;
      let accountId: string;
      const dimensions: AccountingPostingLineInput['dimensions'] = [];
      if (line.lineType === 'FIXED_ASSET' && !line.expenseAccountId) {
        // Phase 16: a fixed-asset purchase is NOT expensed — it lands on the
        // CIP / acquisition-clearing account and becomes an acquisition
        // candidate for a capitalization decision (never an asset directly).
        accountId = faCip.id;
        if (line.departmentId) dimensions.push({ dimensionCode: 'DEPARTMENT', referenceId: line.departmentId });
      } else if (EXPENSE_LIKE_TYPES.includes(line.lineType)) {
        accountId = line.expenseAccountId ?? adminExpense.id;
        if (line.departmentId) dimensions.push({ dimensionCode: 'DEPARTMENT', referenceId: line.departmentId });
      } else if (line.goodsReceiptLineId) {
        accountId = grni.id; // clears the receipt's own GRNI liability, not a second inventory debit
        // Purchase price difference (Costing spec section 18): clear GRNI
        // at exactly what the receipt credited for this quantity and book
        // the invoice/receipt price difference to inventory — never leave
        // it stranded on GRNI. The costing engine splits it between stock
        // still on hand and stock already sold.
        const receiptLine = await tx.goodsReceiptLine.findFirst({ where: { id: line.goodsReceiptLineId, tenantId }, include: { goodsReceipt: { select: { warehouseId: true } } } });
        if (receiptLine) {
          const clearing = grniClearingAmount(receiptLine, line.quantity.toString());
          const difference = new Decimal(net).minus(clearing);
          if (!difference.isZero()) {
            debitLines.push({
              accountId: inventoryAccount.id,
              side: difference.gt(0) ? 'DEBIT' : 'CREDIT',
              amountBase: difference.abs(),
              sourceDocumentLineId: line.id,
              description: `Purchase price difference vs receipt — line ${i + 1}`,
              dimensions: [
                ...(line.productId ? [{ dimensionCode: 'PRODUCT', referenceId: line.productId }] : []),
                { dimensionCode: 'WAREHOUSE', referenceId: receiptLine.warehouseId ?? receiptLine.goodsReceipt.warehouseId },
              ],
            });
            net = clearing;
          }
        }
        if (line.productId) dimensions.push({ dimensionCode: 'PRODUCT', referenceId: line.productId });
        dimensions.push(
          { dimensionCode: 'PARTNER', referenceId: invoice.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: invoice.counterpartyId },
          { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: invoice.id },
          { dimensionCode: 'CURRENCY', referenceId: currencyId },
        );
      } else {
        accountId = inventoryAccount.id;
        if (line.productId) dimensions.push({ dimensionCode: 'PRODUCT', referenceId: line.productId });
        if (line.warehouseId) dimensions.push({ dimensionCode: 'WAREHOUSE', referenceId: line.warehouseId });
      }
      debitLines.push({ accountId, side: 'DEBIT', amountBase: net, sourceDocumentLineId: line.id, description: `Purchase invoice line ${i + 1}`, dimensions });
    }

    const grossTotal = taxResults.reduce((sum, r) => sum.plus(r.grossAmount), new Decimal(0));

    const lines: AccountingPostingLineInput[] = [
      ...debitLines,
      ...vatLines,
      {
        accountId: payable.id,
        side: 'CREDIT',
        amountBase: grossTotal,
        transactionCurrencyId: currencyId,
        description: `Accounts payable — invoice ${invoice.number ?? invoice.id}`,
        dimensions: [
          { dimensionCode: 'PARTNER', referenceId: invoice.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: invoice.counterpartyId },
          { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: invoice.id },
          { dimensionCode: 'CURRENCY', referenceId: currencyId },
        ],
      },
    ];

    // Traceability (spec sections 7, 25).
    for (const line of invoice.lines) {
      if (line.goodsReceiptLineId) {
        const receiptLine = await tx.goodsReceiptLine.findFirst({ where: { id: line.goodsReceiptLineId, tenantId } });
        if (receiptLine) {
          await tx.documentLineLink.create({
            data: { tenantId, sourceDocumentType: GOODS_RECEIPT_TYPE, sourceDocumentId: receiptLine.goodsReceiptId, sourceLineId: line.goodsReceiptLineId, targetDocumentType: PURCHASE_INVOICE_TYPE, targetDocumentId: invoice.id, targetLineId: line.id, quantity: line.quantity, relationType: RelationTypes.RECEIPT_TO_INVOICE },
          });
        }
      } else if (line.supplierOrderLineId) {
        const orderLine = await tx.purchaseOrderLine.findFirst({ where: { id: line.supplierOrderLineId, tenantId } });
        if (orderLine) {
          await tx.documentLineLink.create({
            data: { tenantId, sourceDocumentType: PURCHASE_ORDER_TYPE, sourceDocumentId: orderLine.purchaseOrderId, sourceLineId: line.supplierOrderLineId, targetDocumentType: PURCHASE_INVOICE_TYPE, targetDocumentId: invoice.id, targetLineId: line.id, quantity: line.quantity, relationType: RelationTypes.SUPPLIER_ORDER_TO_INVOICE },
          });
        }
      }
    }

    if (faLines.length > 0) {
      await this.fixedAssets.onPurchaseInvoicePosted(tx, {
        tenantId,
        organizationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        invoiceDate: businessDate,
        supplierId: invoice.counterpartyId,
        currencyId,
        userId: document.postedBy ?? document.createdBy,
        lines: faLines.map((line) => {
          const r = taxResults[invoice.lines.indexOf(line)];
          return { lineId: line.id, productId: line.productId, description: line.description ?? `Purchase invoice ${invoice.number ?? invoice.id} line ${line.position + 1}`, quantity: line.quantity.toString(), netAmount: r.taxableBase, taxAmount: r.taxAmount, nonRecoverableTaxAmount: r.nonrecoverableAmount };
        }),
      });
    }

    await tx.supplierPayable.create({
      data: { tenantId, organizationId, counterpartyId: invoice.counterpartyId, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: invoice.id, currencyId, invoiceAmount: grossTotal.toString(), dueDate: invoice.dueDate },
    });

    await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { taxPointDate, amountDue: grossTotal.toString() } });

    // Receipt cost becomes FINAL at the invoice price (spec 16-18).
    const receiptLineIds = invoice.lines.map((l) => l.goodsReceiptLineId).filter((x): x is string => !!x);
    await this.costing.onIncomingValueChanged(tenantId, receiptLineIds, { type: PURCHASE_INVOICE_TYPE, id: invoice.id, reason: 'LATE_INVOICE_DIFFERENCE', direction: 'POSTING' }, tx, document.postedBy ?? document.createdBy ?? 'system');

    return { description: `Purchase invoice ${invoice.number ?? invoice.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const activeReturn = await tx.purchaseReturn.findFirst({ where: { tenantId, originalPurchaseInvoiceId: document.id, postingStatus: 'POSTED' } });
    if (activeReturn) throw new PurchaseInvoiceHasReturnsError(document.id);

    await this.fixedAssets.onPurchaseInvoiceUnposted(tx, tenantId, document.id);
    await tx.supplierPayable.deleteMany({ where: { tenantId, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: document.id } });
    const receiptLineIds = (await tx.purchaseInvoiceLine.findMany({ where: { tenantId, purchaseInvoiceId: document.id, goodsReceiptLineId: { not: null } }, select: { goodsReceiptLineId: true } })).map((l) => l.goodsReceiptLineId!);
    await this.costing.onIncomingValueChanged(tenantId, receiptLineIds, { type: PURCHASE_INVOICE_TYPE, id: document.id, reason: 'LATE_INVOICE_DIFFERENCE', direction: 'UNPOSTING' }, tx, document.postedBy ?? document.createdBy ?? 'system');
    await tx.documentLineLink.deleteMany({ where: { tenantId, targetDocumentType: PURCHASE_INVOICE_TYPE, targetDocumentId: document.id, relationType: { in: [RelationTypes.RECEIPT_TO_INVOICE, RelationTypes.SUPPLIER_ORDER_TO_INVOICE] } } });
  }
}
