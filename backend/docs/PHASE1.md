# Phase 1 — Organization & Business Structure

Completion report per spec section 78. Builds entirely on the Phase 0
foundation (`docs/ARCHITECTURE.md`) — no Phase 0 infrastructure was
duplicated: audit, optimistic concurrency, the transaction helper, the
error model, and the RBAC/guard chain are all reused as-is.

## A. Entity model

| Entity | Scope | Purpose |
|---|---|---|
| `Organization` | Tenant | Legal accounting/business entity. A tenant may have one or many. |
| `Branch` | Organization | Optional operating subdivision (office/location). |
| `Department` | Organization | Hierarchical org-chart node, optionally tied to a branch. |
| `ResponsiblePerson` | Tenant | Lightweight manager/responsible-party reference — NOT the future Phase 17 Employee model, and not required to have a system login. |
| `Warehouse` | Organization | Structural warehouse master data only — no stock. |
| `Cashbox` | Organization | Structural cash-holding-point master data only — no balances. |
| `BankAccount` | Organization | Bank account master data only — no statements/payments. |
| `AccountingPolicy` | Organization | Effective-dated policy metadata (costing method, base currency) — no ledger. |
| `TaxProfile` | Organization | Effective-dated tax identity/registration — no VAT calculation. |
| `OrganizationAccess` | Membership ↔ Organization | Explicit access grant — see section C. |

## B. Hierarchy rules

```
Tenant
 └─ Organization  (unique code per tenant)
     ├─ Branch                    (optional; unique code per organization)
     │   ├─ Department            (optional branchId)
     │   ├─ Warehouse             (optional branchId)
     │   └─ Cashbox               (optional branchId)
     ├─ Department                (optional parentDepartmentId — hierarchical)
     ├─ Warehouse
     ├─ Cashbox
     ├─ BankAccount
     ├─ AccountingPolicy          (effective-dated)
     └─ TaxProfile                (effective-dated)
```

- A Branch/Warehouse/Cashbox optionally attached to a Branch must belong to
  the **same** Organization as that Branch (`StructuralValidationService.
  assertBranchBelongsToOrganization`).
- Department hierarchy is validated server-side (`DepartmentService.
  assertNoCycle`): a department cannot be its own parent, and re-parenting
  into one of its own descendants is rejected — never trusted to a frontend
  tree widget alone.
- `ResponsiblePerson` is tenant-global, not organization-scoped (section 44)
  — a branch manager and a warehouse's responsible person only need to
  share a tenant, not an organization.

## C. Access control

Two independent layers, both enforced server-side:

1. **RBAC** (Phase 0, reused as-is) — permission codes like
   `organization.view`, `warehouse.create` gate the endpoint itself.
2. **Organization-scoped access** (new, section 22) — a `TenantMembership`
   does NOT automatically see every Organization in its tenant.
   `OrganizationAccessService.assertAccess(tenantId, membershipId,
   organizationId)` is the single choke point every org-scoped service
   calls before touching that organization's data. A missing grant reads
   identically to a foreign/non-existent organization (`404 NOT_FOUND`) —
   never distinguishable from the outside, mirroring the Phase 0 tenant
   isolation behavior.

Creating an Organization auto-grants the creator `FULL` access — a tenant
member is never able to create an org and immediately lock themselves out.
Grants are managed via `POST/GET /organizations/:id/access` and
`POST /organizations/:id/access/:membershipId/revoke`, gated by
`organization_access.manage`.

## D. Effective dating

`AccountingPolicy` and `TaxProfile` share the same effective-dating
discipline (section 29/30):

- `resolve(tenantId, organizationId, businessDate)` finds the version whose
  `[validFrom, validTo]` window contains `businessDate`.
  - **Zero matches** → explicit `VALIDATION_ERROR` ("no policy configured
    for this date"), never a silent fallback.
  - **One match** → returned.
  - **More than one match** → `CONFLICT` ("data integrity error") — this
    should be structurally impossible given overlap protection, so seeing
    it means the invariant broke and it must be surfaced, not swallowed.
- Overlap is rejected at write time (`assertNoOverlap`, shared by both
  services via `effective-date.util.ts`): creating or editing a version
  whose range intersects another active version for the same organization
  is a `409 CONFLICT`.
- **Immutability-after-use** (section 39/40): Phase 1 has no consumer that
  could have posted against a policy yet, so `AccountingPolicyService.
  assertMutable` is a documented no-op today — but every mutating method
  already routes through it, so Phase 4 can enforce real usage-locking
  there without any caller changing.

## E. Defaults

`Organization.defaultBranchId / defaultWarehouseId / defaultCashboxId /
defaultBankAccountId` are typed FK columns (never a JSON blob). Every
`setDefault` call re-validates the target belongs to that exact
organization before writing (section 31/67). When a Warehouse, Cashbox, or
Bank Account is deactivated, its organization's matching default pointer is
cleared in the same transaction (section 42/43) — a dangling default is
never possible. Bank accounts additionally enforce "at most one default,
active account per organization" with a DB partial unique index
(`bank_accounts_one_default_per_org`) plus transactional clearing of the
prior default on write (belt-and-suspenders, section 41).

## F. Database

New tables (see `prisma/schema.prisma`): `organizations` (extended),
`branches`, `departments`, `responsible_persons`, `warehouses`, `cashboxes`,
`bank_accounts`, `accounting_policies`, `tax_profiles`,
`organization_access`.

Key constraints:

| Table | Unique | Notable indexes |
|---|---|---|
| `organizations` | `(tenant_id, code)` | `tenant_id`, `(tenant_id, active)` |
| `branches` | `(organization_id, code)` | `(organization_id, active)` |
| `departments` | `(organization_id, code)` | `(organization_id, parent_department_id)`, `(organization_id, active)` |
| `warehouses` | `(organization_id, code)` | `(organization_id, active)`, `(organization_id, branch_id)` |
| `cashboxes` | `(organization_id, code)` | `(organization_id, active)` |
| `bank_accounts` | partial unique: one default+active per org | `(organization_id, active)`, `iban` |
| `accounting_policies` | `(organization_id, code, valid_from)` | `(organization_id, valid_from, valid_to)` |
| `tax_profiles` | `(organization_id, code, valid_from)` | `(organization_id, valid_from, valid_to)` |
| `organization_access` | `(tenant_membership_id, organization_id)` | `organization_id` |

Foreign keys tie every child table to `tenant_id` (defense in depth) and
`organization_id`; every cross-reference (branch↔organization,
department↔parent, warehouse↔branch, etc.) is additionally re-validated at
the service layer via `StructuralValidationService` rather than trusted to
the FK alone, since a FK can't express "must be the *same* organization as
my sibling field."

## G. Permissions

20 new permission codes (`src/rbac/permission-codes.ts`), all granted to
the seeded `TENANT_ADMIN` role automatically (51 total after Phase 1):

`organization.{view,create,edit,deactivate}` ·
`branch.{view,create,edit,deactivate}` ·
`department.{view,create,edit,deactivate}` ·
`responsible_person.{view,manage}` ·
`warehouse.{view,create,edit,deactivate}` ·
`cashbox.{view,create,edit,deactivate}` ·
`bank_account.{view,create,edit,deactivate}` ·
`accounting_policy.{view,manage}` ·
`tax_profile.{view,manage}` ·
`organization_access.manage`

## H. Audit

Every mutating operation emits a Phase 0 `AuditService.record(...)` event:
`ORGANIZATION_{CREATED,UPDATED,DEACTIVATED}`,
`BRANCH_{CREATED,UPDATED,DEACTIVATED}`,
`DEPARTMENT_{CREATED,UPDATED,DEACTIVATED}`,
`RESPONSIBLE_PERSON_{CREATED,UPDATED,DEACTIVATED}`,
`WAREHOUSE_{CREATED,UPDATED,DEACTIVATED}`,
`CASHBOX_{CREATED,UPDATED,DEACTIVATED}`,
`BANK_ACCOUNT_{CREATED,UPDATED,DEACTIVATED}`,
`ACCOUNTING_POLICY_{CREATED,CHANGED}`,
`TAX_PROFILE_{CREATED,CHANGED}`,
`ORGANIZATION_ACCESS_{GRANTED,REVOKED}`. No new audit system was built.

## I. Automated tests

`test/phase1.e2e-spec.ts` — 19 tests, all passing (run alongside the 12
Phase 0 tests, 31/31 total):

- Organization: duplicate code rejected, deactivated excluded from default
  listing but resolvable directly, no-access-grant hides it.
- Branch: duplicate code rejected, deactivation behavior.
- Department: parent/descendant resolution, self-parent rejected, circular
  hierarchy rejected.
- Warehouse: cross-organization branch rejected, duplicate code rejected,
  deactivation clears the organization default.
- Cashbox: currency required, organization ownership enforced.
- Bank account: malformed IBAN rejected, single-default-per-org enforced
  under a second "also default" create.
- Accounting policy: date resolution, overlap rejected, no-match error,
  cross-organization resolution rejected.
- Tax profile: date resolution, overlap rejected.
- Organization access: permission-but-no-grant still hides the org and its
  branches; changing the organization id in the request cannot bypass it.
- Default references: rejecting a default pointing at another org's entity.
- Optimistic concurrency: stale organization and warehouse updates rejected.
- Audit: organization events recorded with correct tenant.

## J. Phase 2 readiness

Phase 2 (Product/Nomenclature master data) can reference this foundation
directly:

- Every product will carry an `organizationId` (or be tenant-global,
  depending on the Phase 2 spec) validated the same way — reuse
  `StructuralValidationService` and `OrganizationAccessService.assertAccess`
  rather than re-inventing organization-ownership checks.
- Warehouse/Cashbox/BankAccount ids are already stable, tenant/org-safe
  foreign keys any Phase 2+ document can point to.
- `AccountingPolicyService.resolve` / `TaxProfileService.resolve` are ready
  for Phase 4/5 to call with a document's business date.
- The numbering engine (Phase 0) can be scoped by `organizationId` today —
  nothing in Phase 1 blocks that; a Phase 2+ `NumberSequence` can key off
  `(tenantId, organizationId, documentType)` immediately.

## K. Technical debt (disclosed)

- No frontend UI yet for Phase 1 (sections 49-55, 71) — being added next;
  see the running task.
- IBAN validation (`BankAccountService.assertIban`) covers AZ format
  precisely and a generic ISO 13616 shape for everything else — it is not a
  full per-country IBAN registry/checksum validator.
- `AccountingPolicyService.assertMutable` / the tax-profile equivalent are
  documented no-ops (section 39/40) since nothing can post against a policy
  yet — Phase 4/5 must wire real usage-tracking into that exact extension
  point rather than adding a parallel check elsewhere.
- No Excel import (section 57) — deliberately deferred to Phase 28 per
  spec, but every validation used here (`StructuralValidationService`,
  the per-entity services) is already reusable by a future import flow
  since it lives in the service layer, not in a controller or DTO.
- No first-time organization setup wizard (section 71) — plain CRUD
  endpoints exist; a guided multi-step UI flow was not built.
- `OrganizationAccess.accessLevel` is a free-text field with only `FULL`/
  `READ` currently meaningful — no endpoint yet enforces `READ` as
  actually read-only (that enforcement point doesn't exist until a
  write-capable Phase 2+ resource needs it).
