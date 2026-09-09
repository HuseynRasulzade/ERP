/**
 * "Create Based On" foundation (section 27/28).
 *
 * A mapper knows how to translate one source document into the header
 * fields of a new target document of a specific type. Field-mapping logic
 * lives entirely inside the mapper — never centralized — so later phases
 * (Customer Order -> Shipment -> Sales Invoice -> Payment, etc.) can each
 * define their own mapper without touching this framework.
 *
 * Phase 0 deliberately stops at: resolve mapper, build target header,
 * create target document, link it, do it all in one transaction. Remaining
 * quantity / partial fulfillment / many-to-many chains are Phase 27.
 */
export interface CreateBasedOnMapper<TSource = unknown, TTargetInput = unknown> {
  readonly sourceDocumentType: string;
  readonly targetDocumentType: string;

  /**
   * Builds the input needed to create the target document from the source.
   * Runs inside the create-based-on transaction; `tx` lets mappers copy
   * source lines or allocate numbers atomically with the link creation.
   * May be sync (header-only, like the demo self mapper) or async.
   */
  mapHeader(source: TSource, tx?: unknown): TTargetInput | Promise<TTargetInput>;
}
