# ADR 0015: Payments ledger as source of truth; reconciliation semantics (gross captured minus processed refunds)

## Status
Accepted

## Context
`docs/03-prd-crm.md §20` specifies a ledger reconciliation endpoint that finance staff
use to verify that the payment database matches what Razorpay reports. The core question
is: what is the correct formula for "net revenue" when some payments have been refunded?

A first implementation of the reconciliation endpoint double-counted refunds:

```
// WRONG: gross = captured payments only; then subtracted refunds that were
// already excluded from gross.
gross = SUM(payments WHERE status = 'captured')
net   = gross - SUM(refunds WHERE status = 'processed')
```

The bug: a `captured` payment that later enters `status = 'refunded'` (after the refund
is processed) would be excluded from `gross`, but the corresponding processed refund
would still be subtracted, yielding a net that was too low by the refund amount. This
was caught by a Wave 6 integration test (`reconciliation exactness` spec).

## Decision

The correct formula, now implemented in `LedgerService.reconcile`:

```
gross = SUM(payments WHERE status IN ('captured', 'refunded'))
net   = gross - SUM(refunds WHERE status = 'processed')
```

**Rationale:**
- `gross` includes all payments that were ever captured — whether or not a subsequent
  refund changed the payment's status to `'refunded'`. This reflects the total amount
  that actually moved from the student to the platform.
- `net` deducts only refunds in `'processed'` status (provider has confirmed the
  reversal). Pending or rejected refunds do not reduce net revenue until they clear.
- The formula is idempotent to the order of events: a captured-then-refunded payment
  contributes `+amount` to gross and `-refund_amount` to the deduction, yielding the
  correct net regardless of which DB row was updated first.

The `Payment` model's `status` field distinguishes `captured` (money held) from
`refunded` (money reversed), and the `Refund` model's `status` distinguishes
`processed` (provider confirmed) from `approved`/`requested` (in-flight).

## Consequences
- The reconciliation endpoint (`GET /api/v1/commerce/payments/reconcile`) returns
  `{ gross_paise, refunded_paise, net_paise, currency }` with values that match
  Razorpay's settlement report when all payments and refunds are in terminal states.
- Finance staff can compare `net_paise` against the Razorpay settlement amount to
  identify any discrepancy (missed webhook, failed refund, etc.).
- Any future payment status (e.g. `disputed`, `chargedback`) must be evaluated against
  this formula before being added to `PaymentStatus` — a new terminal status that
  represents "money left the platform" should be included in the `gross` filter.

## Alternatives considered
- **Include only `captured` payments in gross**: simpler query but produces incorrect
  results when refunds change payment status. Rejected after Wave 6 found the bug.
- **Separate gross and refund ledger tables**: cleaner accounting but a bigger schema
  change than warranted for the current volume. Deferred to P7 analytics hardening if
  materialized views are introduced for the reporting data path (`docs/05 §8`).
- **Real-time sync with Razorpay's settlement API**: authoritative, but adds latency
  and an external dependency to every reconcile request. Rejected for MVP — the local
  ledger is sufficient and the endpoint is a finance-admin tool, not a real-time display.
