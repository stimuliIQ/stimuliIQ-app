# ADR 0014: Payment idempotency and order-to-enrollment atomicity

## Status
Accepted

## Context
Commerce introduces three correctness hazards that must be addressed at the DB/service
layer rather than at the API layer alone:

1. **Duplicate order creation**: a network retry or double-click could create two
   orders for the same purchase intent, billing a student twice.
2. **Duplicate payment capture**: a retried Razorpay verify call or a replayed webhook
   could mark the same provider payment as captured twice, corrupting the ledger.
3. **Double enrollment**: the same order being processed twice (via direct API + webhook,
   or two concurrent webhook deliveries) could enroll a student twice in the same batch.

`docs/05-database-design.md §1` requires soft-delete + unique constraints, and
`CLAUDE.md §3.6` requires money to be in integer paise. The `enrollments` hard-restore
pattern (ADR-0008) must be preserved for the re-enroll case.

## Decision

### Idempotency key on orders
`orders.idempotency_key` is a `@unique` column (DB-enforced). The caller supplies an
`Idempotency-Key` header on `POST /api/v1/commerce/orders`. `OrdersService` checks for
an existing order with that key and returns it (with 200) rather than creating a
duplicate. This converts retries into safe no-ops at the service layer.

For lead-to-student conversion, the idempotency key is server-generated as
`lead:${leadId}:order` — deterministic and scoped to the lead, ensuring that concurrent
conversion requests for the same lead cannot produce two orders.

### provider_payment_id unique index as replay guard
`payments.provider_payment_id` carries a `@unique` DB constraint. When
`PaymentsService.capturePayment` receives a Razorpay payment ID, the `upsert`-style
write fails with a unique-constraint violation if that provider payment ID was already
recorded. The service interprets this as an idempotent replay and returns the existing
payment rather than raising an error.

### Order → enrollment in a Prisma `$transaction`
The sequence — mark payment captured → update order status to `paid` → create/restore
enrollment — runs inside a single `prisma.$transaction`. Either all three succeed or
none do. This prevents a state where payment is recorded but enrollment is absent (or
vice versa) due to a mid-sequence crash.

Within the transaction the enrollment step re-uses the hard-restore logic from
ADR-0008: if a soft-deleted enrollment row already exists for the (studentId, batchId)
pair, it is restored (`deleted_at = NULL, status = 'active'`) rather than inserting a
new row. This preserves enrollment history and satisfies the `@@unique([studentId,
batchId])` full-column constraint from the P1 migration.

### Enrollment commerce-linkage
`enrollments.order_id` (nullable UUID FK, added in the P2 migration
`commerce_leads_partial_indexes`) carries a partial-unique index:

```sql
CREATE UNIQUE INDEX "enrollments_order_id_unique_nonnull"
  ON "enrollments" ("order_id")
  WHERE "order_id" IS NOT NULL AND "deleted_at" IS NULL;
```

This ensures one live enrollment per order while allowing the same order_id to reappear
on a restored (previously soft-deleted) enrollment row.

### Webhook replay safety
The webhook handler (`WebhookController`) is `@Public` and receives raw-body payloads.
After HMAC verification it delegates to `PaymentsService`, which uses the same
`provider_payment_id` unique guard. A replayed `payment.captured` webhook for an
already-processed payment ID is therefore a no-op — the unique constraint violation is
caught and swallowed as a known-idempotent case.

## Consequences
- A student cannot be double-charged for the same order-creation intent as long as
  callers supply a stable `Idempotency-Key` header.
- A provider payment event cannot inflate the ledger regardless of how many times the
  webhook is delivered or the verify endpoint is called.
- The Prisma transaction scope means that if invoice generation (currently sync behind
  a port — see ADR-0020) fails after enrollment commit, the transaction rolls back;
  invoice failure does not leave an enrollment without a payment record.
- The partial-unique index on `order_id` is not expressible as a Prisma `@@unique`
  (Prisma cannot express partial-unique); it lives in a raw-SQL migration and is noted
  in the schema comment.

## Alternatives considered
- **Application-level idempotency cache (Redis)**: faster lookup but survives only as
  long as the cache; a cold cache after a restart could allow duplicates. Rejected in
  favour of DB-enforced uniqueness which is durable.
- **Separate idempotency table**: more flexible (per-endpoint, per-TTL) but overkill
  for the current payment surface. Deferred — the order unique key + payment ID unique
  constraint cover all current hazards.
- **Optimistic locking (version column)**: appropriate for concurrent row updates;
  less clean than a unique constraint for "never insert a duplicate" semantics.
  Rejected for the duplicate-capture case; kept as a future option for order status
  transitions under high concurrency.
