# Accounting Periods & Reopen Requests

## Period lock

`AccountingPeriod` (`prisma/schema.prisma`) — `OPEN | SOFT_CLOSED | CLOSED`
per tenant, optionally scoped to one organization (a tenant-wide period with
`organizationId = null` still governs any organization that has no more
specific period configured for the same date). `SOFT_CLOSED` is a reserved,
currently-unused enum value — nothing today distinguishes it from `CLOSED`.

`PeriodService.assertDateIsOpen(tenantId, businessDate, organizationId?)` is
the single guard every posting path calls before writing any movement
(`document-framework/document-posting.service.ts`,
`accounting-core/accounting-posting-engine.service.ts`) — a document dated
inside a non-`OPEN` period is rejected (`PERIOD_CLOSED`) even for a user who
otherwise holds ordinary posting permission. A date with no period
configured at all is treated as open.

Concurrency: when a posting path calls the guard with its own transaction
(`assertDateIsOpen(tenantId, date, organizationId, tx)` — every posting path
does), the governing period row is read `FOR SHARE`; `close`/`reopen` take
`FOR UPDATE` and write the status flip and its audit event in one
transaction. A close therefore waits for any in-flight posting that already
passed the guard, and every posting that starts after the close commits sees
`CLOSED` — no posting can land in a period after it was closed. Creating a
period (`POST /periods`) requires `periods.close` and the optional
`organizationId` must belong to the tenant.

`close`/`reopen` on `PeriodService` are direct, permission-gated
(`periods.close`/`periods.reopen`), always-audited actions
(`PERIOD_CLOSED`/`PERIOD_REOPENED`) — unchanged by the request workflow
below, and still the only two things that actually change a period's
`status`.

## Reopen Request (maker-checker gate)

`PeriodReopenRequest` (+ `PeriodReopenRequestService`/Controller,
`src/period/`) is an **additive** gate in front of `PeriodService.reopen` —
not a replacement for it. A holder of only `periods.reopen_request.create`
(e.g. `ACCOUNTING_USER`) files a reasoned request against a `CLOSED` period;
a holder of `periods.reopen` (e.g. `FINANCE_USER`, or `TENANT_ADMIN`)
approves or rejects it. Approving calls `PeriodService.reopen` internally —
there is exactly one reopen mechanism, this only gates who may trigger it
without holding the permission directly.

- Only one `PENDING` request per period at a time (`CONFLICT` on a second).
- The requester can never decide their own request — the same creator-
  cannot-approve-their-own-document rule every other approval flow in this
  codebase enforces (`docs/APPROVALS.md`), checked inline here rather than
  through the generic `ApprovalStep` engine: this is a single fixed check
  against a flat permission, not a per-role multi-step chain, so the
  heavier machinery bought nothing.
- Rejecting leaves the period `CLOSED` and the row `REJECTED`; a fresh
  request may be filed afterward (no lingering `PENDING` blocks it).

`GET /period-reopen-requests?periodId=` lists requests (optionally filtered);
`POST /period-reopen-requests` files one; `POST :id/approve` / `:id/reject`
decide it.

## What's deliberately out of scope

`SOFT_CLOSED` behavior (e.g. allowing some operations but not others in that
state), a multi-step approval chain for reopening (director + finance, say),
and tax-period locking/filing (spec sections 70-71 — no `TaxPeriod` model
exists; only this accounting period gates posting, same as before this
increment).
