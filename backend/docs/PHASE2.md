# Phase 2 — Product/Nomenclature Master Data

Completion report for Phase 2. Builds entirely on the Phase 0 foundation
(`docs/ARCHITECTURE.md`) and Phase 1 (`docs/PHASE1.md`) — no Phase 0/1
infrastructure was duplicated: audit, optimistic concurrency, the
transaction helper, the error model, and the RBAC/guard chain are all
reused as-is.

## A. Entity model

| Entity | Scope | Purpose |
|---|---|---|
| `UnitOfMeasure` | Tenant | Basic measurement units (kg, piece, liter, meter, etc.) that products reference. |
| `ProductCategory` | Organization | Hierarchical product classification for organizing product catalogs. |
| `Product` | Organization | Product master data: code, name, type, base unit, physical properties. |

## B. Hierarchy rules

```
Tenant
 ├─ UnitOfMeasure           (tenant-level shared resource)
 └─ Organization
     ├─ ProductCategory      (optional parentCategoryId — hierarchical)
     └─ Product              (references category, base unit)
```

- **UnitOfMeasure** is tenant-scoped (shared across all organizations in a
  tenant) since measurement standards are typically standardized at the
  tenant level.
- **ProductCategory** is organization-scoped and hierarchical (parent-child
  relationships). Cycles are validated server-side
  (`ProductCategoryService.assertNoCycle`): a category cannot be its own
  parent, and re-parenting into one of its own descendants is rejected.
- **Product** is organization-scoped following the Phase 1 pattern. A
  product belongs to exactly one organization and references a tenant-level
  unit of measure as its base unit.

## C. Access control

Two layers enforced server-side (same as Phase 1):

1. **RBAC** (Phase 0, reused as-is) — permission codes like
   `unit_of_measure.view`, `product.create`, `product_category.edit` gate
   the endpoint itself.
2. **Organization-scoped access** (Phase 1, reused) — products and
   categories are organization-scoped, so `OrganizationAccessService.
   assertAccess(tenantId, membershipId, organizationId)` is called before
   touching those entities. Units of measure are tenant-scoped (not
   organization-scoped), so no organization access check is needed.

## D. Product types

Products are classified by type (Prisma enum `ProductType`):

- **GOODS** — Physical goods tracked in inventory (default)
- **SERVICE** — Services (no inventory tracking)
- **WORK** — Work/labor (no inventory tracking)
- **SET** — Product bundles/kits (Phase 3+ will add bundle composition)

The `trackInventory` and `allowNegativeStock` flags control inventory
behavior for Phase 10 (Inventory module).

## E. Unit types

Units of measure are classified by type (validated at service layer):

- **QUANTITY** — Countable units (pieces, boxes, etc.)
- **WEIGHT** — Mass units (kg, g, ton, lb, etc.)
- **VOLUME** — Volume units (liter, m³, gallon, etc.)
- **LENGTH** — Distance units (meter, cm, foot, etc.)
- **AREA** — Area units (m², hectare, acre, etc.)
- **TIME** — Time units (hour, day, etc.)

No conversion factors between units yet — that's Phase 3+.

## F. Validation rules

### Product category validation

- **Cycle detection**: `ProductCategoryService.assertNoCycle` walks up the
  parent chain from the proposed parent and ensures we never reach the
  category being edited. Mirrors the Phase 1 `DepartmentService` pattern.
- **Parent ownership**: A parent category must belong to the same
  organization as the child.
- **Deactivation guards**: Cannot deactivate a category if active products
  reference it, or if active child categories exist under it.

### Product validation

- **Unique codes**: Product code is unique per organization
  (`organizationId_code` unique constraint).
- **SKU/Barcode uniqueness**: SKU and barcode are unique within the tenant
  (indexed, checked at service layer before create/update).
- **Category ownership**: If a product references a category, that category
  must belong to the same organization.
- **Unit existence**: Base unit (and optional weight/volume units) must
  exist in the tenant's unit catalog.

### Unit of measure validation

- **Unique codes**: Unit code is unique per tenant (`tenantId_code` unique
  constraint).
- **Deactivation guards**: Cannot deactivate a unit if any active products
  are using it as their base unit.

## G. Database

New tables (see `prisma/schema.prisma`): `units_of_measure`,
`product_categories`, `products`.

Key constraints:

| Table | Unique | Notable indexes |
|---|---|---|
| `units_of_measure` | `(tenantId, code)` | `(tenantId, active)` |
| `product_categories` | `(organizationId, code)` | `(organizationId, active)`, `(organizationId, parentCategoryId)` |
| `products` | `(organizationId, code)` | `(organizationId, active)`, `(organizationId, categoryId)`, `(tenantId, sku)`, `(tenantId, barcode)` |

Foreign keys tie every table to `tenantId` and (for organization-scoped
entities) `organizationId`. Cross-references (product→category,
product→unit, category→parent) are re-validated at the service layer via
the respective `assert*` methods.

## H. Permissions

12 new permission codes (`src/rbac/permission-codes.ts`), all granted to
the seeded `TENANT_ADMIN` role automatically (63 total after Phase 2):

`unit_of_measure.{view,create,edit,deactivate}` ·
`product_category.{view,create,edit,deactivate}` ·
`product.{view,create,edit,deactivate}`

## I. Audit

Every mutating operation emits a Phase 0 `AuditService.record(...)` event:
`UNIT_OF_MEASURE_{CREATED,UPDATED,DEACTIVATED}`,
`PRODUCT_CATEGORY_{CREATED,UPDATED,DEACTIVATED}`,
`PRODUCT_{CREATED,UPDATED,DEACTIVATED}`. No new audit system was built.

## J. What Phase 2 does NOT include

Phase 2 is **master data only**. The following are explicitly out of scope
and belong to later phases:

- **No pricing** — no sale prices, purchase prices, price lists, or
  discounts (Phase 3+).
- **No inventory movements** — no stock balances, receipts, shipments, or
  warehouse transfers (Phase 10).
- **No supplier/customer links** — products are not yet linked to
  counterparties (Phase 3+).
- **No unit conversions** — no conversion factors between units (e.g., 1 kg
  = 1000 g) (Phase 3+).
- **No product bundles/sets** — `ProductType.SET` is defined but bundle
  composition is Phase 3+.
- **No product variants/options** — no SKU matrix, size/color variants, or
  configurable products (Phase 3+).
- **No multi-level BOMs** — no bill of materials, production recipes, or
  assembly structures (Phase 11+).

## K. API endpoints

### Units of Measure (tenant-scoped)

- `GET /units-of-measure` — list all units (permission:
  `unit_of_measure.view`)
- `POST /units-of-measure` — create a unit (permission:
  `unit_of_measure.create`)
- `GET /units-of-measure/:id` — get one unit (permission:
  `unit_of_measure.view`)
- `PATCH /units-of-measure/:id` — update a unit (permission:
  `unit_of_measure.edit`)
- `POST /units-of-measure/:id/deactivate` — deactivate a unit (permission:
  `unit_of_measure.deactivate`)

### Product Categories (organization-scoped)

- `GET /organizations/:organizationId/product-categories` — list categories
  (permission: `product_category.view`)
- `POST /organizations/:organizationId/product-categories` — create a
  category (permission: `product_category.create`)
- `GET /organizations/:organizationId/product-categories/:id` — get one
  category (permission: `product_category.view`)
- `GET /organizations/:organizationId/product-categories/:id/descendants` —
  get all descendant category IDs (permission: `product_category.view`)
- `PATCH /organizations/:organizationId/product-categories/:id` — update a
  category (permission: `product_category.edit`)
- `POST /organizations/:organizationId/product-categories/:id/deactivate` —
  deactivate a category (permission: `product_category.deactivate`)

### Products (organization-scoped)

- `GET /organizations/:organizationId/products` — list products (permission:
  `product.view`)
- `GET /organizations/:organizationId/products/search?q=<query>` — search
  products by code/name/SKU/barcode (permission: `product.view`)
- `POST /organizations/:organizationId/products` — create a product
  (permission: `product.create`)
- `GET /organizations/:organizationId/products/:id` — get one product
  (permission: `product.view`)
- `PATCH /organizations/:organizationId/products/:id` — update a product
  (permission: `product.edit`)
- `POST /organizations/:organizationId/products/:id/deactivate` — deactivate
  a product (permission: `product.deactivate`)

## L. Phase 3 readiness

Phase 3 (Counterparty master data + Pricing) can reference this foundation
directly:

- Products are stable, organization-scoped identities that pricing,
  supplier/customer links, and transactional documents can reference.
- The `ProductService.search` method is ready for Phase 3+ document line-item
  pickers to use.
- Product categories provide the classification structure for price lists,
  discounts, and reporting hierarchies.
- Units of measure are ready for Phase 3+ to add conversion factors and
  multi-unit pricing.

## M. Technical debt (disclosed)

- No frontend UI yet for Phase 2 — being added next.
- No unit conversion factors yet — products only have a base unit, no
  alternative units or conversion rules (Phase 3+).
- `ProductType.SET` is defined but bundle composition (which products are
  in the set) is not implemented yet (Phase 3+).
- Product deactivation does not yet check if any transactional documents
  reference the product (since no transactional documents exist yet) — Phase
  3+ sales/purchase modules must add that check.
- No Excel import yet (section 57) — deliberately deferred to Phase 28 per
  spec, but every validation used here (`ProductCategoryService.assertNoCycle`,
  the per-entity services) is already reusable by a future import flow.
- No product variants/SKU matrix yet (Phase 3+).
