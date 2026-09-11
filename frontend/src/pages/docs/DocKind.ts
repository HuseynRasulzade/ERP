export interface DocExtraField {
  key: string;
  label: string;
  type: 'select-warehouse' | 'date' | 'text' | 'select-static' | 'checkbox';
  options?: { value: string; label: string }[];
  required?: boolean;
}

export interface CreateBasedOnTarget {
  docType: string;
  routePrefix: string;
  label: string;
}

/** Central config a single generic list/detail page pair reads to render
 * any of the "priced document" kinds (Sales/Purchase Order, Sales/Purchase
 * Invoice, Goods Receipt, Shipment) without duplicating the page per kind
 * — only the differences (which columns, which extra header fields, which
 * Create Based On chains) are declared here. */
export interface DocKind {
  title: string;
  singular: string;
  basePath: string; // relative to /organizations/:orgId/
  routePrefix: string; // frontend route, no leading slash
  docType: string; // backend document-framework type string
  viewPerm: string;
  createPerm: string;
  counterpartyTypes: string[];
  counterpartyLabel: string;
  showPrice?: boolean;
  showTax?: boolean;
  showLineWarehouse?: boolean;
  headerWarehouse?: boolean;
  hasPriceIncludesTax?: boolean;
  priceHint?: string;
  extraFields?: DocExtraField[];
  createBasedOnTargets?: CreateBasedOnTarget[];
  emptyHint: string;
  headerDisplayFields?: { key: string; label: string }[];
}
