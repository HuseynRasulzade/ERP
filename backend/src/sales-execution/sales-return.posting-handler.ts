import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { ValidationAppError } from '../common/errors/app-error';
import { SALES_RETURN_TYPE } from './sales-return.repository';
import { SALES_INVOICE_TYPE } from '../sales-documents/sales-invoice.repository';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { InventoryLedgerService } from './inventory-ledger.service';
import { TaxLineResult } from '../tax-engine/tax-calculation-result';
import { BatchSerialService } from '../warehouse-inventory/batch-serial.service';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { OpenItemService } from '../settlement/open-item.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * Posting handler for SalesReturn (spec sections 51-53). For a line
 * linked to an original invoice line, tax is derived by PRORATING the
 * ORIGINAL posted `TaxMovement` (return quantity / original quantity) —
 * never by re-resolving today's Tax Engine rule against a historical
 * sale (spec section 53: "Do not blindly apply today's VAT rule to an
 * old sale return"). A line with no source (a return not linked to a
 * specific invoice line) falls back to a fresh STANDARD_VAT calculation,
 * documented as a lesser-fidelity path in docs/SALES_EXECUTION.md.
 *
 * Accounting (spec section 51):
 *   Dr SALES_RETURN (602, contra-revenue)   returnNet
 *   Dr VAT_OUTPUT_PAYABLE (contra)          returnTax  — reduces the liability
 *   Cr CUSTOMER_RECEIVABLE (211)            returnGross
 *
 * Physical returns (spec section 50) write a RECEIPT inventory movement;
 * `FINANCIAL_CREDIT_ONLY`/`PRICE_CORRECTION` returns never touch
 * inventory (spec section 49). COGS reversal (spec section 52) is
 * skipped for the same reason original COGS was never posted — see
 * `CostingService`.
 */
@Injectable()
export class SalesReturnPostingHandler implements DocumentPostingHandler {
  readonly documentType = SALES_RETURN_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
    private readonly mappings: AccountingMappingService,
    private readonly inventory: InventoryLedgerService,
    private readonly batchSerial: BatchSerialService,
    private readonly costing: InventoryCostingService,
    private readonly openItems: OpenItemService,
  ) {}

  async validateForPosting(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const ret = await tx.salesReturn.findFirst({ where: { id: document.id, tenantId }, include: { lines: true } });
    if (!ret) throw new ValidationAppError('Document disappeared during posting');
    if (ret.lines.length === 0) throw new ValidationAppError('Cannot post a sales return with no lines');
    if (ret.returnType === 'PHYSICAL_RETURN' && !ret.warehouseId) {
      throw new ValidationAppError('A physical return requires a warehouse');
    }
    for (const line of ret.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a return line with non-positive quantity');
    }
  }

  async buildMovements(): Promise<RegisterMovementInput[]> {
    return [];
  }

  async buildAccountingBatch(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<AccountingBatchResult | null> {
    const ret = await tx.salesReturn.findFirst({ where: { id: document.id, tenantId }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!ret) throw new ValidationAppError('Document disappeared during posting');
    const organizationId = ret.organizationId;
    const businessDate = document.postingDate ?? document.documentDate;

    // Same currency fallback as SalesInvoicePostingHandler — the return's
    // own currency may be unset, but 211 always needs a real CURRENCY
    // dimension value.
    let currencyId = ret.currencyId;
    if (!currencyId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      currencyId = org?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      currencyId = tenant?.baseCurrencyId ?? null;
    }
    if (!currencyId) {
      throw new ValidationAppError('Cannot post a sales return: no currency on the return, organization, or tenant');
    }

    const taxResults: TaxLineResult[] = [];
    for (const line of ret.lines) {
      if (line.sourceInvoiceLineId) {
        const originalMovement = await tx.taxMovement.findFirst({
          where: { tenantId, sourceDocumentType: SALES_INVOICE_TYPE, sourceLineId: line.sourceInvoiceLineId, reversalOfMovementId: null },
        });
        const sourceLine = await tx.salesInvoiceLine.findFirst({ where: { id: line.sourceInvoiceLineId, tenantId } });
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
            recoverableAmount: new Decimal(0),
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
      }

      // No linked original line/movement — fall back to a fresh calculation.
      const result = await this.taxCalculation.calculateLine(
        {
          tenantId,
          organizationId,
          businessDate,
          taxPointDate: businessDate,
          operationType: 'SALE',
          taxCategoryCode: DEFAULT_TAX_CATEGORY,
          taxpayerSide: 'SELLER',
        },
        { sourceLineId: line.id, amount: line.originalUnitPrice.mul(line.quantity.toString()), priceIncludesTax: false },
        tx,
      );
      taxResults.push(result);
    }

    const { accountingLines: vatLines } = await this.taxRegister.registerTaxable(
      tenantId,
      document.postedBy ?? document.createdBy ?? 'system',
      {
        organizationId,
        sourceDocumentType: SALES_RETURN_TYPE,
        sourceDocumentId: document.id,
        taxPointDate: businessDate,
        currencyId,
        operationType: 'SALE',
        contra: true,
        lines: taxResults,
      },
      tx,
    );

    const receivable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, businessDate, tx);
    const salesReturn = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SALES_RETURN, businessDate, tx);

    const netTotal = taxResults.reduce((s, r) => s.plus(r.taxableBase), new Decimal(0));
    const grossTotal = taxResults.reduce((s, r) => s.plus(r.grossAmount), new Decimal(0));

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: salesReturn.id,
        side: 'DEBIT',
        amountBase: netTotal,
        description: `Sales return — ${ret.number ?? ret.id}`,
        dimensions: [{ dimensionCode: 'PRODUCT', referenceId: ret.lines[0].productId }],
      },
      ...vatLines,
      {
        accountId: receivable.id,
        side: 'CREDIT',
        amountBase: grossTotal,
        description: `Receivable reduction — return ${ret.number ?? ret.id}`,
        dimensions: [
          { dimensionCode: 'PARTNER', referenceId: ret.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: ret.counterpartyId },
          { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: ret.id },
          { dimensionCode: 'CURRENCY', referenceId: currencyId },
        ],
      },
    ];

    if (ret.returnType === 'PHYSICAL_RETURN' && ret.warehouseId) {
      for (const line of ret.lines) {
        const capturedSerials = await this.batchSerial.getCapturedSerials(tenantId, SALES_RETURN_TYPE, line.id, tx);

        // Phase 11 return costing (spec section 26): restore the ORIGINAL
        // shipment's realized cost, never today's current/average cost.
        let originalShipmentLineId: string | null = null;
        if (line.sourceInvoiceLineId) {
          const invoiceLine = await tx.salesInvoiceLine.findFirst({ where: { id: line.sourceInvoiceLineId, tenantId } });
          originalShipmentLineId = invoiceLine?.sourceShipmentLineId ?? null;
        }

        if (capturedSerials.length > 0) {
          const serialIds = await this.batchSerial.returnSerials(tenantId, organizationId, line.productId, ret.warehouseId, undefined, SALES_RETURN_TYPE, line.id, tx);
          for (const serialId of serialIds) {
            const movement = await this.inventory.recordMovement(
              tenantId,
              { productId: line.productId, warehouseId: ret.warehouseId, quantity: '1', movementType: 'RECEIPT', businessDate, sourceDocumentType: SALES_RETURN_TYPE, sourceDocumentId: ret.id, sourceLineId: line.id, batchId: line.batchId, serialId },
              tx,
            );
            await this.costing.receiveReturnMovement(
              tenantId,
              { organizationId, productId: line.productId, warehouseId: ret.warehouseId, batchId: line.batchId, quantity: '1', effectiveDate: businessDate, sourceDocumentType: SALES_RETURN_TYPE, sourceDocumentId: ret.id, sourceDocumentLineId: line.id, sourceMovementId: movement.id, originalShipmentLineId },
              tx,
            );
          }
        } else {
          const movement = await this.inventory.recordMovement(
            tenantId,
            {
              productId: line.productId,
              warehouseId: ret.warehouseId,
              quantity: line.quantity.toString(),
              movementType: 'RECEIPT',
              businessDate,
              sourceDocumentType: SALES_RETURN_TYPE,
              sourceDocumentId: ret.id,
              sourceLineId: line.id,
              batchId: line.batchId,
            },
            tx,
          );
          await this.costing.receiveReturnMovement(
            tenantId,
            { organizationId, productId: line.productId, warehouseId: ret.warehouseId, batchId: line.batchId, quantity: line.quantity.toString(), effectiveDate: businessDate, sourceDocumentType: SALES_RETURN_TYPE, sourceDocumentId: ret.id, sourceDocumentLineId: line.id, sourceMovementId: movement.id, originalShipmentLineId },
            tx,
          );
        }
      }
    }

    await tx.salesReturn.update({
      where: { id: ret.id },
      data: { taxTotal: taxResults.reduce((s, r) => s.plus(r.taxAmount), new Decimal(0)).toString(), grandTotal: grossTotal.toString() },
    });

    // Phase 13 settlement (spec sections 34-35, 156): reduces the
    // original invoice's open item(s), and diverts any amount beyond
    // what was still open into a customer credit/advance — this is
    // independent of the GL entry above, which (a pre-existing, disclosed
    // Sales Execution simplification) always credits AR the full
    // `grossTotal` regardless of how much was actually open; see
    // docs/SETTLEMENT.md section on this exact edge case.
    if (ret.originalSalesInvoiceId) {
      await this.openItems.reduceForReturn(tenantId, organizationId, ret.counterpartyId, 'CUSTOMER', SALES_INVOICE_TYPE, ret.originalSalesInvoiceId, grossTotal, currencyId, SALES_RETURN_TYPE, ret.id, businessDate, tx);
    }

    return { description: `Sales return ${ret.number ?? ret.id}`, operationType: 'SYSTEM_DOCUMENT', lines };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    if (await this.costing.hasDownstreamConsumption(tenantId, SALES_RETURN_TYPE, document.id, tx)) {
      throw new ValidationAppError('this return\'s cost layer has already been consumed by a later inventory movement — unpost that movement first');
    }
    await this.costing.reverseIncoming(tenantId, document.organizationId!, SALES_RETURN_TYPE, document.id, document.postingDate ?? document.documentDate, tx);
    await this.inventory.deleteMovementsFor(tenantId, SALES_RETURN_TYPE, document.id, tx);
    const lineIds = (await tx.salesReturnLine.findMany({ where: { tenantId, salesReturnId: document.id }, select: { id: true } })).map((l) => l.id);
    await this.batchSerial.undoReturnedSerials(tenantId, SALES_RETURN_TYPE, lineIds, tx);
  }
}
