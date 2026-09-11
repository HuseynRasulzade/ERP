import { Injectable } from '@nestjs/common';
import { PriceListService } from '../counterparty-pricing/price-list.service';

/**
 * PurchasePriceResolver (spec section 70). A thin, purchase-scoped wrapper
 * around `PriceListService.resolvePrice` — the resolver already accepts a
 * `priceListType` ('SALE' | 'PURCHASE') plus a `counterpartyId`, so the
 * SAME effective-dating/quantity-break/priority engine already built in
 * Phase 3 correctly separates PURCHASE price lists from SALE ones without
 * duplicating that logic (spec section 51: "never reuse the sales price").
 * This wrapper exists so callers never pass 'SALE' by mistake and so a
 * purchase-specific call site reads unambiguously.
 */
@Injectable()
export class PurchasePriceResolverService {
  constructor(private readonly prices: PriceListService) {}

  resolve(
    tenantId: string,
    membershipId: string,
    organizationId: string,
    productId: string,
    businessDate: Date,
    quantity: number,
    supplierCounterpartyId: string,
  ) {
    return this.prices.resolvePrice(
      tenantId,
      membershipId,
      organizationId,
      'PURCHASE',
      productId,
      businessDate,
      quantity,
      supplierCounterpartyId,
    );
  }
}
