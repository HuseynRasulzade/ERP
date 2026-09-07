# ERP

A multi-tenant ERP/accounting platform, built phase by phase from a
1C-inspired architectural spec. This repo currently contains **Phase 0**
(system architecture & foundation core) and **Phase 1** (organization &
business structure), each with a working backend, frontend, and automated
test suite — not scaffolding, a running system.

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

Tests: `cd backend && npm test && npm run test:e2e` — 34 tests, all
passing (3 unit + 31 e2e against a real Postgres instance).

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

### Frontend

A dark-themed React SPA covering both phases: login/register, tenant
creation and switching, a documents workspace (create/post/unpost/cancel,
audit trail, document links, "create based on"), roles & permissions
management, accounting periods, and a full organization management area
(tabbed: General, Branches, Departments-as-tree, Warehouses, Cashboxes,
Bank Accounts, Accounting Policy, Tax Profile, Access).

## Test coverage

| Suite | Count | Covers |
|---|---|---|
| `backend/src/**/*.spec.ts` | 3 | Money/decimal precision (no float drift) |
| `backend/test/phase0.e2e-spec.ts` | 12 | Tenant isolation, RBAC, numbering concurrency, optimistic concurrency, posting atomicity, period locking, Create Based On |
| `backend/test/phase1.e2e-spec.ts` | 19 | Organization/branch/department/warehouse/cashbox/bank-account/policy invariants, organization access isolation, default-reference validation |

All run against a real PostgreSQL instance — no mocked database.

## Status

- **Phase 0** — ✅ done, tested, documented.
- **Phase 1** — ✅ done, tested, documented.
- **Phase 2+** — not started. No business modules (Sales, Purchase,
  Inventory, Payroll, Tax, Banking, Fixed Assets, ...) exist yet — those
  are later phases building on this foundation.
