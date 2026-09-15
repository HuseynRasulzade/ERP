# Phase 27 — Create Based On / Document Chain / Provenance Engine

Implements docx spec Phase 27: a governed, versioned "Create Based On"
engine — safe header/line mapping, business-owned eligibility/remaining
calculation, staged creation proposals, concurrency-safe reservation
claims, typed document relationships, transitive lineage and downstream
impact analysis — layered on top of the document-chain foundations that
already existed from Phase 0 (`DocumentLink`, `DocumentLineLink`,
`CreateBasedOnMapper`, `DocumentFrameworkRegistry`) rather than replacing
them.

```
DocumentTypeDefinition ── descriptive registry (module/entity/line entity)

DocumentTransformationDefinition ──┬── DocumentTransformationVersion
                                    │     (effective-dated, immutable once
                                    │      ACTIVE — headerMapping/lineMapping/
                                    │      eligibilityRules/consumptionMetric/
                                    │      claimPolicy/tolerancePolicy)
TransformationMappingService ── safe COPY/CONSTANT/DEFAULT_SERVICE/
                                  DERIVED_RULE/LOOKUP/USER_REQUIRED/
                                  DO_NOT_COPY mapping primitives
WorkflowConditionService (reused from Phase 26) ── eligibilityRules DSL

RemainingToCreateService ── eligibleCapacity(SourceEligibilityAdapter)
                             − committedConsumption(DocumentLineLink)
                             − activeClaims(SourceCreationClaim)

DocumentCreationProposalService ── generate()/accept()/cancel() ──┬── DocumentCreationProposal
                                                                    │     ── DocumentCreationProposalLine
SourceCreationClaimService ── claim()/release()/commit()/expireDueClaims()

DocumentLink (extended) / DocumentLineLink (extended) ── the SAME tables
                              every prior phase's own posting handler
                              already writes to — never a parallel ledger
DocumentDependencyGraphService ── forward/backward/transitiveClosure/
                                    assertNoCycle over DocumentLink
DocumentImpactAnalysisService ── analyze()/assertSafeToModify() —
                                   default BLOCK + SHOW IMPACT
TransformationExceptionService / DocumentChainHealthService
```

## A. Extends `DocumentLink`/`DocumentLineLink` instead of duplicating them

Phase 0 already created `DocumentLink` (header-level source→target
relationship, `relationType: CREATED_BASED_ON | RELATED | REVERSAL_OF |
CORRECTION_OF`) and `DocumentLineLink` (line-level execution link with
`quantity`/`amount`, already used by 8+ posting handlers across Sales,
Purchase, and Warehouse modules as their own de-facto consumption
ledger — e.g. `sales-invoice.posting-handler.ts`'s `remainingInvoiceable`
sums `documentLineLink.quantity` directly). Building a second
`DocumentRelationship`/`SourceConsumptionMovement` pair of tables would
have duplicated this exact mechanism. Instead:

- `DocumentLink.relationType` gained a documented superset of values
  (`DERIVED_FROM`, `REFERENCES`, `FULFILLS`, `SETTLES`, `CORRECTS`,
  `REPLACES`, `SPLIT_FROM`, `MERGED_FROM`, `GENERATED_BY_SYSTEM`) —
  every existing value keeps its exact prior meaning.
- `DocumentLink` gained nullable `transformationVersionId`, `status`
  (`ACTIVE|SUPERSEDED|REVERSED`), `correlationId`.
- `DocumentLineLink` gained nullable `documentLinkId` (ties a line-level
  link back to its header link), `movementType`
  (`CONSUME|RELEASE|ADJUST|REVERSE`, default `CONSUME` — so every
  pre-existing insert is unaffected), `metric`, `reversalOfLineLinkId`,
  and a `(tenantId, idempotencyKey)` unique constraint for idempotent
  target creation.

`RemainingToCreateService` reads and writes exactly these same rows —
this build's own governed proposals key their `DocumentLineLink.relationType`
to the owning `DocumentTransformationDefinition.code`, so they can never
collide with a pre-existing bespoke relationType string like
`'ORDER_TO_INVOICE'` or `'SHIPMENT_TO_INVOICE'`.

## B. No retrofit of existing bespoke `remainingXxx()` helpers

Sales/Purchase/Warehouse posting handlers keep their own inline
"remaining" calculators (`remainingInvoiceable`, etc.) untouched — they
are correct, tested, and load-bearing. `RemainingToCreateService` is the
NEW, generic version any transformation registered against
`DocumentTransformationDefinition` uses going forward; it is not wired
retroactively into the ~8 existing bespoke call sites (the same
incremental-adoption posture Phase 26 took with
`WorkflowExecutionGateService`, disclosed there in section G).

## C. `SourceEligibilityAdapter` — a new, narrow extension point

Neither `DocumentRepositoryAdapter` (whole-document load/create) nor
`CreateBasedOnMapper` (header-only field mapping) can answer "how much
of this specific source LINE remains eligible for a given metric".
`DocumentFrameworkRegistry` gained a small additive
`registerEligibilityAdapter`/`getEligibilityAdapter` registry for a new
`SourceEligibilityAdapter` interface (`getEligibleCapacity`, optional
`getEligibilityBlockers`). No adapters are pre-registered in this build
— a source document type with none simply cannot participate in the
governed engine yet (`RemainingToCreateService` throws a clear,
non-silent error), consistent with Phase 26's own disclosed
`PROJECT_MANAGER`/`DYNAMIC_QUERY_RULE` approver-type gap.

## D. Claim policies are enforced identically

`SOFT_CLAIM` and `HARD_CLAIM` both block overcommitment through
`SourceCreationClaimService.claim`'s own remaining-recheck; a genuinely
stronger DB-level lock for `HARD_CLAIM` is not implemented. `expireDueClaims`
needs an external scheduler to run periodically — none is wired in this
build (same disclosed gap as Phase 26's `runDueEscalations`).

## E. Line enumeration and target-line linkage are caller-supplied

There is no single generic "get the lines of any document type"
contract across 30+ source modules, and building one would itself be
the over-centralization the spec warns against. `DocumentCreationProposalService.generate`/`accept`
take source line snapshots as input (the calling business module already
has them loaded) rather than deriving them internally. Similarly, the
generic `DocumentRepositoryAdapter.create` contract returns only the
created document's header id, not per-line ids — the `DocumentLineLink`
rows this phase writes on `accept()` point `targetLineId` at the target
document id as a placeholder; a module wanting precise target-line
granularity can additionally write its own richer `DocumentLineLink`
row once it knows the real target line id.

## F. Default posture is BLOCK + SHOW IMPACT

`DocumentImpactAnalysisService.assertSafeToModify` throws whenever any
transitive downstream document is `POSTED`, unless the caller explicitly
passes `allowPostedDownstream: true` (gated by the caller checking
`DOC_CHAIN_IMPACT_OVERRIDE` first) — this build never silently cascades
a source edit/unpost/cancel through already-posted documents.

## G. Reversal/correction delta propagation is foundation-only

`movementType: RELEASE`/`REVERSE` on `DocumentLineLink` and the
`REVERSAL_OF`/`CORRECTS` relation types exist and are used by
`RemainingToCreateService`'s own net-consumption formula, but no
business module in this build actually emits a `RELEASE` row when a
target document is unposted/cancelled — that remains each module's own
future integration, mirroring section G's posture in Phase 26.

## H. Not retrofitted into any prior phase's own creation flow

The pre-existing `CreateBasedOnService.createBasedOn` (Phase 0, immediate
single-mapper creation, no proposal/claim/remaining-quantity awareness)
is untouched and still works exactly as before. The new governed
`DocumentCreationProposalService` is an additional, parallel path for
transformations that register a `DocumentTransformationDefinition` — it
is not a forced migration of every existing "Create Based On" button.

## Permissions

`DOC_CHAIN_VIEW`, `DOC_CHAIN_TYPE_MANAGE`,
`DOC_CHAIN_TRANSFORMATION_MANAGE`, `DOC_CHAIN_TRANSFORMATION_APPROVE`,
`CREATE_BASED_ON_PROPOSE`, `CREATE_BASED_ON_ACCEPT`,
`DOC_CHAIN_CLAIM_MANAGE`, `DOC_CHAIN_RELATIONSHIP_VIEW`,
`DOC_CHAIN_LINEAGE_VIEW`, `DOC_CHAIN_IMPACT_VIEW`,
`DOC_CHAIN_IMPACT_OVERRIDE`, `DOC_CHAIN_EXCEPTION_VIEW`,
`DOC_CHAIN_EXCEPTION_RESOLVE`.
