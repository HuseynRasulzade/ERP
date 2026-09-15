import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service';
import {
  AccountingBatchResult,
  DocumentPostingHandler,
  RegisterMovementInput,
} from '../document-framework/document-posting-handler.interface';
import { BaseDocumentFields } from '../document-framework/base-document';
import { InvoiceHasReturnsError, InvoiceQuantityExceedsSourceError, ValidationAppError } from '../common/errors/app-error';
import { SALES_INVOICE_TYPE } from './sales-invoice.repository';
import { SALES_ORDER_TYPE } from './sales-order.repository';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';
import { CostingService } from '../sales-execution/costing.service';
import { SHIPMENT_TYPE } from '../sales-execution/shipment.repository';
import { OpenItemService } from '../settlement/open-item.service';
import { SettlementMovementService } from '../settlement/settlement-movement.service';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * Posting handler for SalesInvoice. Emits one SALES_SETTLEMENT_REGISTER
 * RECEIVABLE_ACCRUAL movement per line (unchanged, spec section 71's
 * generic register), AND (the Accounting Core/Tax Engine reconciliation,
 * extended for Sales Execution — docx spec Phase 7) a real Accounting
 * Core + Tax Register consequence:
 *
 *   Dr Customer Receivable (211)     grandTotal
 *   Cr Sales Revenue (601)           per-line net, one line per product
 *   Cr VAT Output Payable (521)      Tax Engine's resolved output VAT
 *   [Dr COGS / Cr Goods Inventory    only when CostingService has a real
 *                                     unit cost — spec section 38: never
 *                                     fabricated, silently skipped
 *                                     otherwise, see docs/SALES_EXECUTION.md]
 *
 * Phase 7 additions: `taxPointDate`/`amountDue` set on post; invoiced
 * quantity validated against the remaining invoiceable quantity on the
 * source Order/Shipment line (spec sections 24-25); a `DocumentLineLink`
 * (`ORDER_TO_INVOICE`/`SHIPMENT_TO_INVOICE`) is written for line-level
 * traceability; a `SettlementObligation` row is created as the Phase 13
 * AR handoff contract (spec sections 40-41).
 *
 * Tax scope note: every line defaults to the STANDARD_VAT tax category
 * (via ProductTaxProfile if one is configured, spec section 19) rather
 * than the invoice line's own `taxRate` field — the Tax Engine, not an
 * ad-hoc per-line rate, is now the single source of truth for the GL/Tax
 * Register consequence.
 */
@Injectable()
export class SalesInvoicePostingHandler implements DocumentPostingHandler {
  readonly documentType = SALES_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
    private readonly mappings: AccountingMappingService,
    private readonly costing: CostingService,
    private readonly openItems: OpenItemService,
    private readonly settlementMovements: SettlementMovementService,
  ) {}

  async validateForPosting(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: true },
    });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');
    if (invoice.lines.length === 0) throw new ValidationAppError('Cannot post a sales invoice with no lines');
    if (invoice.grandTotal.lte(0)) throw new ValidationAppError('Cannot post a sales invoice with non-positive total');
    for (const line of invoice.lines) {
      if (line.quantity.lte(0)) throw new ValidationAppError('Cannot post a sales invoice with non-positive quantity');
      if (line.price.lt(0)) throw new ValidationAppError('Cannot post a sales invoice with negative price');

      if (line.sourceOrderLineId) {
        const remaining = await remainingInvoiceable(tx, tenantId, SALES_ORDER_TYPE, line.sourceOrderLineId);
        if (new Decimal(line.quantity.toString()).gt(remaining)) {
          throw new InvoiceQuantityExceedsSourceError(remaining.toFixed(6), line.quantity.toString());
        }
      }
      if (line.sourceShipmentLineId) {
        const remaining = await remainingInvoiceable(tx, tenantId, SHIPMENT_TYPE, line.sourceShipmentLineId);
        if (new Decimal(line.quantity.toString()).gt(remaining)) {
          throw new InvoiceQuantityExceedsSourceError(remaining.toFixed(6), line.quantity.toString());
        }
      }
    }

    const counterparty = await tx.counterparty.findFirst({
      where: { id: invoice.counterpartyId, tenantId },
    });
    if (!counterparty || !counterparty.active) {
      throw new ValidationAppError('Cannot post a sales invoice for a missing or inactive counterparty');
    }
  }

  async buildMovements(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<RegisterMovementInput[]> {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    if (!invoice) throw new ValidationAppError('Document disappeared during posting');

    return invoice.lines.map((line) => ({
      registerCode: 'SALES_SETTLEMENT_REGISTER',
      recorderLineId: line.id,
      businessDate: document.postingDate ?? document.documentDate,
      movementType: 'RECEIVABLE_ACCRUAL',
      dimensions: {
        organizationId: document.organizationId ?? null,
        counterpartyId: invoice.counterpartyId,
        productId: line.productId,
        unitId: line.unitId,
      },
      resources: {
        quantity: line.quantity.toString(),
        price: line.price.toString(),
        lineTotal: line.lineTotal.toString(),
        taxAmount: line.taxAmount.toString(),
        lineTotalWithTax: line.lineTotalWithTax.toString(),
        currencyId: invoice.currencyId,
      },
    }));
  }

  async buildAccountingBatch(
    tenantId: string,
    document: BaseDocumentFields,
    tx: PrismaTransactionClient,
  ): Promise<AccountingBatchResult | null> {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: document.id, tenantId },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
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
    if (!currencyId) {
      throw new ValidationAppError('Cannot post a sales invoice: no currency on the invoice, organization, or tenant');
    }

    const taxResults = [];
    for (const line of invoice.lines) {
      const profile = await tx.productTaxProfile.findFirst({
        where: {
          tenantId,
          productId: line.productId,
          active: true,
          validFrom: { lte: taxPointDate },
          OR: [{ validTo: null }, { validTo: { gte: taxPointDate } }],
          AND: [{ OR: [{ organizationId }, { organizationId: null }] }],
        },
        include: { taxCategory: true },
        orderBy: { validFrom: 'desc' },
      });
      const taxCategoryCode = profile?.taxCategory.code ?? DEFAULT_TAX_CATEGORY;

      const result = await this.taxCalculation.calculateLine(
        {
          tenantId,
          organizationId,
          businessDate,
          taxPointDate,
          operationType: 'SALE',
          taxCategoryCode,
          taxpayerSide: 'SELLER',
        },
        {
          sourceLineId: line.id,
          amount: line.lineTotal,
          priceIncludesTax: false,
          currency: currencyId,
        },
        tx,
      );
      taxResults.push(result);
    }

    const { movementIds, accountingLines: vatLines } = await this.taxRegister.registerTaxable(
      tenantId,
      document.postedBy ?? document.createdBy ?? 'system',
      {
        organizationId,
        sourceDocumentType: SALES_INVOICE_TYPE,
        sourceDocumentId: document.id,
        taxPointDate,
        currencyId,
        operationType: 'SALE',
        lines: taxResults,
      },
      tx,
    );

    const receivable = await this.mappings.resolve(tenantId, organizationId, MappingKeys.CUSTOMER_RECEIVABLE, businessDate, tx);
    const revenue = await this.mappings.resolve(tenantId, organizationId, MappingKeys.SALES_REVENUE, businessDate, tx);

    const grossTotal = taxResults.reduce((sum, r) => sum.plus(r.grossAmount), new Decimal(0));

    const lines: AccountingPostingLineInput[] = [
      {
        accountId: receivable.id,
        side: 'DEBIT',
        amountBase: grossTotal,
        transactionCurrencyId: currencyId,
        description: `Receivable — invoice ${invoice.number ?? invoice.id}`,
        dimensions: [
          { dimensionCode: 'PARTNER', referenceId: invoice.counterpartyId },
          { dimensionCode: 'COUNTERPARTY', referenceId: invoice.counterpartyId },
          { dimensionCode: 'SETTLEMENT_DOCUMENT', referenceId: invoice.id },
          { dimensionCode: 'CURRENCY', referenceId: currencyId },
        ],
      },
      ...invoice.lines.map((line, i) => ({
        accountId: revenue.id,
        side: 'CREDIT' as const,
        amountBase: taxResults[i].taxableBase,
        sourceDocumentLineId: line.id,
        description: `Revenue — line ${i + 1}`,
        dimensions: [{ dimensionCode: 'PRODUCT', referenceId: line.productId }],
      })),
      ...vatLines,
    ];

    // COGS (spec sections 35-38): only posted when CostingService has a
    // real, authoritative unit cost. Never fabricated from the selling
    // price — silently skipped (not zero-posted) otherwise.
    const cogsLines = await this.buildCogsLines(tenantId, organizationId, invoice.lines, businessDate, tx);
    lines.push(...cogsLines);

    // Traceability + AR handoff (spec sections 22-25, 40-41).
    for (const [i, line] of invoice.lines.entries()) {
      if (line.sourceOrderLineId) {
        await tx.documentLineLink.create({
          data: {
            tenantId,
            sourceDocumentType: SALES_ORDER_TYPE,
            sourceDocumentId: (await this.resolveOrderIdForLine(tx, tenantId, line.sourceOrderLineId)) ?? '',
            sourceLineId: line.sourceOrderLineId,
            targetDocumentType: SALES_INVOICE_TYPE,
            targetDocumentId: invoice.id,
            targetLineId: line.id,
            quantity: line.quantity,
            relationType: 'ORDER_TO_INVOICE',
          },
        });
      }
      if (line.sourceShipmentLineId) {
        const shipmentLine = await tx.shipmentLine.findFirst({ where: { id: line.sourceShipmentLineId, tenantId } });
        if (shipmentLine) {
          await tx.documentLineLink.create({
            data: {
              tenantId,
              sourceDocumentType: SHIPMENT_TYPE,
              sourceDocumentId: shipmentLine.shipmentId,
              sourceLineId: line.sourceShipmentLineId,
              targetDocumentType: SALES_INVOICE_TYPE,
              targetDocumentId: invoice.id,
              targetLineId: line.id,
              quantity: line.quantity,
              relationType: 'SHIPMENT_TO_INVOICE',
            },
          });
        }
      }
      void i;
    }

    // Phase 13 settlement (spec sections 12, 14): real open item + a
    // RECEIVABLE_CREATE row on the immutable settlement register — this
    // replaces the old direct-insert placeholder `SettlementObligation`
    // create the pre-Phase-13 build used.
    const counterpartyForTerms = await tx.counterparty.findFirst({ where: { id: invoice.counterpartyId, tenantId } });
    const dueDate = new Date(businessDate);
    dueDate.setDate(dueDate.getDate() + (counterpartyForTerms?.paymentTerms ?? 0));
    const invoiceExchangeRate = invoice.exchangeRate ? new Decimal(invoice.exchangeRate.toString()) : new Decimal(1);
    await this.openItems.createReceivable(
      tenantId,
      {
        organizationId,
        counterpartyId: invoice.counterpartyId,
        sourceDocumentType: SALES_INVOICE_TYPE,
        sourceDocumentId: invoice.id,
        currencyId: currencyId!,
        amount: grossTotal,
        baseCurrencyAmount: grossTotal.mul(invoiceExchangeRate).toDecimalPlaces(2),
        exchangeRate: invoiceExchangeRate,
        dueDate,
        effectiveDate: businessDate,
      },
      tx,
    );

    await tx.salesInvoice.update({
      where: { id: invoice.id },
      data: { taxPointDate, amountDue: grossTotal.toString() },
    });

    void movementIds;

    return {
      description: `Sales invoice ${invoice.number ?? invoice.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }

  async undoSideEffects(tenantId: string, document: BaseDocumentFields, tx: PrismaTransactionClient): Promise<void> {
    const activeReturn = await tx.salesReturn.findFirst({
      where: { tenantId, originalSalesInvoiceId: document.id, postingStatus: 'POSTED' },
    });
    if (activeReturn) throw new InvoiceHasReturnsError(document.id);

    // Phase 13 unpost dependency (spec section 89): a posted payment
    // allocation against this invoice's open item blocks unposting.
    const obligation = await tx.settlementObligation.findFirst({ where: { tenantId, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: document.id } });
    if (obligation && obligation.allocatedAmount.gt(0)) {
      throw new ValidationAppError('Cannot unpost: this invoice has an active payment allocation — reverse it first.');
    }
    await tx.settlementObligation.deleteMany({ where: { tenantId, sourceDocumentType: SALES_INVOICE_TYPE, sourceDocumentId: document.id } });
    await this.settlementMovements.reverse(tenantId, SALES_INVOICE_TYPE, document.id, document.postedBy ?? undefined, tx);
    await tx.documentLineLink.deleteMany({
      where: { tenantId, targetDocumentType: SALES_INVOICE_TYPE, targetDocumentId: document.id, relationType: { in: ['ORDER_TO_INVOICE', 'SHIPMENT_TO_INVOICE'] } },
    });
  }

  private async resolveOrderIdForLine(tx: PrismaTransactionClient, tenantId: string, salesOrderLineId: string): Promise<string | null> {
    const line = await tx.salesOrderLine.findFirst({ where: { id: salesOrderLineId, tenantId } });
    return line?.salesOrderId ?? null;
  }

  private async buildCogsLines(
    tenantId: string,
    organizationId: string,
    lines: Array<{ id: string; productId: string; quantity: Decimal; sourceShipmentLineId: string | null }>,
    businessDate: Date,
    tx: PrismaTransactionClient,
  ): Promise<AccountingPostingLineInput[]> {
    const result: AccountingPostingLineInput[] = [];
    for (const line of lines) {
      if (!line.sourceShipmentLineId) continue; // no physical execution linked — nothing to cost
      const shipmentLine = await tx.shipmentLine.findFirst({ where: { id: line.sourceShipmentLineId, tenantId } });
      const warehouseId = shipmentLine?.warehouseId;
      if (!warehouseId) continue;

      const unitCost = await this.costing.getUnitCost(tenantId, organizationId, line.productId, warehouseId, businessDate, line.sourceShipmentLineId);
      if (!unitCost) continue; // spec section 38: no authoritative cost — skip, never fabricate

      const totalCost = unitCost.mul(line.quantity.toString());
      const cogs = await this.mappings.resolve(tenantId, organizationId, MappingKeys.COGS, businessDate, tx);
      const inventory = await this.mappings.resolve(tenantId, organizationId, MappingKeys.GOODS_INVENTORY, businessDate, tx);

      result.push(
        { accountId: cogs.id, side: 'DEBIT', amountBase: totalCost, sourceDocumentLineId: line.id, description: 'COGS' },
        { accountId: inventory.id, side: 'CREDIT', amountBase: totalCost, sourceDocumentLineId: line.id, description: 'Inventory issue cost' },
      );
    }
    return result;
  }
}

async function remainingInvoiceable(tx: PrismaTransactionClient, tenantId: string, sourceDocumentType: string, sourceLineId: string): Promise<Decimal> {
  const sourceQuantity =
    sourceDocumentType === SALES_ORDER_TYPE
      ? (await tx.salesOrderLine.findFirst({ where: { id: sourceLineId, tenantId } }))?.quantity
      : (await tx.shipmentLine.findFirst({ where: { id: sourceLineId, tenantId } }))?.quantity;
  if (!sourceQuantity) return new Decimal(0);

  const alreadyInvoiced = await tx.documentLineLink.aggregate({
    where: {
      tenantId,
      sourceDocumentType,
      sourceLineId,
      relationType: sourceDocumentType === SALES_ORDER_TYPE ? 'ORDER_TO_INVOICE' : 'SHIPMENT_TO_INVOICE',
    },
    _sum: { quantity: true },
  });
  return new Decimal(sourceQuantity.toString()).minus((alreadyInvoiced._sum.quantity ?? 0).toString());
}
