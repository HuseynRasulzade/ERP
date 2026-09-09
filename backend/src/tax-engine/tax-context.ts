/**
 * TaxContext (spec section 31) — the ONLY input TaxRuleResolver accepts.
 * Deliberately narrow and typed: callers never pass arbitrary UI fields
 * through to rule execution.
 */
export interface TaxContext {
  tenantId: string;
  organizationId: string;
  businessDate: Date;
  taxPointDate: Date;
  operationType: 'SALE' | 'PURCHASE';
  taxCategoryCode: string;
  taxpayerSide: 'SELLER' | 'BUYER' | 'SELF_ASSESSED';
  jurisdiction?: string; // defaults to 'AZ'
  currencyId?: string;
  counterpartyId?: string;
  productId?: string;
}
