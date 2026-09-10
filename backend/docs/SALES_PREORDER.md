# Sales Pre-Order & Order Management

Completion report for the docx spec's **"Phase 6 — Sales Pre-Order &
Order Management"**. Module: `src/sales-preorder/`. Builds on Phase 0-3
(document framework, org structure, counterparties/pricing) and the Tax
Engine (preview only — see section D).

## A. Sales pre-order architecture

```
CustomerRequest -> CommercialOffer -> SalesOrder -> StockReservation
                                                   -> OrderPaymentSchedule
                                                   -> ShipmentPlan
```

`CustomerRequest` and `CommercialOffer` are registered with the generic
`DocumentFrameworkRegistry` as `DocumentRepositoryAdapter`s only — no
`DocumentPostingHandler` — so the existing Create Based On engine
(`POST /documents/:type/:id/create-based-on/:targetType`) drives both
conversions without any new framework code. Neither type ever posts
(spec section 102): there is no `/documents/CUSTOMER_REQUEST/{id}/post`
handler to find.

**`SalesOrder` plays this spec's `CustomerOrder` role** rather than a
duplicate table. It already had no accounting consequence before this
build — exactly what `CustomerOrder` requires — so extending it (new
status columns, a richer `validateForPosting`) was more honest than
standing up a parallel entity with its own save/update/line logic. The
existing `postingStatus = POSTED` flip **is** `CONFIRMED`; the generic
`post`/`unpost` commands are reused as `confirm`/`reopen` (friendly
routes added, same underlying command).

## B. Customer Order state model

Five independent axes, never collapsed into one status (spec section 16):

| Axis | Values | Source |
|---|---|---|
| Document status | DRAFT / ACTIVE / CANCELLED (Phase 0's generic `DocumentStatus`) | `postingStatus=POSTED` on confirm |
| Fulfillment | NOT_STARTED / PARTIALLY_FULFILLED / FULFILLED / CANCELLED | `OrderFulfillmentService` (computed) |
| Reservation | NOT_RESERVED / PARTIALLY_RESERVED / FULLY_RESERVED / RESERVATION_NOT_REQUIRED | `OrderFulfillmentService` (computed) |
| Payment | NOT_PAID (only value reachable in this build) | stored, spec explicitly forbids fabricating PARTIALLY_PAID/PAID without Phase 13 |
| Credit | NOT_CHECKED / WITHIN_LIMIT / WARNING / BLOCKED | `CreditCheckService`, set on every confirmation attempt |

## C. Price calculation

`CommercialOfferService.resolveLines` — same `PriceListService.resolvePrice`
Phase 3/4 already use, plus:
1. Line discount (`discountPercent` → `discountAmount`) applied to
   `price × quantity` before tax (spec section 11's exact order).
2. An explicit `price` that differs from the resolved one requires
   `sales.price.override` and is audited (`PRICE_OVERRIDDEN`).
3. The discounted amount is handed to the real Tax Engine for the Tax
   Preview (section D).

## D. Tax Preview

`TaxCalculationService.calculateLine` is called directly — the same pure
function [Sales Reconciliation](./SALES_RECONCILIATION.md) uses for real
posting — but its result is stored on the `CommercialOfferLine`/
`SalesOrderLine` row and **nothing calls `TaxRegisterService`**, so no
`TaxMovement` is ever written for a Request/Offer/(unconfirmed-or-confirmed)
Order. Verified explicitly in `test/sales-preorder.e2e-spec.ts` ("no
Tax Register entry" and "no accounting/tax consequence" assertions).

## E. Reservation

`StockReservation` is a planning/commitment row — no `RegisterMovement`
with a stock-related code is ever written when one is created (verified
in tests). **Availability is checked only against the order line's own
remaining orderable quantity** (`ordered − cancelled − already reserved`),
not real warehouse stock — there is no Inventory module (Phase 10) to
source `physical_stock` from. `StockAvailabilityService`/
`ExpectedStockService` (spec sections 35, 43) are **not implemented**,
not even as stub interfaces — this is disclosed rather than built as
dead code; Phase 10 should introduce them for real. The concurrency
contract this build DOES provide (spec section 39): the remaining-quantity
check and the row insert happen in the same transaction, so two
concurrent reservation requests against the same line cannot together
exceed that line's remaining quantity — proven by the oversubscription
test, not by a dedicated true-concurrency (simultaneous request) test
(see Technical Debt).

## F. Payment Schedule

No `PaymentTerms` entity exists in this codebase's actual Phase 3 (it
stops at `Counterparty.paymentTerms: Int? // days`) to derive a schedule
from automatically. `PaymentScheduleService.generate` therefore takes
the installments (due date + percentage-or-amount) directly from the
caller rather than deriving them — the calculation discipline the spec
cares about (deterministic rounding: every installment except the last
is `round(total × pct)`, the last absorbs the remainder so the schedule
always sums to exactly the order total) is still centralized and tested.

## G. Credit

`CreditCheckService.check` compares the new order amount against
`Counterparty.creditLimit` only. `currentExposure` is always `null` —
there is no AR/settlement module (Phase 13) to source real existing debt
from, and the spec explicitly forbids fabricating one. `BLOCK` policy
(order amount beyond a 10% grace band over the limit) rejects
confirmation with `CREDIT_CHECK_BLOCKED`; `WARN` (within the grace band)
is recorded on the order's `creditStatus` but does not block. A future
Phase 13 integration should replace `currentExposure: null` with a real
value and this check becomes a true projected-exposure check without any
interface change.

## H. Fulfillment

`OrderFulfillmentService` computes, per line, live from the operational
sources of truth — never a stored, independently-editable total:
- `fulfilled` — sum of `DocumentLineLink` rows with
  `relationType = 'ORDER_TO_SHIPMENT'` (always zero in this build; ready
  for Phase 7 to write them)
- `reserved` — sum of ACTIVE/PARTIALLY_RELEASED `StockReservation`
- `planned` — sum of `ShipmentPlanLine` on a non-cancelled plan
- `remaining = ordered − fulfilled − cancelled` (reservation is
  deliberately excluded from this formula, spec section 27)

## I. Document chain

`DocumentLink` (Phase 0, header-level: Request→Offer→Order via Create
Based On) plus `DocumentLineLink` (new, generic, line-level — spec
sections 29-30). The latter is intentionally reusable: Phase 7 will
write `ORDER_TO_SHIPMENT` rows into the exact same table with no schema
change here.

## J. Permissions

25 new codes: `sales.customer_request.{view,create,edit,cancel}`,
`sales.offer.{view,create,edit,send,accept,cancel,convert}`,
`sales.order.{confirm,cancel,reopen}`, `sales.price.override`,
`sales.discount.override`, `sales.credit.override`,
`sales.reservation.{view,manage}`, `sales.shipment_plan.{view,manage}`,
`sales.payment_schedule.view`, `sales.fulfillment.view`,
`sales.order_hold.manage`. (`sales.order.view/create/edit` were already
defined for `SalesOrder` in the earlier Sales Documents build and are
reused here rather than duplicated.)

## K. Audit

`CUSTOMER_REQUEST_CREATED`, `CUSTOMER_REQUEST_CANCELLED`,
`COMMERCIAL_OFFER_CREATED`, `COMMERCIAL_OFFER_SENT`,
`COMMERCIAL_OFFER_ACCEPTED`, `COMMERCIAL_OFFER_REJECTED`,
`COMMERCIAL_OFFER_CANCELLED`, `PRICE_OVERRIDDEN`, `RESERVATION_CREATED`,
`RESERVATION_RELEASED`, `SHIPMENT_PLAN_CREATED`,
`SHIPMENT_PLAN_CANCELLED`, `PAYMENT_SCHEDULE_GENERATED`,
`ORDER_HOLD_PLACED`, `ORDER_HOLD_RELEASED`. Existing
`DOCUMENT_CREATED`/`DOCUMENT_POSTED`/`DOCUMENT_UNPOSTED` events cover the
Create Based On conversions and order confirm/reopen — not duplicated.
Not yet emitted: `COMMERCIAL_OFFER_EXPIRED` (status is derived, never
written — see section C — so there's no write to attach an event to),
`CUSTOMER_ORDER_CHANGED`, `DISCOUNT_OVERRIDDEN`,
`CREDIT_OVERRIDE_APPLIED` (override features not built, see Technical
Debt), `RESERVATION_EXPIRED`, `RESERVATION_CONSUMED`.

## L. Database

New tables: `customer_requests`, `customer_request_lines`,
`commercial_offers`, `commercial_offer_lines`, `document_line_links`,
`stock_reservations`, `shipment_plans`, `shipment_plan_lines`,
`order_payment_schedules`, `order_holds`. `sales_orders` /
`sales_order_lines` extended (see git history / schema comments for the
full column list) rather than duplicated.

## M. Tests

`test/sales-preorder.e2e-spec.ts` — 17 tests: CustomerRequest create/
cancel with no price required; CommercialOffer price resolution +
discount + Tax Preview against the real Tax Engine (verified: no
TaxMovement written); send→accept lifecycle with audit; derived EXPIRED
status without a write; Offer→SalesOrder conversion preserving the exact
offered price/tax (not re-resolved) and rejecting a non-ACCEPTED offer;
Request→Offer conversion with header inheritance and status transition;
order confirmation as the reused post command — within-credit-limit
succeeds with an explicit zero-JournalEntry/zero-AccountingMovement/
zero-TaxMovement assertion, over-limit is BLOCKED, an active hold blocks
and releasing it unblocks; reservation create/oversubscription-reject/
release with reservationStatus transitions and a zero-stock-movement
assertion; fulfillment summary computed correctly with reservation
excluded from `remaining`; shipment plan creation within remaining
quantity and rejection beyond it, with fulfillmentStatus proven
unaffected; payment schedule generation with exact-total rounding and
mismatch rejection; tenant isolation. All passing alongside the
pre-existing 130 tests (147 e2e total, 150 with unit tests).

## N. Phase 7 readiness

A future Shipment/Sales Invoice module can determine, from a `SalesOrder`
alone: remaining quantity (`OrderFulfillmentService.remainingForLine`),
allowed-to-ship quantity (same, minus already-planned via
`ShipmentPlanLine` if the policy requires respecting the plan), price/
discount/tax (already on `SalesOrderLine`, preserved verbatim from the
offer), counterparty/currency (header fields), and delivery data
(`promisedDeliveryDate`, `warehouseId`) — without any redesign here.
Writing a `DocumentLineLink` with `relationType = 'ORDER_TO_SHIPMENT'`
when a shipment executes is the only integration point
`OrderFulfillmentService` needs to start reporting real `fulfilled`
quantities.

## O. Deferred tax/functionality areas (spec-sanctioned)

- Only VAT preview (via the Tax Engine); no other tax type participates
  in Offer/Order calculation — matches the Tax Engine's own scope.
- `TaxRegistration` status is not consulted before showing a Tax Preview
  (same gap already disclosed in `TAX_ENGINE.md`).
- Reverse-charge/self-assessment context is not exercised here.

## P. Technical debt

- **No `Partner`/`Contract`/`Agreement`/`PriceType` entities.** Phase 3 as
  actually built in this codebase stops at `Counterparty` + `PriceList`;
  every place the spec says "Partner" or "Agreement" this build uses
  `Counterparty` directly. This is the single biggest scope
  simplification in this phase — flagged to the user before starting.
- **No offer-line "add/edit lines after header-only creation" endpoint.**
  `CommercialOfferService.create` takes lines at creation time; there's
  no `PATCH` to add them afterward (unlike `SalesOrderService.update`,
  which does support line replacement). The Request→Offer conversion is
  therefore header-only with lines added by creating a fresh offer today
  — not by editing the converted one.
- **No price/discount override on `SalesOrder`** — only `CommercialOffer`
  enforces `sales.price.override` + audit; a direct `SalesOrder` line
  price (already supported by the pre-existing Sales Documents DTO) is
  not gated by this permission.
- **`sales.discount.override` and `sales.credit.override` permissions are
  unused** — no endpoint currently lets an authorized user override a
  BLOCKED credit result or force a discount beyond policy.
- **`OrderHold` types beyond MANUAL are never placed automatically** —
  spec section 87's "automatic credit/payment/compliance hold" is not
  implemented; `CreditCheckService` rejects confirmation directly rather
  than placing a CREDIT hold for a human to review and release.
- **No order revision/versioning** (spec sections 24, 138) — a confirmed
  order can be reopened and its lines replaced via the existing
  `SalesOrderService.update`, but nothing preserves a prior version or
  tracks a `revision_number`/reason.
- **`StockAvailabilityService`/`ExpectedStockService` don't exist even as
  stub interfaces** (spec sections 35, 43-44) — reservation checks only
  the order's own remaining quantity, never real or expected warehouse
  stock.
- **No true concurrent-reservation-race test** — the same class of gap
  already disclosed in Accounting Core/Tax Engine's docs.
- **Address/contact snapshots** (spec sections 66-68) — delivery address
  and contact snapshotting at confirmation time is not implemented;
  `SalesOrder` has no delivery-address field at all yet.
- **Sales channel/priority/external-reference fields exist on the
  schema but have no controller support** for setting them beyond
  what's already exposed by the pre-existing `SalesOrder` create/update
  DTOs (which this build did not extend).
