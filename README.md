# ERP

A multi-tenant ERP/accounting platform, built phase by phase from a
1C-inspired architectural spec. This repo currently contains **Phase 0**
(system architecture & foundation core), **Phase 1** (organization &
business structure), **Phase 2** (product/nomenclature master data),
**Phase 3** (counterparty master data + pricing), and **Phase 4** (sales
orders + invoices — the first real business documents), each with a
working backend, frontend, and automated test suite — not
scaffolding, a running system.

```
ERP/
├── backend/    NestJS + TypeScript + PostgreSQL (Prisma) API
└── frontend/   React + Vite + TypeScript SPA
```

## Quick start

```bash
# Backend
cd backend
docker compose up -d          # Postgres on localhost:5433
npm install
npx prisma migrate deploy
npm run prisma:seed           # currencies, permission codes, TENANT_ADMIN role
npm run start:dev             # http://localhost:3000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Register a user, create a tenant (you become its Tenant Administrator),
and you're in.

Tests: `cd backend && npm test && npm run test:e2e` — 53 tests, all
passing (3 unit + 50 e2e against a real Postgres instance).

---

## What we've built

### Phase 0 — System architecture & foundation core

The reusable platform every later business module (invoicing, inventory,
payroll, ...) will sit on top of. No business logic lives here — only the
guarantees an ERP needs underneath one.

- **Multi-tenancy** — every record is scoped to a tenant; cross-tenant
  access (even guessing a valid ID from another tenant) returns an
  identical "not found," never a permission error that would confirm the
  record exists.
- **Auth & RBAC** — JWT access/refresh tokens (argon2id password hashing,
  refresh-token rotation), roles built from granular permission codes
  (`documents.post`, `periods.close`, ...) — never a hardcoded `role ===
  'admin'` check anywhere in the codebase.
- **Document framework** — a generic save → post → unpost → cancel
  lifecycle. Saving a document never implies posting it. A registry
  (`DocumentFrameworkRegistry`) lets a new document type plug in a posting
  handler without editing the posting engine itself.
- **Posting transactions** — atomic and all-or-nothing: validate → lock →
  generate movements → flip status → audit, all in one DB transaction. If
  any step fails, nothing is left half-posted — verified by deliberately
  injecting a mid-transaction failure in the test suite and checking zero
  movements survive.
- **Numbering engine** — generates sequential document numbers
  (`FTD-2026-000001`) using row-level locking, not `SELECT MAX()+1` — 60
  concurrent document creations in the test suite produce 60 unique
  numbers, zero collisions.
- **Accounting periods** — open/close periods; a closed period blocks new
  postings even for a user who otherwise has permission to post.
- **Currency, audit, document relationships, Create Based On, settings,
  idempotency** — supporting infrastructure reused by every phase after
  this one.

Full write-up: [`backend/docs/ARCHITECTURE.md`](backend/docs/ARCHITECTURE.md),
[`DATABASE.md`](backend/docs/DATABASE.md),
[`PERMISSIONS.md`](backend/docs/PERMISSIONS.md),
[`EXTENDING.md`](backend/docs/EXTENDING.md).

### Phase 1 — Organization & business structure

The internal business structure every tenant needs before any real
transaction can reference it.

- **Organization** (legal entity) → **Branch** → **Department**
  (hierarchical, cycle-checked) → **Warehouse** / **Cashbox** / **Bank
  Account** (master data only — no balances or movements yet, those come
  in later phases) → **Accounting Policy** / **Tax Profile**
  (effective-dated configuration, no ledger or VAT calculation yet).
- **Organization-scoped access control** — on top of tenant-level RBAC, a
  tenant membership does *not* automatically see every organization in its
  tenant; access is an explicit grant, checked the same way tenant
  isolation is (missing grant = "not found," not "forbidden").
- **Effective dating** — an Accounting Policy or Tax Profile resolves by
  business date (`resolve(orgId, date)` → the version valid on that date);
  overlapping date ranges are rejected at write time, and a business date
  with no matching version is an explicit error, never a silent guess.
- **Default-reference integrity** — deactivating a warehouse/cashbox/bank
  account automatically clears it as that organization's default rather
  than leaving a dangling pointer; "one default bank account per
  organization" is enforced by a database constraint, not just app code.

Full write-up: [`backend/docs/PHASE1.md`](backend/docs/PHASE1.md).

### Phase 2 — Product/Nomenclature master data

The product catalog foundation every transactional module (Sales, Purchase,
Inventory, Manufacturing) will reference.

- **Unit of Measure** (tenant-level) → measurement units (kg, piece, liter,
  meter) that products reference. Type classification (QUANTITY, WEIGHT,
  VOLUME, LENGTH, AREA, TIME) with validation. No conversion factors yet
  (Phase 3+).
- **Product Category** (organization-scoped) → hierarchical product
  classification with cycle detection (same pattern as Department hierarchy).
  Validated server-side: a category cannot be its own parent, and
  re-parenting into a descendant is rejected.
- **Product** (organization-scoped) → product master data: code, name, type
  (GOODS/SERVICE/WORK/SET), base unit, category, physical properties
  (weight/volume), SKU, barcode. Master data only — no pricing, no inventory
  balances, no supplier/customer links yet (Phase 3+).
- **Validation & uniqueness** — product codes unique per organization,
  SKU/barcode unique per tenant (indexed), units unique per tenant.
  Deactivation guards prevent removing a unit/category still referenced by
  active products.
- **Organization-scoped access** — products and categories follow Phase 1's
  organization access model: `OrganizationAccessService.assertAccess` gates
  every operation.

Full write-up: [`backend/docs/PHASE2.md`](backend/docs/PHASE2.md).

### Phase 3 — Counterparty master data + pricing

Customer/supplier master data with addresses and contacts, plus
effective-dated price lists with quantity breaks and a
`resolvePrice(org, type, product, date, qty, counterparty?)` engine —
the price source every sales/purchase document snapshots at save time.

Full write-up: [`backend/docs/PHASE3.md`](backend/docs/PHASE3.md).

### Phase 4 — Sales orders + invoices

The first real business documents on the document framework. Orders and
invoices snapshot SALE prices + totals at SAVE (posting never
re-resolves), post one register movement per line
(`SALES_ORDER_REGISTER` / `SALES_SETTLEMENT_REGISTER ·
RECEIVABLE_ACCRUAL`), and support SALES_ORDER ⇒ SALES_INVOICE "create
based on" (header-only draft + link, lines added before posting).

Full write-up: [`backend/docs/PHASE4.md`](backend/docs/PHASE4.md).

### Frontend

A dark-themed React SPA covering all phases: login/register, tenant
creation and switching, a documents workspace (create/post/unpost/cancel,
audit trail, document links, "create based on"), a sales workspace
(orders + invoices with lines, price snapshots, order ⇒ invoice
drafting), roles & permissions management, accounting periods, and a
full organization management area (tabbed: General, Branches,
Departments-as-tree, Warehouses, Cashboxes, Bank Accounts, Accounting
Policy, Tax Profile, Access).

## Test coverage

| Suite | Count | Covers |
|---|---|---|
| `backend/src/**/*.spec.ts` | 3 | Money/decimal precision (no float drift) |
| `backend/test/phase0.e2e-spec.ts` | 12 | Tenant isolation, RBAC, numbering concurrency, optimistic concurrency, posting atomicity, period locking, Create Based On |
| `backend/test/phase1.e2e-spec.ts` | 19 | Organization/branch/department/warehouse/cashbox/bank-account/policy invariants, organization access isolation, default-reference validation |
| `backend/test/phase2.e2e-spec.ts` | 19 | Unit of measure CRUD, product category hierarchy/cycle detection, product CRUD with SKU/barcode uniqueness, organization access isolation, deactivation guards |
| `backend/test/phase3.e2e-spec.ts` | 15 | Unit conversions, counterparty CRUD/addresses/contacts, price lists/prices, price resolution, isolation |
| `backend/test/phase4.e2e-spec.ts` | 17 | Price snapshotting, explicit-price override, customer-only guard, isolation/concurrency, post/unpost/cancel with movements, closed-period block, invoice flow, order ⇒ invoice CreateBasedOn |

All run against a real PostgreSQL instance — no mocked database.

## Status

- **Phase 0** — ✅ done, tested, documented.
- **Phase 1** — ✅ done, tested, documented.
- **Phase 2** — ✅ done, tested, documented.
- **Phase 3** — ✅ done, tested, documented.
- **Phase 4** — ✅ done (backend + tests + docs; run `npx prisma migrate
  deploy` + `npm run prisma:seed` to pick up the sales tables and the 6
  new permission codes), frontend sales workspace included.
- **Phase 5+** — not started. No purchase documents, payments, inventory
  movements, or further transactional business modules (Purchase,
  Inventory, Payroll, Tax, Banking, Fixed Assets, ...) exist yet — those
  are later phases building on this foundation.
