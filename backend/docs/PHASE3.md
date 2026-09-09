# Phase 3 — Counterparty Master Data + Pricing

Completion report for Phase 3. Builds entirely on Phase 0/1/2 — no prior
infrastructure duplicated: audit, optimistic concurrency, RBAC/organization
access, and error model are all reused as-is.

## A. Entity model

| Entity | Scope | Purpose |
|---|---|---|
| `UnitConversion` | Tenant | fromUnit → toUnit factor (1 box = 12 pcs). |
| `Counterparty` | Organization | Customer/Supplier/BOTH master data. |
| `CounterpartyAddress` | Counterparty | Legal/shipping/billing addresses. |
| `CounterpartyContact` | Counterparty | Contact persons. |
| `PriceList` | Organization | Effective-dated pricing rules per type/currency/counterparty. |
| `ProductPrice` | PriceList | Product × unit × quantity-break prices. |

## B. Access control

Same two layers as Phase 1/2:
1. **RBAC** — `unit_conversion.*`, `counterparty.*`, `price_list.*`, `product_price.*`.
2. **Organization access** — counterparties, price lists, and product prices are
   organization-scoped via `OrganizationAccessService.assertAccess`. Unit conversions
   are tenant-scoped (no org check).

## C. Price resolution

`PriceListService.resolvePrice(tenantId, membershipId, organizationId, type, productId, date, qty, counterpartyId?)`:
1. Loads active lists matching `(organizationId, priceListType, validFrom <= date <= validTo ?? ∞)`.
2. Sorts: counterparty-specific match first, then priority desc.
3. Within each list, picks the quantity break containing `qty` (highest `minQuantity` ≤ qty, `maxQuantity` null or ≥ qty).
4. Returns the price row + list code, or `null` if no match.

## D. Validation

- Conversions: from ≠ to, factor > 0, unique (tenantId, fromUnitId, toUnitId).
- Counterparties: type in CUSTOMER/SUPPLIER/BOTH, code unique per org, currency must exist.
- Price lists: type in SALE/PURCHASE, code unique per org, counterparty (if set) must belong to same org.
- Product prices: price > 0, product must belong to same org, unit must exist in tenant, unique (list, product, unit, minQuantity).

## E. Database

New tables: `unit_conversions`, `counterparties`, `counterparty_addresses`,
`counterparty_contacts`, `price_lists`, `product_prices`.

Key constraints:
| Table | Unique |
|---|---|
| `unit_conversions` | `(tenantId, fromUnitId, toUnitId)` |
| `counterparties` | `(organizationId, code)` |
| `price_lists` | `(organizationId, code)` |
| `product_prices` | `(priceListId, productId, unitId, minQuantity)` |

## F. Permissions (14 new, 77 total)

`unit_conversion.{view,create,edit,deactivate}` ·
`counterparty.{view,create,edit,deactivate}` ·
`price_list.{view,create,edit,deactivate}` ·
`product_price.{view,manage}`

## G. API endpoints

- `GET/POST /unit-conversions`, `GET/PATCH/POST-deactivate /unit-conversions/:id`
- `GET/POST /organizations/:orgId/counterparties`, `GET .../search`, `GET/PATCH/POST-deactivate .../:id`, `POST .../:id/addresses`, `POST .../:id/contacts`
- `GET/POST /organizations/:orgId/price-lists`, `GET/PATCH/POST-deactivate .../:id`, `POST .../:id/prices`, `GET .../:id/resolve-price/:productId?type=&date=&quantity=&counterpartyId=`

## H. Out of scope (Phase 4+)

No sales/purchase orders, invoices, payments, stock movements, document posting against prices yet. This is master data + price resolution only.

## I. Phase 4 readiness

Sales/Purchase documents can call `resolvePrice` with (orgId, type, productId, businessDate, qty, counterpartyId) to get the price at document time. Counterparty IDs are stable org-safe FKs for document headers.
