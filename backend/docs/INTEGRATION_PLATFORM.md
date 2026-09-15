# Phase 28 — Integration Platform / Connector Framework / Import-Export Engine

Implements docx spec Phase 28: a governed integration platform sitting
between every external system and the ERP's own domain services —
connector/adapter abstraction, a secret-reference credential boundary,
versioned contracts, a canonical message envelope with raw-payload
preservation, layered validation, versioned mapping, external-ID
resolution and matching, idempotency (reusing Phase 0's own
infrastructure) distinct from deduplication, domain-command-only
imports, retries/dead-letters/replay, webhooks/polling/file exchange,
export jobs, two-way sync conflict handling, reconciliation, and
health/observability.

```
IntegrationConnector ──── IntegrationConnectorVersion (migration lifecycle)
IntegrationConnectorRegistry ── ConnectorAdapter (GENERIC_REST/WEBHOOK/CSV)
IntegrationCredentialReference ── secret_reference only, rotation state machine
IntegrationEndpoint ── direction/protocol/environment/credential/retryPolicy

IntegrationContract ──── IntegrationContractVersion (schema, versioned)
IntegrationMappingProfile ──── IntegrationMappingVersion (safe DSL)
IntegrationPayloadReference ── hash/size/contentType/location

IntegrationMessage ──┬── IntegrationMessageAttempt (append-only)
                      ├── IntegrationStagingBatch ── IntegrationStagingRecord
                      ├── IntegrationDeduplicationResult
                      └── IntegrationDeadLetter

ExternalEntityReference ── external ID -> internal entity, never the PK
IntegrationMatchingService ── confidence-gated, no silent auto-link
IdempotencyService (Phase 0, reused) ── operation-level idempotency

IntegrationCommandRegistry ── the ONLY path to a real business effect
IntegrationImportService ── batch/chunk/strict/dryRun orchestration
IntegrationRetryService / IntegrationDeadLetterService (replay-safe)

IntegrationWebhookService (signature+replay) / IntegrationPollingService (cursor+overlap)
IntegrationExportService ── snapshot/version-tagged, idempotent delivery
IntegrationReconciliationRule/Run/Result ── external vs ERP mismatch
ExternalSyncState ── two-way conflict detection, no default last-write-wins
IntegrationObservabilityService / IntegrationHealthService
```

## A. Reuses four existing foundations instead of duplicating them

- **Idempotency**: `IntegrationIdempotencyRecord` from the spec's entity
  list is NOT a new table — Phase 0's `IdempotencyService`/`IdempotencyKey`
  already implements exactly this contract (`withIdempotency(tenantId,
  key, operation, payload, execute)`), and `IntegrationExportService.deliver`
  uses it directly, keyed `operation: 'integration.export.deliver'`.
- **Safe mapping primitives**: `IntegrationMappingService`'s
  `DIRECT`/`CONSTANT`/`LOOKUP`/`IGNORE`/`REQUIRED_MANUAL` types delegate
  to Phase 27's `TransformationMappingService.applyHeaderMapping`
  (its `COPY`/`CONSTANT`/`LOOKUP`/`DO_NOT_COPY`/`USER_REQUIRED`) rather
  than re-implementing a second safe-mapping engine; only
  `FORMAT_CONVERSION`, `VALUE_MAP` (a LOOKUP variant), `CONDITIONAL`, and
  `DERIVED_SAFE_EXPRESSION` (the same closed coalesce as Phase 27's
  `DERIVED_RULE`) are new, small, and equally non-scriptable.
- **Condition DSL**: `CONDITIONAL` mappings evaluate through Phase 26's
  `WorkflowConditionService` — a third safe boolean evaluator was not
  built.
- **Document provenance**: an imported document's `DocumentLink` (Phase
  27, `relationType: GENERATED_BY_SYSTEM`) is how "External Document ->
  Integration Message -> ERP Document" provenance (spec section 190) is
  recorded — this phase does not add a parallel provenance table. Wiring
  a concrete `IntegrationCommandHandler` to actually call
  `DocumentLinkService`/`DocumentCreationProposalService` is the
  handler's own responsibility (disclosed, no handler ships pre-wired in
  this build — see section E).

## B. Domain commands are the ONLY path to a business effect

`IntegrationCommandRegistry` holds one `IntegrationCommandHandler` per
canonical contract code; `IntegrationImportService` calls `handler.execute(...)`
inside a transaction and reports whatever `DomainCommandResult` comes
back — there is no other code path in this module that touches a
business table. No handlers ship pre-registered (same narrow-extension-
point pattern as Phase 27's `SourceEligibilityAdapter`) — a contract
with no registered handler cannot be imported (a clear
`ValidationAppError`, not a silent no-op), and `dryRun` never invokes a
handler at all.

## C. Idempotency and deduplication are kept genuinely separate

`IntegrationMessageService.receive` always inserts a new
`IntegrationMessage` row — it never itself decides "this is a repeat";
`findByIdempotencyKey` is the tool a caller (a webhook controller, a
polling loop) uses BEFORE deciding to actually process a message under
a given key. `IntegrationDeduplicationService`, by contrast, answers "is
this a different message describing the SAME external business object"
via content signals (external document number, bank transaction ID,
event hash, ...) completely independent of any idempotency key — the
Phase 28 e2e spec exercises both against the same two received messages
to show they diverge.

## D. Strict vs partial batch, and staging is never business truth

`IntegrationImportService.runBatch` always creates
`IntegrationStagingRecord` rows before any domain command executes.
Non-strict batches report a genuine per-record result mix (`CREATED`/
`REJECTED`/... independently); `strictAllOrNothing: true` wraps
processing in one transaction and rolls back entirely the moment any
record is `REJECTED`/`FAILED` — a staging record existing, even
`CREATED`, is never itself treated as proof a business document exists
independent of what `targetEntityId` the domain command actually
returned.

## E. Representative adapters/handlers only (spec section 237)

This build ships `GENERIC_REST`, `GENERIC_WEBHOOK`, and a minimal
`GENERIC_CSV` connector adapter — no XLSX/XML/fixed-width parser, no
concrete `BANK_X`/`MARKETPLACE_Y`/`CRM_A` connector, and no
`IntegrationCommandHandler` for any real business contract
(`SALES_ORDER_IMPORT`, `BANK_STATEMENT_IMPORT`, etc.) ships registered.
The framework — endpoint/connector/contract/mapping/staging/matching/
idempotency/dedup/retry/dead-letter/replay/webhook/polling/export/
reconciliation/sync-state/health — is complete and independently
tested (`test/phase28.e2e-spec.ts`) against a fake handler and fake
match resolver, exactly the same posture Phase 27 took with its
`FoundationTestDocument` fixture. A later phase/business module wires a
real `IntegrationCommandHandler`/`SourceEligibilityAdapter`/connector
adapter into these same registries without any change to this module.

## F. Payload storage is metadata-only in this build

`IntegrationPayloadReference` correctly captures hash/size/contentType/
location for every inbound/outbound payload, and `IntegrationPayloadService.store`
deduplicates by hash (spec section 85). The `location` value is a
deterministic pointer (`payload://{tenant}/{hash}`); no actual object-
storage backend is implemented behind it in this sandbox, so the raw
bytes are not separately retrievable later by this service — the
contract every other service depends on (hash/size/contentType/location)
is fully real regardless of what storage sits behind `location` in a
concrete deployment.

## G. Field ownership / conflict resolution is metadata, not a new table

Spec section 59's `IntegrationFieldOwnershipRule` is not a separate
entity in this build — field-ownership intent is expected to live as
metadata inside the owning `IntegrationMappingVersion`/`ExternalSyncState.conflictResolution`
rather than a fifth small table, consistent with this codebase's
"don't duplicate objects, fold small config into an existing owner"
discipline. `ExternalSyncStateService.resolve` requires an explicit
`ConflictResolutionPolicy` on every call — there is no code path that
defaults to last-write-wins (spec's own explicit prohibition, rule 238).

## H. Other acknowledged gaps

- Rate limiting/backpressure/circuit-breaker (spec sections 111-113) are
  config fields (`IntegrationEndpoint.rateLimitPolicy`) only — no actual
  in-process limiter/circuit-breaker state machine is implemented.
- `IntegrationPollingService`/`IntegrationRetryService` compute
  watermarks/backoff correctly but need an external scheduler to
  actually invoke them periodically — none is wired (same disclosed gap
  pattern as Phase 26's `runDueEscalations`).
- Public API versioning/scopes/OAuth (spec sections 170-177) are out of
  scope for this admin-facing controller; `/integrations/*` sits behind
  the same `RequirePermissions` guard as every other module.
- Attendance-device/manufacturing/BI-export concrete integrations (spec
  sections 185, 188-189) are not built — those business modules would
  register their own handlers/adapters.

## Permissions

`INTEGRATION_VIEW`, `INTEGRATION_ENDPOINT_VIEW`,
`INTEGRATION_ENDPOINT_EDIT`, `INTEGRATION_CONNECTOR_VIEW`,
`INTEGRATION_CONTRACT_VIEW`, `INTEGRATION_CONTRACT_EDIT`,
`INTEGRATION_MAPPING_VIEW`, `INTEGRATION_MAPPING_EDIT`,
`INTEGRATION_MAPPING_APPROVE`, `INTEGRATION_IMPORT_RUN`,
`INTEGRATION_IMPORT_COMMIT`, `INTEGRATION_EXPORT_RUN`,
`INTEGRATION_REPLAY`, `INTEGRATION_DEADLETTER_RESOLVE`,
`INTEGRATION_MANUAL_MATCH`, `INTEGRATION_RECONCILIATION_RUN`,
`INTEGRATION_CREDENTIAL_ROTATE`, `INTEGRATION_VIEW_PAYLOAD`,
`INTEGRATION_VIEW_SENSITIVE_PAYLOAD`, `INTEGRATION_ADMIN`.
