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
import { SALES_INVOICE_TYPE } from './sales-invoice.repository';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import { TaxRegisterService } from '../tax-engine/tax-register.service';
import { AccountingMappingService } from '../accounting-core/accounting-mapping.service';
import { AccountingPostingLineInput } from '../accounting-core/accounting-posting-engine.service';
import { MappingKeys } from '../accounting-core/accounting-dimension-codes';

const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

/**
 * Posting handler for SalesInvoice. Emits one SALES_SETTLEMENT_REGISTER
 * RECEIVABLE_ACCRUAL movement per line (unchanged, spec section 71's
 * generic register), AND (new — the Accounting Core/Tax Engine
 * reconciliation) a real Accounting Core + Tax Register consequence:
 *
 *   Dr Customer Receivable (211)     grandTotal
 *   Cr Sales Revenue (601)           per-line net, one line per product
 *   Cr VAT Output Payable (521)      Tax Engine's resolved output VAT
 *
 * Scope note (see docs/SALES_RECONCILIATION.md): this posts Receivable/
 * Revenue/VAT only. COGS/Inventory (Dr 701 / Cr 205) is deliberately NOT
 * posted here — that requires an inventory costing engine (Accounting
 * Core spec's own Phase 10/11 boundary), which does not exist in this
 * codebase yet.
 *
 * Tax scope note: every line defaults to the STANDARD_VAT tax category
 * (via ProductTaxProfile if one is configured, spec section 19) rather
 * than the invoice line's own `taxRate` field — the Tax Engine, not an
 * ad-hoc per-line rate, is now the single source of truth for the GL/Tax
 * Register consequence. This can diverge from the invoice's displayed
 * `taxAmount` if a line was saved with a manually-typed custom rate; see
 * docs/SALES_RECONCILIATION.md Technical Debt for why unifying save-time
 * display math with the Tax Engine is a separate, deferred step.
 */
@Injectable()
export class SalesInvoicePostingHandler implements DocumentPostingHandler {
  readonly documentType = SALES_INVOICE_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxCalculation: TaxCalculationService,
    private readonly taxRegister: TaxRegisterService,
    private readonly mappings: AccountingMappingService,
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

    // Fall back to the organization's, then the tenant's, base currency
    // when the invoice itself was saved without an explicit one (the
    // field is optional at save time — spec section 21 accounts for a
    // domestic-only flow with no per-document currency selection).
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

    // Resolve each line's tax category (ProductTaxProfile if configured,
    // else the STANDARD_VAT default) and run it through the real Tax
    // Engine — never the invoice's own ad-hoc `taxRate` field.
    const taxResults = [];
    for (const line of invoice.lines) {
      const profile = await tx.productTaxProfile.findFirst({
        where: {
          tenantId,
          productId: line.productId,
          active: true,
          validFrom: { lte: businessDate },
          OR: [{ validTo: null }, { validTo: { gte: businessDate } }],
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
          taxPointDate: businessDate,
          operationType: 'SALE',
          taxCategoryCode,
          taxpayerSide: 'SELLER',
        },
        {
          sourceLineId: line.id,
          amount: line.lineTotal, // already net (spec: never re-derive from a gross that may itself be stale)
          priceIncludesTax: false,
          currency: currencyId,
        },
        tx,
      );
      taxResults.push(result);
    }

    const { accountingLines: vatLines } = await this.taxRegister.registerTaxable(
      tenantId,
      document.postedBy ?? document.createdBy ?? 'system',
      {
        organizationId,
        sourceDocumentType: SALES_INVOICE_TYPE,
        sourceDocumentId: document.id,
        taxPointDate: businessDate,
        currencyId: currencyId,
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

    return {
      description: `Sales invoice ${invoice.number ?? invoice.id}`,
      operationType: 'SYSTEM_DOCUMENT',
      lines,
    };
  }
}
