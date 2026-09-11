import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationAccessService } from '../org-structure/organization-access.service';
import { PurchasePriceResolverService } from './purchase-price-resolver.service';
import { TaxCalculationService } from '../tax-engine/tax-calculation.service';
import Decimal from 'decimal.js';

const SUPPLIER_TYPES = ['SUPPLIER', 'BOTH'];
const DEFAULT_TAX_CATEGORY = 'STANDARD_VAT';

export interface SupplierCandidate {
  counterpartyId: string;
  supplierName: string;
  supplierCode: string | null;
  price: string | null;
  currencyId: string | null;
  priceListId: string | null;
  leadTimeDays: number | null;
  expectedDeliveryDate: string | null;
  moq: string | null;
  orderMultiple: string | null;
  paymentTermsDays: number | null;
  taxPreview: { rate: string; taxAmount: string; grossAmount: string } | null;
}

/**
 * Supplier selection foundation (spec sections 41-46, 100). Deliberately a
 * COMPUTED candidate list, not a persisted "SupplierComparison" table —
 * nothing in the spec's Definition of Done requires storing a comparison,
 * only that "supplier selection foundation works" and the UI can show
 * "why a supplier is proposed" (spec section 100), which a live query
 * already answers. See docs/PROCUREMENT.md Technical Debt.
 *
 * Candidates come from `SupplierProductCode` mappings (so only suppliers
 * explicitly known to sell this product are considered — spec section
 * 108's "no cross-supplier ambiguity") joined with a PURCHASE price-list
 * lookup via `PurchasePriceResolverService`. A supplier with a code
 * mapping but no resolvable price is still listed (price: null) so the
 * gap is visible rather than silently hidden.
 */
@Injectable()
export class SupplierSelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly priceResolver: PurchasePriceResolverService,
    private readonly taxCalculation: TaxCalculationService,
  ) {}

  async candidatesForProduct(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    productId: string,
    quantity: number,
    businessDate: Date,
  ): Promise<SupplierCandidate[]> {
    await this.access.assertAccess(tenantId, membershipId, organizationId);

    const mappings = await this.prisma.supplierProductCode.findMany({
      where: { organizationId, productId, active: true },
      include: { counterparty: true },
    });

    const results: SupplierCandidate[] = [];
    for (const mapping of mappings) {
      if (!SUPPLIER_TYPES.includes(mapping.counterparty.counterpartyType) || !mapping.counterparty.active) continue;

      const found = await this.priceResolver.resolve(tenantId, membershipId, organizationId, productId, businessDate, quantity, mapping.counterpartyId);
      let taxPreview: SupplierCandidate['taxPreview'] = null;
      let price: Decimal | null = null;
      if (found) {
        price = new Decimal(found.price.toString());
        const preview = await this.taxCalculation.calculateLine(
          { tenantId, organizationId, businessDate, taxPointDate: businessDate, operationType: 'PURCHASE', taxCategoryCode: DEFAULT_TAX_CATEGORY, taxpayerSide: 'BUYER' },
          { amount: price.mul(quantity), priceIncludesTax: false },
        );
        taxPreview = { rate: preview.rate.toString(), taxAmount: preview.taxAmount.toString(), grossAmount: preview.grossAmount.toString() };
      }

      const expectedDeliveryDate = mapping.leadTimeDays
        ? new Date(businessDate.getTime() + mapping.leadTimeDays * 86400000).toISOString().slice(0, 10)
        : null;

      results.push({
        counterpartyId: mapping.counterpartyId,
        supplierName: mapping.counterparty.name,
        supplierCode: mapping.supplierCode,
        price: price ? price.toString() : null,
        currencyId: found?.priceListId ? (await this.prisma.priceList.findUnique({ where: { id: found.priceListId } }))?.currencyId ?? null : null,
        priceListId: found?.priceListId ?? null,
        leadTimeDays: mapping.leadTimeDays,
        expectedDeliveryDate,
        moq: mapping.moq ? mapping.moq.toString() : null,
        orderMultiple: mapping.orderMultiple ? mapping.orderMultiple.toString() : null,
        paymentTermsDays: mapping.counterparty.paymentTerms ?? null,
        taxPreview,
      });
    }

    // Cheapest resolvable price first (null-price candidates last) — the
    // UI still needs to see WHY a supplier is/isn't proposed (spec 100).
    return results.sort((a, b) => {
      if (a.price === null && b.price === null) return 0;
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return new Decimal(a.price).comparedTo(new Decimal(b.price));
    });
  }
}
