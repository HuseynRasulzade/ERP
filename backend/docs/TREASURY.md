# Treasury / Bank Engine (docx spec Phase 14)

Three strictly separate layers (spec sections 1, 26, 182) — never merged
into one document or one status:

```
Layer 1 — Treasury Plan (never touches bank balance or AR/AP)
  PaymentRequest --submit--> PENDING_APPROVAL
    --TreasuryApprovalService.approve (threshold rule)--> APPROVED
    --PaymentCalendarService.createFromApprovedRequest--> PaymentCalendarItem
  LiquidityForecastService.position/forecastByAccount/cashGapAlerts
    (reads PaymentCalendarItem + BankCashMovementService's own book balance,
     shown SEPARATELY, spec section 22)

Layer 2 — Bank Reality (the actual cash movement, immutable)
  SettlementPayment (extended, spec section 26's own OutgoingBankPayment/
  IncomingBankPayment) / InternalBankTransfer / BankFee / FXConversion
    --POST--> BankCashMovementService.record --> BankCashMovement (register)
  BankStatementImportService.import --> BankStatement + BankStatementLine
  BankMatchingService.suggest/autoMatch/manualMatch --> BankTransactionMatch
  BankReconciliationService.create/close/reopen --> BankReconciliation

Layer 3 — Settlement Allocation (Phase 13, imported, never duplicated)
  PaymentAllocationService.allocateManual/allocateAutomatic
  AdvanceService.createFromUnallocatedPayment/.apply
```

## A. SettlementPayment extension, not a duplicate BankPayment table

Phase 13's `SettlementPayment` was deliberately built as a "payment
adapter interface" placeholder (see docs/SETTLEMENT.md) for exactly this
phase to extend. It now carries `bankAccountId`, `operationType`,
`paymentRequestId`, `paymentInstructionId`, `bankReference`,
`externalTransactionId`, `matchStatus` — this document IS the spec's own
`OutgoingBankPayment`/`IncomingBankPayment` (spec section 26), not a
separate table (spec section 2's own "don't duplicate"). `counterpartyId`/
`counterpartyRole` are now nullable (spec section 70 — tax/payroll/loan/
other payments carry no counterparty); `SettlementPaymentPostingHandler`
books those against the operation's own expense/income account instead of
the CUSTOMER_ADVANCE/SUPPLIER_ADVANCE clearing account.

## B. BankCashMovement — a THIRD register, deliberately separate

Neither Phase 13's `SettlementMovement` (AR/AP) nor `PaymentCalendarItem`
(plan) is the bank book balance's source of truth. `BankCashMovementService`
is its own tiny module (`bank-cash-movement.module.ts`) with no
dependency on Settlement or the rest of Treasury, specifically so BOTH
`SettlementModule` (a payment's bank leg) and `TreasuryModule` (transfers/
fees/FX) can write through it without forming a module cycle — see that
file's own docstring for the exact reasoning.

## C. Payment Request is never a payment (spec sections 4-10)

`PaymentRequestService`/`TreasuryApprovalService` never touch bank
balance, AR/AP, or GL. `requestedAmount`/`approvedAmount`/`paidAmount`
are three distinct fields (spec section 10); `paidAmount` and terminal
`PAID`/`PARTIALLY_PAID` status are written ONLY by
`SettlementPaymentPostingHandler` when an actual payment posts against
`paymentRequestId` — never set directly by the approval flow.

## D. Basic approval engine, not Phase 26's workflow

`TreasuryApprovalRule` is a flat threshold ladder (amount range +
optional category -> required permission codes), evaluated in ascending
`minAmount` order. No delegation, escalation, or multi-step routing —
that is Phase 26's own boundary (spec section 181).

## E. Bank statement import and matching

`BankStatementImportService.import` takes an already-normalized row
shape — concrete CSV/MT940/CAMT.053 parsers are Phase 28's adapter
boundary (spec section 147); raw payload is preserved verbatim (spec
section 37). Duplicate statements (`externalStatementId`, spec section 38)
are a no-op re-import, not an error; duplicate LINES across different
imports are skipped individually.

`BankMatchingService` is a deterministic rule + score foundation only
(spec section 123 — AI matching is Phase 29's boundary): external
transaction id exact (60), amount exact (25), reference contains (10),
date proximity (5-10). ≥95 auto-matches, ≥80 is a suggestion, below that
is manual-only.

## F. Reconciliation equation (spec section 51)

`BankReconciliationService.create` computes:
`Book Balance (from BankCashMovementService) vs Bank Statement Closing Balance`,
and blocks `close` (spec section 95) on: difference beyond tolerance,
any unmatched statement line, or the previous reconciliation for that
account not yet closed (continuity, spec section 96).

## G. Treasury FX vs Settlement FX (spec sections 61-63, 118-119)

`FXConversion` is bank-account-to-bank-account currency exchange with NO
settlement consequence — its own gain/loss (vs an optional `officialRate`)
posts to `OTHER_OPERATING_INCOME`/`_EXPENSE`, completely separate from
Phase 13's `SettlementAllocation.realizedFxAmount` (invoice/payment
realized gain-loss). Neither module computes the other's number.

## H. Disclosed simplifications / Phase 14 boundaries (spec section 181)

- No `PaymentRequestLine`/`CashFlowForecast`/`BankReconciliationItem`/
  `TreasuryForecastVersion` tables — a payment request is single-amount;
  cash flow forecast and reconciliation line detail are computed live
  (same "rebuildable projection" pattern as every other health/report
  service in this codebase).
- `bank_posting_mode` is stored per bank account but only
  `DOCUMENT_DRIVEN` has a real distinct posting path — `STATEMENT_CONFIRMED`
  is an honored config value without its own implementation in this pass.
- No concrete bank connector/API integration (`BankConnector` interface,
  spec section 147) — Phase 28's own boundary.
- Payment signing (spec section 107) — no signer-level/signing-status
  fields yet; a schema extension point, not built here.
- `TreasuryApprovalRule`'s "one active match per statement line"
  concurrency guard (spec test 172) is a transactional re-check, not a
  database unique partial index — documented in `BankMatchingService`.

## I. Permissions

`TREASURY_VIEW`, `_PAYMENT_REQUEST_CREATE`, `_PAYMENT_REQUEST_APPROVE`,
`_PAYMENT_PLAN`, `_VIEW_LIQUIDITY`, `_CREATE_PAYMENT`, `_POST_PAYMENT`,
`_CANCEL_PAYMENT`, `_IMPORT_STATEMENT`, `_MATCH_BANK_TRANSACTION`,
`_RECONCILE_BANK`, `_CLOSE_RECONCILIATION`, `_INTERNAL_TRANSFER`,
`_FX_CONVERSION`, `_OVERRIDE_MATCH`, `_OVERRIDE_PAYMENT_AMOUNT`,
`_VIEW_BANK_BALANCE`, `_VIEW_ALL_BANK_ACCOUNTS` — see
`rbac/permission-codes.ts`.
