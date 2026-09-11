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

/** Opt-in "base this document on one or more source documents" capability
 * (currently: Purchase Order from Purchase Requirement(s)). Declaring it
 * on a `DocKind` adds a picker section to the shared creation form —
 * every other kind that doesn't declare it is completely unaffected. */
export interface RequirementPickerConfig {
  // Relative to /organizations/:orgId/ — GET returns open source documents.
  queryPath: string;
  // Relative to /organizations/:orgId/ — POST { requirementIds, ...header }
  // creates the target document from the selected source documents.
  createEndpoint: string;
  label: string;
  helpText: string;
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
  /** Opt-in "edit this document's lines after creation" capability
   * (currently: Purchase Order, so a blank/auto price left over from a
   * requirement-based creation can be filled in before confirmation).
   * The permission code required to use it; omitted entirely for kinds
   * that don't offer post-creation line editing. */
  editLinesPerm?: string;
  extraFields?: DocExtraField[];
  createBasedOnTargets?: CreateBasedOnTarget[];
  requirementPicker?: RequirementPickerConfig;
  emptyHint: string;
  headerDisplayFields?: { key: string; label: string }[];
}
