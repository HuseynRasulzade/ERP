/**
 * AZ_TAX — Azerbaijan VAT localization seed data (docx spec Phase 5).
 *
 * PROVENANCE NOTE (spec sections 1-2, 96, and Definition of Done "B. Legal
 * Sources"): the primary source is https://e-qanun.az/framework/46948
 * (the consolidated Tax Code of the Republic of Azerbaijan). That page is
 * a JavaScript-rendered document that could not be fetched as text in
 * this build session — the article numbers below (160 for the standard
 * rate, 165-166 for zero-rate/exemption, 175 for input VAT offset) come
 * from secondary tax-guide sources (PwC Tax Summaries, Grant Thornton's
 * Indirect Tax guide, VATupdate's 2026 Azerbaijan VAT guide) that all
 * agree the standard rate is 18%. This is disclosed rather than presented
 * as verified against the primary text — see docs/TAX_ENGINE.md "Legal
 * Sources" and "Technical debt" sections. A qualified reviewer should
 * confirm the exact article/paragraph wording against e-qanun.az before
 * this configuration is relied on for actual filings.
 */
import { TaxRateType, TaxTreatment } from '@prisma/client';

export const AZ_TAX_TYPE_VAT = 'VAT';

export const AZ_TAX_LEGAL_SOURCES = [
  {
    key: 'AZ_TAX_CODE',
    jurisdiction: 'AZ',
    sourceType: 'TAX_CODE',
    title: 'Tax Code of the Republic of Azerbaijan (consolidated)',
    sourceUrl: 'https://e-qanun.az/framework/46948',
    sourceVersion: '2026-consolidated',
    status: 'ACTIVE',
    notes:
      'Primary legal source. Article numbers used elsewhere in this seed ' +
      '(160, 165, 166, 175) were sourced from secondary tax-guide summaries, ' +
      'not verified against the primary text directly in this build — see ' +
      'docs/TAX_ENGINE.md for the disclosure and a request for legal review.',
  },
];

export const AZ_TAX_CATEGORIES = [
  { code: 'STANDARD_VAT', name: 'Standard-rated VAT (18%)' },
  { code: 'ZERO_RATED_EXPORT', name: 'Zero-rated (export and equivalent supplies)' },
  { code: 'VAT_EXEMPT', name: 'VAT-exempt supply' },
  { code: 'OUT_OF_SCOPE', name: 'Outside VAT scope' },
];

export const AZ_STANDARD_VAT_RATE = {
  code: 'AZ_VAT_STANDARD',
  rate: '18.0000',
  rateType: TaxRateType.STANDARD,
  effectiveFrom: new Date('2001-01-01T00:00:00.000Z'), // AZ's 18% standard rate has been stable since the Tax Code's original 2001 entry into force
  legalArticleReference: 'Tax Code Art. 160 (per secondary sources — see provenance note above)',
};

export const AZ_ZERO_VAT_RATE = {
  code: 'AZ_VAT_ZERO',
  rate: '0.0000',
  rateType: TaxRateType.ZERO,
  effectiveFrom: new Date('2001-01-01T00:00:00.000Z'),
  legalArticleReference: 'Tax Code Art. 165-166 (per secondary sources — see provenance note above)',
};

/**
 * TaxRule rows. `conditionTaxCategoryCode` matches against the resolved
 * ProductTaxProfile category on the taxable line; `conditionOperationType`
 * against TaxContext.operationType (SALE/PURCHASE); `conditionTaxpayerSide`
 * against which side of the transaction the calculation is for.
 */
export const AZ_VAT_RULES = [
  {
    code: 'AZ_VAT_STANDARD_RULE',
    name: 'Standard-rated VAT',
    ruleCategory: 'STANDARD',
    treatment: TaxTreatment.STANDARD_RATE,
    priority: 0,
    conditionTaxCategoryCode: 'STANDARD_VAT',
    rateCode: AZ_STANDARD_VAT_RATE.code,
    legalArticleReference: 'Tax Code Art. 160',
    effectiveFrom: new Date('2001-01-01T00:00:00.000Z'),
  },
  {
    code: 'AZ_VAT_ZERO_RATE_RULE',
    name: 'Zero-rated supply (export etc.)',
    ruleCategory: 'ZERO_RATE',
    treatment: TaxTreatment.ZERO_RATED,
    priority: 10, // more specific than the standard default — wins when the category matches
    conditionTaxCategoryCode: 'ZERO_RATED_EXPORT',
    rateCode: AZ_ZERO_VAT_RATE.code,
    legalArticleReference: 'Tax Code Art. 165',
    effectiveFrom: new Date('2001-01-01T00:00:00.000Z'),
  },
  {
    code: 'AZ_VAT_EXEMPT_RULE',
    name: 'VAT-exempt supply',
    ruleCategory: 'EXEMPT',
    treatment: TaxTreatment.EXEMPT,
    priority: 10,
    conditionTaxCategoryCode: 'VAT_EXEMPT',
    rateCode: null as string | null,
    exemptionCode: 'AZ_VAT_EXEMPT_GENERAL',
    legalArticleReference: 'Tax Code Art. 166',
    effectiveFrom: new Date('2001-01-01T00:00:00.000Z'),
  },
  {
    code: 'AZ_VAT_OUT_OF_SCOPE_RULE',
    name: 'Outside VAT scope',
    ruleCategory: 'OUT_OF_SCOPE',
    treatment: TaxTreatment.OUT_OF_SCOPE,
    priority: 10,
    conditionTaxCategoryCode: 'OUT_OF_SCOPE',
    rateCode: null as string | null,
    legalArticleReference: null as string | null,
    effectiveFrom: new Date('2001-01-01T00:00:00.000Z'),
  },
];

export const AZ_VAT_EXEMPTIONS = [
  {
    code: 'AZ_VAT_EXEMPT_GENERAL',
    name: 'General VAT exemption category',
    legalArticleReference: 'Tax Code Art. 166',
  },
];
