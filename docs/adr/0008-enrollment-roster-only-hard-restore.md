# ADR 0008: Enrollment as a roster-only join with hard-restore on re-enroll

## Status
Accepted

## Context
`docs/03-prd-crm.md §7.5` requires the ability to enroll, move, and withdraw students
from batches. `docs/05-database-design.md §3` shows `enrollments` carrying both roster
columns (student_id, batch_id, status, progress_pct) and commerce columns (implied by
the order/payment relationship). Phase-1 scope is limited to the roster side; commerce
is deferred to Phase 2.

The `enrollments` table carries a `@@unique([studentId, batchId])` Prisma constraint,
which maps to a full-column unique index in PostgreSQL. This was added in migration
`20260627073131_crm_core` to enforce that a student cannot be enrolled in the same
batch twice. However, the standard soft-delete pattern (`deleted_at`) means a
soft-deleted enrollment row still occupies the unique slot — a re-enroll of the same
student into the same batch after a withdrawal would fail the unique constraint even
though the old row is logically gone.

## Decision

### Enrollment scope (P1)
`enrollments` tracks only the roster: which student is in which batch, the active status
(`active | completed | dropped`), and a `progress_pct` placeholder. The commerce side
(order_id, payment linkage, invoice) is explicitly deferred to Phase 2. No P1 API
creates or reads any commerce field.

### Partial-unique index
A dedicated forward-only migration (`20260627073500_crm_core_partial_indexes`) adds:

```sql
CREATE UNIQUE INDEX "enrollments_active_student_batch_key"
  ON "enrollments" ("student_id", "batch_id")
  WHERE "deleted_at" IS NULL;
```

This enforces uniqueness only among non-deleted rows, so a withdrawn enrollment
(soft-deleted) does not block a future re-enroll. The original full-column `@@unique`
constraint from the prior migration is left in place (it is on an already-shipped
migration and CLAUDE.md §3.8 forbids editing shipped migrations); the partial index's
semantics govern new-row uniqueness at the application layer.

### Hard-restore on re-enroll
When `enrollments.service.ts` receives an enroll request for a (student_id, batch_id)
pair that already has a soft-deleted row, it **hard-restores** the existing row (`SET
deleted_at = NULL, status = 'active', ...`) rather than inserting a new one. This
satisfies both the full-column unique constraint (no second row is created) and the
partial unique index, and preserves the original row's history (progress, created_at).
The restore is audited as a `restore` action.

## Consequences
- Re-enrolling a previously withdrawn student produces a restore of the prior record,
  preserving history and avoiding duplicate row accumulation.
- Commerce data (order linkage) can be added to the `enrollments` table in P2 as
  nullable columns without a migration conflict, since P1 only fills the roster columns.
- The presence of both the full-column unique constraint and the partial unique index
  is a slightly redundant schema, but it is the safest outcome given the forward-only
  migration rule; the full-column constraint is stricter and will be harmless unless
  two soft-deleted rows for the same (student, batch) ever accumulate — which the hard-
  restore logic prevents.
- Future phases that need to create a genuinely new enrollment after a completed one
  (e.g. a student re-taking a program) must address this; the partial index allows it
  if the previous row is in a terminal state and hard-deleted, but soft-delete-only
  workflows will continue to rely on the restore path.

## Alternatives considered
- **No unique constraint at all, enforce in the service layer only**: simpler
  migrations, but allows duplicates if the guard is bypassed. Rejected — DB constraints
  are more reliable than application-layer guards alone.
- **Soft-delete the old row and insert a new enrollment on re-enroll**: would satisfy
  the partial index but violate the full-column constraint from the shipped migration.
  Rejected — editing the shipped migration is forbidden.
- **Separate `batch_roster` join table** (no re-enroll semantics needed): adds
  indirection for a relatively simple relationship. Rejected at this scale — a
  single `enrollments` table with a clear status field is sufficient for P1–P4.
