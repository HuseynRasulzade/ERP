import { Injectable } from '@nestjs/common';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import { AccountingBatchResult, DocumentPostingHandler, RegisterMovementInput } from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { PurchaseReturnQuantityExceedsReceivedError, ValidationAppError } from '../common/errors/app-error';
import { PURCHASE_RETURN_TYPE } from './purchase-return.repository';
import { PURCHASE_INVOICE_TYPE } from './purchase-invoice.repository';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { InventoryLedgerService } from '../sales-execution/inventory-ledger.service';
import { PurchaseFulfillmentService } from './purchase-fulfillment.service';
import { TaxLineResult } from '../tax-engine/tax-calculation-result';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * Posting handler for PurchaseReturn (spec sections 14-16) — the
 * purchase-side mirror of SalesReturnPostingHandler. A line linked to a
 * posted PurchaseInvoice line PRORATES its tax from that invoice's
 * original `TaxMovement` (never re-resolved against today's rule, same
 * "do not blindly apply today's VAT rule to an old purchase" principle).
 *
 * Two accounting shapes depending on how far the goods got before being
 * returned:
 *   Post-invoice return (sourceInvoiceLineId set):
 *     Dr Accounts Payable (531)         returnGross — reduces what's owed
 *     Cr Recoverable/Non-recoverable Input VAT (contra)
 *     Cr Inventory (205)                returnNet
 *   Pre-invoice return (only sourceReceiptLineId set — goods received,
 *   never invoiced yet): reverses the receipt's own GRNI entry instead,
 *   since there is no AP or VAT to touch yet:
 *     Dr Goods Received Not Invoiced (538)  returnNet
 *     Cr Inventory (205)                    returnNet
 * A physical inventory ISSUE movement is always written when a warehouse
 * is known (spec section 16: "DECREASE stock").
 */
@Injectable()
export class PurchaseReturnPostingHandler implements DocumentPostingHandler {
  readonly documentType = PURCHASE_RETURN_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
    private readonly mappings: AccountingMappingService,
    private readonly inventory: InventoryLedgerService,
    private readonly fulfillment: PurchaseFulfillmentService,
    private readonly batchSerial: BatchSerialService,
    private readonly costing: InventoryCostingService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const ret = await tx.purchaseReturn.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!ret) throw new ValidationAppError('Document disappeared during posting');
    if (ret.lines.length === 0) throw new ValidationAppError('Cannot post a purchase return with no lines');
    if (!ret.warehouseId) throw new ValidationAppError('A purchase return requires a warehouse');

    for (const line of ret.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a return line with non-positive quantity');

      if (line.sourceReceiptLineId) {
        const max = await this.fulfillment.maxReturnable(tenantId, 'GOODS_RECEIPT_LINE', line.sourceReceiptLineId, tx);
        if (new Decimal(line.quantity.toString()).gt(max)) throw new PurchaseReturnQuantityExceedsReceivedError(max.toFixed(6), line.quantity.toString());
      } else if (line.sourceInvoiceLineId) {
        const max = await this.fulfillment.maxReturnable(tenantId, 'PURCHASE_INVOICE_LINE', line.sourceInvoiceLineId, tx);
        if (new Decimal(line.quantity.toString()).gt(max)) throw new PurchaseReturnQuantityExceedsReceivedError(max.toFixed(6), line.quantity.toString());
      }
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const ret = await tx.purchaseReturn.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!ret) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = ret.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    let currencyId = ret.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) throw new ValidationAppError('Cannot post a purchase return: no currency on the return, organization, or tenant');

    // Split lines: post-invoice (VAT/AP shape) vs pre-invoice (GRNI shape).
    const invoiceLines = ret.lines.filter((l) => l.sourceInvoiceLineId);
    const receiptOnlyLines = ret.lines.filter((l) => !l.sourceInvoiceLineId);

    const lines: AccountingPostingLineInput[] = [];
    let netTotal = new Decimal(0);
    let taxTotal = new Decimal(0);
    let grossTotal = new Decimal(0);

    if (invoiceLines.length > 0) {
      const taxResults: TaxLineResult[] = [];
      for (const line of invoiceLines) {
        const originalMovement = await tx.taxMovement.findFirst({ where: { tenantId, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceLineId: line.sourceInvoiceLineId!, reversalOfMovementId: null } });
        const sourceLine = await tx.purchaseInvoiceLine.findFirst({ where: { id: line.sourceInvoiceLineId!, tenantId } });
        if (originalMovement && sourceLine && sourceLine.quantity.gt(0)) {
          const proportion = new Decimal(line.quantity.toString()).div(sourceLine.quantity.toString());
          const taxableBase = new Decimal(originalMovement.taxableBase.toString()).mul(proportion);
          const taxAmount = new Decimal(originalMovement.taxAmount.toString()).mul(proportion);
          taxResults.push({
            sourceLineId: line.id,
            taxType: originalMovement.taxType,
            taxCode: originalMovement.taxCode ?? undefined,
            treatment: originalMovement.taxTreatment,
            rate: sourceLine.taxRate,
            taxableBase,
            taxAmount,
            recoverableAmount: taxAmount,
            nonrecoverableAmount: new Decimal(0),
            grossAmount: taxableBase.plus(taxAmount),
            ruleId: originalMovement.taxRuleId,
            rateId: originalMovement.taxRateId ?? undefined,
            taxPointDate: businessDate,
            roundingAdjustment: new Decimal(0),
            explanation: `Prorated from original invoice line ${line.sourceInvoiceLineId} (${proportion.mul(100).toFixed(2)}% of ${originalMovement.taxAmount})`,
          });
          continue;
        }

        const result = await this.taxCalculation.calculateLine(
          { tenantId, organizationId, businessDate, taxPointDate: businessDate, operationType: 'PURCHASE', taxCategoryCode: DEFAULT_TAX_CATEGORY, taxpayerSide: 'BUYER' },
          { sourceLineId: line.id, amount: line.originalUnitPrice.mul(line.quantity.toString()), priceIncludesTax: false },
          tx,
        );
        taxResults.push(result);
      }

      const { accountingLines: vatLines } = await this.taxRegister.registerTaxable(
        tenantId,
        document.postedBy ?? document.createdBy ?? 'system',
        { organizationId, sourceDocumentType: PURCHASE_RETURN_TYPE, sourceDocumentId: document.id, taxPointDate: businessDate, currencyId, operationType: 'PURCHASE', contra: true, lines: taxResults },
        tx,
      );

      const payable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SUPPLIER_PAYABLE, businessDate, tx);
      const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);

      const invNet = taxResults.reduce((s, r) => s.plus(r.taxableBase), new Decimal(0));
      const invGross = taxResults.reduce((s, r) => s.plus(r.grossAmount), new Decimal(0));
      netTotal = netTotal.plus(invNet);
      grossTotal = grossTotal.plus(invGross);
      taxTotal = taxTotal.plus(invGross.minus(invNet));

      lines.push(
        { accountId: payable.id, side: 'DEBIT', amountBase: invGross, description: `Purchase return (post-invoice) — ${ret.number ?? ret.id}`, dimensions: [{ dimensionCode: 'PARTNER', referenceId: ret.counterpartyId }, { dimensionCode: 'COUNTERPARTY', referenceId: ret.counterpartyId }, { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: ret.id }, { dimensionCode: 'CURRENCY', referenceId: currencyId }] },
        ...vatLines,
        { accountId: inventory.id, side: 'CREDIT', amountBase: invNet, description: `Inventory decrease — return ${ret.number ?? ret.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: invoiceLines[0].productId }, ...(ret.warehouseId ? [{ dimensionCode: 'WAREHOUSE', referenceId: ret.warehouseId }] : [])] },
      );
    }

    if (receiptOnlyLines.length > 0) {
      const grniNet = receiptOnlyLines.reduce((s, l) => s.plus(l.originalUnitPrice.mul(l.quantity.toString()).toString()), new Decimal(0)).toDecimalPlaces(2);
      netTotal = netTotal.plus(grniNet);
      grossTotal = grossTotal.plus(grniNet);

      const grni = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_RECEIVED_NOT_INVOICED, businessDate, tx);
      const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);

      lines.push(
        {
          accountId: grni.id,
          side: 'DEBIT',
          amountBase: grniNet,
          description: `Purchase return (pre-invoice) — ${ret.number ?? ret.id}`,
          dimensions: [
            { dimensionCode: 'PARTNER', referenceId: ret.counterpartyId },
            { dimensionCode: 'COUNTERPARTY', referenceId: ret.counterpartyId },
            { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: ret.id },
            { dimensionCode: 'CURRENCY', referenceId: currencyId },
          ],
        },
        { accountId: inventory.id, side: 'CREDIT', amountBase: grniNet, description: `Inventory decrease — return ${ret.number ?? ret.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: receiptOnlyLines[0].productId }, { dimensionCode: 'WAREHOUSE', referenceId: ret.warehouseId! }] },
      );
    }

    // Physical stock decrease (spec section 16) whenever a warehouse is
    // known — always for a physical return (goods actually leave).
    if (ret.warehouseId) {
      for (const line of ret.lines) {
        const capturedSerials = await this.batchSerial.getCapturedSerials(tenantId, PURCHASE_RETURN_TYPE, line.id, tx);

        if (capturedSerials.length > 0) {
          const warehouse = await tx.warehouse.findFirst({ where: { id: ret.warehouseId, tenantId } });
          const serialIds = await this.batchSerial.issueSerials(tenantId, organizationId, line.productId, ret.warehouseId, warehouse?.code ?? ret.warehouseId, PURCHASE_RETURN_TYPE, line.id, tx);
          for (const serialId of serialIds) {
            await this.inventory.recordMovement(
              tenantId,
              { productId: line.productId, warehouseId: ret.warehouseId, quantity: '1', movementType: 'ISSUE', businessDate, sourceDocumentType: PURCHASE_RETURN_TYPE, sourceDocumentId: ret.id, sourceLineId: line.id, batchId: line.batchId, serialId },
              tx,
            );
          }
        } else {
          await this.inventory.recordMovement(
            tenantId,
            { productId: line.productId, warehouseId: ret.warehouseId, quantity: line.quantity.toString(), movementType: 'ISSUE', businessDate, sourceDocumentType: PURCHASE_RETURN_TYPE, sourceDocumentId: ret.id, sourceLineId: line.id, batchId: line.batchId },
            tx,
          );
        }
      }
    }

    // Traceability links (RECEIPT_TO_RETURN / INVOICE_TO_RETURN).
    for (const line of ret.lines) {
      if (line.sourceReceiptLineId) {
        const receiptLine = await tx.goodsReceiptLine.findFirst({ where: { id: line.sourceReceiptLineId, tenantId } });
        if (receiptLine) {
          await tx.documentLineLink.create({ data: { tenantId, sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentId: receiptLine.goodsReceiptId, sourceLineId: line.sourceReceiptLineId, targetDocumentType: PURCHASE_RETURN_TYPE, targetDocumentId: ret.id, targetLineId: line.id, quantity: line.quantity, relationType: 'RECEIPT_TO_RETURN' } });
        }
      }
      if (line.sourceInvoiceLineId) {
        const invLine = await tx.purchaseInvoiceLine.findFirst({ where: { id: line.sourceInvoiceLineId, tenantId } });
        if (invLine) {
          await tx.documentLineLink.create({ data: { tenantId, sourceDocumentType: PURCHASE_INVOICE_TYPE, sourceDocumentId: invLine.purchaseInvoiceId, sourceLineId: line.sourceInvoiceLineId, targetDocumentType: PURCHASE_RETURN_TYPE, targetDocumentId: ret.id, targetLineId: line.id, quantity: line.quantity, relationType: 'INVOICE_TO_RETURN' } });
        }
      }
    }

    await tx.purchaseReturn.update({ where: { id: ret.id }, data: { subtotal: netTotal.toString(), taxTotal: taxTotal.toString(), grandTotal: grossTotal.toString() } });

    // Costing (spec sections 28-29, 125): inventory leaves at the SOURCE
    // receipt layer's (adjusted) cost, not at the document price. The
    // document-price inventory credits above are replaced by the engine's
    // cost; the difference (e.g. capitalized freight reversed
    // proportionally) goes to the purchase-cost variance account.
    const cost = await this.costing.onDocumentPosted(tenantId, PURCHASE_RETURN_TYPE, ret.id, tx, document.postedBy ?? document.createdBy ?? 'system');
    if (cost && cost.inventoryLines.length > 0) {
      const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);
      const documentCredit = lines.filter((l) => l.accountId === inventory.id && l.side === 'CREDIT').reduce((s, l) => s.plus(new Decimal(l.amountBase)), new Decimal(0));
      const kept = lines.filter((l) => !(l.accountId === inventory.id && l.side === 'CREDIT'));
      const costCredit = cost.totalValue.abs();
      const variance = documentCredit.minus(costCredit);
      kept.push(...cost.inventoryLines);
      if (!variance.isZero()) {
        const varianceAccount = await this.mappings.resolve(tenantId, organizationId, MappingKeys.OTHER_OPERATING_EXPENSE, businessDate, tx);
        kept.push({ accountId: varianceAccount.id, side: variance.gt(0) ? 'CREDIT' : 'DEBIT', amountBase: variance.abs(), description: `Purchase return cost variance — ${ret.number ?? ret.id}`, dimensions: [{ dimensionCode: 'PRODUCT', referenceId: ret.lines[0].productId }, ...(ret.warehouseId ? [{ dimensionCode: 'WAREHOUSE', referenceId: ret.warehouseId }] : [])] });
      }
      return { description: `Purchase return ${ret.number ?? ret.id}`, operationType: 'SYSTEM_DOCUMENT', lines: kept };
    }

    return { description: `Purchase return ${ret.number ?? ret.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    await this.costing.onDocumentUnposted(tenantId, PURCHASE_RETURN_TYPE, document.id, tx, document.postedBy ?? document.createdBy ?? 'system');
    await this.inventory.deleteMovementsFor(tenantId, PURCHASE_RETURN_TYPE, document.id, tx);
    const ret = await tx.purchaseReturn.findFirst({ where: { id: document.id, tenantId } });
    if (ret?.warehouseId) {
      const lineIds = (await tx.purchaseReturnLine.findMany({ where: { tenantId, purchaseReturnId: document.id }, select: { id: true } })).map((l) => l.id);
      await this.batchSerial.undoIssuedSerials(tenantId, PURCHASE_RETURN_TYPE, lineIds, ret.warehouseId, tx);
    }
    await tx.documentLineLink.deleteMany({ where: { tenantId, targetDocumentType: PURCHASE_RETURN_TYPE, targetDocumentId: document.id } });
  }
}
