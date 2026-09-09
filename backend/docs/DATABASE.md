# Phase 0 — Database

Every Phase 0 table (`prisma/schema.prisma`), its purpose, important
fields, foreign keys, unique constraints and indexes.

## tenants
Highest business isolation boundary.
- Key fields: `code` (unique), `name`, `baseCurrencyId`, `timezone`, `locale`, `status`, `version`.
- FK: `baseCurrencyId -> currencies.id`.
- Unique: `code`.

## organizations
Minimal Tenant → Organization scope placeholder (full legal-entity config is Phase 1).
- FK: `tenantId -> tenants.id`.
- Unique: `(tenantId, code)`. Index: `tenantId`.

## users
Global system user, independent of tenant membership.
- Key fields: `email` (unique), `passwordHash`, `isSystemAdmin`, `status`.
- Unique: `email`.

## tenant_memberships
A user's membership + status inside exactly one tenant. Authorization attaches here, not on `users`.
- FK: `tenantId -> tenants.id`, `userId -> users.id`.
- Unique: `(tenantId, userId)`. Index: `userId`.

## refresh_tokens
Opaque refresh tokens, stored only as a SHA-256 hash, rotated on use.
- FK: `userId -> users.id`. Index: `userId`.

## roles
Tenant-scoped role (or `tenantId = null` + `isSystem = true` for the seeded system role template).
- Unique: `(tenantId, code)`. Index: `tenantId`.

## permissions
Global catalog of machine-readable permission codes.
- Unique: `code`.

## role_permissions / membership_roles
Join tables: role ↔ permission, and membership ↔ role (many-to-many both ways).
- Composite PKs: `(roleId, permissionId)`, `(membershipId, roleId)`.

## enum_types / enum_values / enum_value_translations
Enumeration foundation for open-ended, display-facing business enums (currency rate type, numbering reset policy, plus mirrors of the closed Prisma enums for localized display).
- Unique: `enum_types.code`, `(enumTypeId, code)`, `(enumValueId, locale)`.

## currencies
Global ISO 4217 master data.
- Unique: `code`.

## exchange_rates
Currency → base currency rate, effective-dated, `tenantId` nullable for system-wide defaults.
- FK: `currencyId`, `baseCurrencyId -> currencies.id`; `tenantId -> tenants.id`.
- Unique: `(tenantId, currencyId, baseCurrencyId, effectiveDate, rateType)`. Index: `(tenantId, currencyId, effectiveDate)`.

## number_sequences
Concurrency-safe numbering sequence per tenant/code.
- FK: `tenantId -> tenants.id`.
- Unique: `(tenantId, code)`. Index: `(tenantId, documentType)`.

## accounting_periods
Open/closed business period per tenant (+ optional organization).
- FK: `tenantId -> tenants.id`, `organizationId -> organizations.id`.
- Unique: `(tenantId, organizationId, year, month)`. Index: `(tenantId, startDate, endDate)`.

## audit_events
Append-only audit trail.
- FK: `tenantId -> tenants.id` (nullable for platform-level events).
- Index: `(tenantId, entityType, entityId)`, `(tenantId, timestamp)`.

## document_links
Generic source→target document relationship (`CREATED_BASED_ON | RELATED | REVERSAL_OF | CORRECTION_OF`).
- FK: `tenantId -> tenants.id`.
- Index: `(tenantId, sourceDocumentType, sourceDocumentId)`, `(tenantId, targetDocumentType, targetDocumentId)`.

## settings
Scoped (`SYSTEM | TENANT | ORGANIZATION`), effective-dated configuration. A new row per change rather than in-place mutation.
- Index: `(scope, scopeId, key, validFrom)`.

## idempotency_keys
Idempotent-write infrastructure for API/integration operations.
- Unique: `(tenantId, key, operation)`.

## register_movements
Generic register-movement contract (no real business register yet) used by the demo posting handler; carries recorder ownership for reposting/unposting/audit.
- FK: `tenantId -> tenants.id`.
- Index: `(tenantId, recorderDocumentType, recorderDocumentId)`, `(tenantId, registerCode, businessDate)`.

## foundation_test_documents
The ONE concrete document table in Phase 0 (demo/reference only — never a production feature). Mirrors the `BaseDocumentFields` contract.
- FK: `tenantId -> tenants.id`.
- Unique: `(tenantId, number)`. Index: `(tenantId, documentDate)`, `(tenantId, status)`.

## sales_orders / sales_order_lines (Phase 4)
First real business document: customer order header + lines with
snapshotted prices/totals (`priceIncludesTax` controls the tax math).
- FK: `tenantId -> tenants.id`, `organizationId -> organizations.id`,
  `counterpartyId -> counterparties.id` (RESTRICT),
  `currencyId -> currencies.id` (SET NULL, nullable),
  lines `productId -> products.id`, `unitId -> units_of_measure.id`
  (RESTRICT), `salesOrderId -> sales_orders.id` (CASCADE).
- `priceListId`/`productPriceId` are provenance columns only (no FK —
  the snapshot survives later price-list edits).
- Unique: `(tenantId, number)`. Index: `(tenantId, documentDate)`,
  `(tenantId, status)`, `(organizationId, counterpartyId)` on the
  header; `(salesOrderId, position)`, `(tenantId, productId)` on lines.

## sales_invoices / sales_invoice_lines (Phase 4)
Billing document, standalone or drafted from an order
(`SALES_ORDER => SALES_INVOICE` CreateBasedOn). Same shape as the
order plus `sourceOrderLineId` (provenance, reserved for future
line-level fulfilment linkage — no FK).
- Same FK/delete rules, uniques, and indexes as the order tables
  (with `salesInvoiceId` in place of `salesOrderId`).

---

**Indexing rationale** (section 46): every tenant-owned table is indexed on
`tenantId` at minimum (directly or via a compound index that leads with it),
since virtually every query is tenant-scoped. Document-shaped tables add
`(tenantId, documentDate)` and `(tenantId, status)` for list/filter screens;
recorder-owned tables (`register_movements`, `document_links`) index on the
`(tenantId, recorderDocumentType/sourceDocumentType, ...Id)` pair used to
find everything generated by/related to one document.

**Migrations**: managed exclusively through `prisma migrate dev` /
`prisma migrate deploy` — no ad-hoc SQL runs at application startup.
