# ERP

A multi-tenant ERP/accounting platform, built phase by phase (1C-inspired
architecture). This repo currently contains **Phase 0** (system
architecture & foundation core) and **Phase 1** (organization & business
structure).

```
ERP/
├── backend/    NestJS + TypeScript + PostgreSQL (Prisma) API
└── frontend/   React + Vite + TypeScript SPA
```

## Backend

```bash
cd backend
docker compose up -d          # Postgres on localhost:5433
npm install
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev             # http://localhost:3000
```

Tests: `npm test` (unit) and `npm run test:e2e` (full acceptance-scenario
suite against the real database).

Full technical documentation: [`backend/docs/`](backend/docs) —
[`ARCHITECTURE.md`](backend/docs/ARCHITECTURE.md),
[`DATABASE.md`](backend/docs/DATABASE.md),
[`PERMISSIONS.md`](backend/docs/PERMISSIONS.md),
[`EXTENDING.md`](backend/docs/EXTENDING.md),
[`PHASE1.md`](backend/docs/PHASE1.md).

## Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Expects the backend at `VITE_API_URL` (see `.env`, default
`http://localhost:3000`).

## Status

- **Phase 0** — tenancy, RBAC, document/posting framework, numbering,
  currency, periods, audit, Create Based On. ✅
- **Phase 1** — Organization, Branch, Department, Warehouse, Cashbox, Bank
  Account, Accounting Policy, Tax Profile, organization-scoped access. ✅
- **Phase 2+** — not started yet.

No business modules (Sales, Purchase, Inventory, Payroll, Tax, Banking,
Fixed Assets, ...) exist yet — those are later phases building on this
foundation.
