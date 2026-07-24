# ADR 0016: Invoice sequential numbering via per-tenant pg_advisory_xact_lock

## Status
Accepted

## Context
`docs/05-database-design.md §3` lists `invoices.number` as `uniq` and implies a
human-readable sequential format (e.g. `INV-2026-0001`). Sequential invoice numbers
are a legal requirement for GST compliance in India — gaps or duplicates in an invoice
series can create audit problems.

The naive approach — `SELECT MAX(number) FROM invoices WHERE tenant_id = ? FOR UPDATE`
— is broken under concurrent order processing:

1. Two transactions running simultaneously both read the same MAX, generate the same
   next number, and one fails with a unique-constraint violation.
2. The transaction that fails must retry, which requires rollback logic in the caller.
3. Under high load this retry loop can degrade into a contention storm.

A first implementation of `InvoiceService.generateNumber` used `MAX(...) FOR UPDATE`
and was caught by Wave 6 QA (integration test: concurrent invoice generation for same
tenant). The unique constraint backstop (`invoices.number @unique`) caught the duplicate,
but the result was an unhandled constraint-violation error surfacing to the caller.

## Decision
`InvoiceService.generateNumber` acquires a **per-tenant advisory transaction lock**
before reading and incrementing the invoice counter:

```sql
SELECT pg_advisory_xact_lock(hashtext(:tenantId));
```

`pg_advisory_xact_lock` is a session-level exclusive lock scoped to the current
transaction. Key properties:

- **Per-tenant**: the lock key is derived from `hashtext(tenantId)`, so two different
  tenants can generate invoices concurrently without blocking each other.
- **Transaction-scoped**: automatically released when the transaction commits or rolls
  back — no explicit unlock needed, no leaked locks.
- **Serializes invoice generation for one tenant**: only one transaction can be inside
  the number-generation critical section for a given tenant at a time. Under normal
  load (not a high-frequency invoice platform) this is not a bottleneck.

The `invoices.number` `@unique` DB constraint is **kept as a backstop**: if a bug in
the lock logic somehow allows two transactions to generate the same number, the unique
constraint prevents the second from being committed. The backstop converts a potential
silent data corruption into a hard error.

## Consequences
- Invoice numbers are guaranteed sequential and gap-free within a tenant, satisfying
  GST audit requirements.
- Under high concurrency for a single tenant, invoice generation is serialized (one
  at a time). This is acceptable for the foreseeable load profile (invoice generation
  is triggered by payment capture, not a batch operation).
- The advisory lock approach is PostgreSQL-specific. If the database is ever changed
  (unlikely given ADR-0001 and the schema depth), this must be re-evaluated.
- The `invoices.number` unique constraint remains in the schema as a meaningful
  backstop, not just belt-and-suspenders noise — it should not be removed.

## Alternatives considered
- **`MAX(number) FOR UPDATE`**: requires a retry loop on the caller to handle
  unique-constraint violations under concurrency. Rejected after Wave 6 demonstrated
  the failure mode.
- **Separate `invoice_counter` table with a SELECT FOR UPDATE row lock**: cleaner
  isolation than an advisory lock, but requires an extra table and row per tenant.
  Rejected as unnecessary indirection for the current scale.
- **Application-level mutex (Redis SETNX)**: works across multiple API instances but
  adds a Redis dependency to a DB write path and introduces distributed-lock
  complexity (TTL, lock owner, crash recovery). Rejected — the PostgreSQL advisory
  lock is simpler and sufficient given the single-DB architecture.
- **UUID-based invoice numbers**: no sequencing problem, but opaque numbers are not
  useful for human audit trails or GST filings. Rejected.
