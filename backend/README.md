# ERP Platform — Phase 0: System Architecture & Foundation Core

Reusable multi-tenant ERP/accounting platform foundation. This phase
deliberately implements **no business module** (no Sales, Purchase,
Inventory, Payroll, Tax, Banking, Fixed Assets) — only the core every later
module will depend on: tenancy, identity/RBAC, the document framework,
posting infrastructure, numbering, currency, periods, audit, and a generic
document-relationship / Create Based On foundation.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/DATABASE.md`](docs/DATABASE.md),
[`docs/PERMISSIONS.md`](docs/PERMISSIONS.md), and
[`docs/EXTENDING.md`](docs/EXTENDING.md) for the full technical
documentation.

## Stack

NestJS (TypeScript) · PostgreSQL 16 via Prisma · JWT access/refresh auth ·
argon2id password hashing · Decimal.js for all financial values.

## Setup

```bash
docker compose up -d          # Postgres on localhost:5433
npm install
npx prisma migrate deploy     # apply migrations (or `prisma migrate dev` in development)
npm run prisma:seed           # currencies, permission codes, TENANT_ADMIN role, enum foundation
npm run start:dev
```

Copy `.env.example` to `.env` and adjust secrets before anything other than
local development.

## Try it

```bash
# Register + get a JWT
curl -s -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"admin@acme.test","password":"Passw0rd!23","displayName":"Admin"}'

# Create a tenant (the caller becomes its Tenant Administrator)
curl -s -X POST localhost:3000/tenants -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"code":"acme","name":"Acme Corp"}'

# All further calls need X-Tenant-Id
curl -s localhost:3000/tenants/current -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID"
```

## Tests

```bash
npm test          # unit tests
npm run test:e2e  # full-stack tests against the real Postgres instance:
                   # tenant isolation, RBAC, numbering concurrency,
                   # optimistic concurrency, save/post/unpost, period
                   # locking, Create Based On, posting atomicity
```

## Demo/reference document

`FoundationTestDocument` (`/foundation-test-documents`) is **not** a
production feature — it exists only to exercise the framework end to end
(save → number → post → unpost → audit → period guard → document links →
Create Based On) and should be removed or clearly isolated before any real
business phase ships. See [`docs/EXTENDING.md`](docs/EXTENDING.md) for how
a real document type replaces it.
