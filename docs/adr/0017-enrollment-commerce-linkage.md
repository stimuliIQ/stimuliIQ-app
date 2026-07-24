# ADR 0017: Enrollment commerce-linkage (order_id + source; money single-sourced on orders/payments)

## Status
Accepted

## Context
ADR-0008 deliberately deferred the commerce side of `enrollments` to Phase 2, noting
that "Commerce data (order linkage) can be added to the `enrollments` table in P2 as
nullable columns without a migration conflict, since P1 only fills the roster columns."

Phase 2 must now answer: what does `enrollments` own, and what lives in `orders` /
`payments`?

Two competing designs were considered:

A. **Enrollments own money**: `enrollment.amount_paid_paise`, `enrollment.coupon_id`,
   etc. replicate commerce data onto the roster record.
B. **Enrollments backlink to commerce**: `enrollment.order_id` (nullable FK) points at
   the `orders` table where all money data lives.

## Decision
Design B — enrollments carry only the backlink.

`enrollments` gains two columns in the P2 migration `commerce_leads`:

| Column | Type | Purpose |
|--------|------|---------|
| `order_id` | `UUID?` (nullable FK) | Backlink to the `orders` row that created this enrollment. `NULL` for manual/roster enrollments (source = `manual`). |
| `source` | `EnrollmentSource` enum | `manual` (CRM roster op), `order` (payment flow), `conversion` (lead-to-student convert). |

All monetary data — `amount_paise`, `discount_paise`, `currency`, `coupon_id`,
`idempotency_key` — lives exclusively on `orders` and `payments`. `enrollments` never
stores money.

**Enforcement**: a partial-unique index on `(order_id) WHERE order_id IS NOT NULL AND
deleted_at IS NULL` (in migration `commerce_leads_partial_indexes`) prevents two live
enrollments from pointing at the same order. The hard-restore logic (ADR-0008) is
preserved: if a soft-deleted enrollment with the same `order_id` is found on re-enroll,
it is restored rather than a new row inserted.

The `EnrollmentSource` enum distinguishes three creation paths:
- `manual` — CRM staff enroll a student directly (no order, `order_id = NULL`).
- `order` — enrollment created by the payment capture transaction.
- `conversion` — enrollment created as part of lead-to-student conversion
  (which also creates an order; `order_id` is set, `source = conversion`).

## Consequences
- Revenue reporting reads `orders` and `payments` — never `enrollments`. There is a
  single source of truth for money.
- The roster (enrollments) and commerce (orders/payments) can evolve independently;
  adding EMI sub-payments, partial payments, or installment plans does not require
  changing the `enrollments` table.
- P1 manual enrollments (`order_id = NULL, source = manual`) are fully backward-
  compatible with the P2 migration — the new columns are nullable/default.
- Querying "what did a student pay for this enrollment" requires a join through
  `order_id → orders → payments`. This join is straightforward and worth the purity.

## Alternatives considered
- **Duplicate money columns on enrollments**: would allow single-table queries for
  student enrollment + price. Rejected — two sources of truth for money will diverge;
  any refund or coupon adjustment would require updating both tables.
- **Enrollment IS the commerce record (no separate orders table)**: collapses the
  distinction. Rejected — an order can exist (and be paid) before a batch assignment,
  and a student can have multiple orders over their lifetime (e.g. re-enrollment,
  upgrade). A separate `orders` entity is cleaner.
