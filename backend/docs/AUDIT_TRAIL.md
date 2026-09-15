# Phase 25 — Audit / Change History / Traceability / Evidence Platform

Implements docx spec Phase 25: an append-only, hash-chained audit trail
with actor/session context, before/after field diffs, document
lifecycle/posting/reversal traces, register-and-GL lineage, evidence,
investigations, legal hold, retention, integrity verification, and
reproducible evidence export — built as an extension of the `AuditEvent`
foundation every prior phase already writes to, not a parallel system.

```
Every module's own AuditService.record(...) call (100+ existing sites)
                       │
AuditEvent (extended) ── eventCategory/severity/actorType/sessionId/
                          causationId/documentType/operation/backdated/
                          integrityHash/previousEventHash (per-tenant
                          hash chain, all additive/nullable)
                       │
AuditFieldChange ── stable-id diffs, sensitive-field redaction
AuditSession ── login/logout/impersonation context
                       │
DocumentAuditService ── lifecycle timeline + posting/unposting/reversal
                         trace + correlation/causation chains (views
                         over AuditEvent, not a second storage table)
AuditLineageService ── forward/backward lineage over EXISTING
                        sourceDocumentType/Id FKs (JournalEntry,
                        InventoryMovement, InventoryCostLayer,
                        SettlementMovement)
ConfigurationAuditService / SensitiveAccessAuditService ── category-
                        filtered views over the same AuditEvent stream
                       │
AuditEvidenceService ── file-hash evidence, immutable once
                         referenced by a FINAL/SIGNED event
AuditInvestigationService ── timeline reconstruction across linked items
AuditSearchService ── rich multi-filter search
AuditIntegrityService ── recompute + verify the per-tenant hash chain
AuditRetentionService / AuditLegalHoldService ── expiry vs hold conflict
AuditExportService ── frozen, hashed, optionally redacted package
AuditHealthService
```

## A. Extends the existing AuditEvent rather than a parallel event store

Every one of this codebase's 100+ existing `audit.record(...)` call
sites (one per phase, going back to Phase 0) keeps compiling and
behaving identically — every Phase 25 addition to `AuditEvent`
(`eventCategory`, `severity`, `actorType`, `sessionId`, `causationId`,
`documentType`/`documentId`, `operation`, `backdated`,
`integrityHash`/`previousEventHash`, ...) is optional/defaulted. This is
the central architectural decision of this phase: rather than building
a second `AuditEvent`-shaped table and asking every prior phase to
migrate to it (impossible without touching dozens of already-verified
files), Phase 25 upgrades the ONE table those phases already write to,
in place, additively. `AuditService.record` itself now also computes and
persists the per-tenant integrity hash chain automatically — no caller
needed to change to get that.

## B. Register/GL/cost lineage reads existing FKs; only one hop each direction

`AuditLineageService` does not populate a new `AuditMovementLineage`
table. Every module already carries `sourceDocumentType`/
`sourceDocumentId` (or `registrarDocumentType`/`registrarDocumentId`)
foreign keys on its own movement tables (`JournalEntry`,
`InventoryMovement`, `InventoryCostLayer`, `SettlementMovement`) — this
service reads those directly. Only ONE HOP is generic in each
direction: forward (a source document -> everything it directly
produced) and backward (a GL entry -> its own source document). A true
multi-hop chain spanning several document types (Material Issue ->
Production Order -> Sales Order, say) would need a per-document-type
registry this build does not implement — disclosed gap.

## C. Session lifecycle exists but is not wired into login/logout

`AuditActorContextService.startSession`/`endSession` are real, callable
methods against a real `AuditSession` table, but no controller in the
Identity module calls them yet — session tracking is a foundation
piece, not yet integrated into the actual authentication flow.

## D. Configuration and sensitive-access "audit" are category-filtered views

`ConfigurationAuditService` and `SensitiveAccessAuditService` do not own
dedicated `AuditConfigurationChange`/`AuditAccessEvent` tables — both
write ordinary `AuditEvent` rows tagged `eventCategory: 'CONFIGURATION'`
/`'ACCESS'`, with the spec's own extra fields (`fieldsAccessed`,
`purpose`, `impactScope`, ...) folded into the generic `metadata` JSON
column. This keeps every configuration change and every sensitive
access inside the SAME hash-chained, searchable, exportable event
stream as everything else, rather than a second stream that could
silently diverge.

## E. Audit policy is entity-type-level, not the full matrix

`AuditPolicyService` decides "should this read be logged" and "is this
a HIGH_ASSURANCE resource type" from a small curated
resource-type -> level lookup, not the full
entity+field+operation+organization+sensitivity+retention-class matrix
spec section 48 describes.

## F. No rebuildable search projection

`AuditSearchService` queries `AuditEvent` directly. Spec section 119's
own `AuditSearchIndex` rebuildable-projection idea is not implemented —
at this build's scale the authoritative table already carries every
filterable field, so a separate projection would be premature.

## G. Hash chain is per-tenant, single-stream, and best-effort under concurrency

Spec section 83 itself flags that "a global single chain can be a
large-scale bottleneck" and recommends partitioned chains — not
implemented here (one chain per tenant, not per-day/category). Because
`AuditService.record` reads "the latest event's hash" and writes its own
in two separate steps without a serializing lock, two events committed
in the same instant can legitimately reference the same
`previousEventHash` (a benign fork). `AuditIntegrityService.verify`
reports such cases as `chainBreaks` candidates for a human/automated
reviewer to classify, rather than asserting they are always tampering.

## H. Legal hold release has no independent-approver enforcement

`AuditLegalHoldService.release` records both `openedBy` and
`releasedBy` but does not programmatically block the SAME user from
doing both (spec section 142's segregation-of-duties note is
disclosed, not enforced).

## I. Retention evaluation never executes disposition

`AuditRetentionService.evaluate` returns which events are
archive/anonymize/purge-eligible (respecting active legal holds) but
does not itself delete, anonymize, or move anything — an actual
scheduled archive/purge job is an operational process outside this
build's scope, consistent with spec section 92's "policy-driven,"
never silently automatic.

## Permissions

`AUDIT_VIEW` (pre-existing from Phase 0), `AUDIT_VIEW_ENTITY_HISTORY`,
`AUDIT_VIEW_DOCUMENT_HISTORY`, `AUDIT_VIEW_POSTING_TRACE`,
`AUDIT_VIEW_CONFIG_HISTORY`, `AUDIT_VIEW_SECURITY_EVENTS`,
`AUDIT_VIEW_SENSITIVE_ACCESS`, `AUDIT_VIEW_SENSITIVE_VALUES`,
`AUDIT_SEARCH_GLOBAL`, `AUDIT_INVESTIGATION_CREATE`,
`AUDIT_INVESTIGATION_EDIT`, `AUDIT_EVIDENCE_ADD`, `AUDIT_EXPORT`,
`AUDIT_EXPORT_SENSITIVE`, `AUDIT_VERIFY_INTEGRITY`,
`AUDIT_LEGAL_HOLD_CREATE`, `AUDIT_LEGAL_HOLD_RELEASE`,
`AUDIT_RETENTION_MANAGE`, `AUDIT_ADMIN`.
