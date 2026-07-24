# ADR 0054: Internship completion reuses the P4 eligibility engine; `active→completed` is a race-safe compare-and-set

## Status
Accepted

## Context
WS-3 of `docs/specs/phase-8-mentor.md` requires a batch-level "how close is this batch to
finishing the internship program" rollup and an `active → completed` mark-complete action,
explicitly forbidding (LOCK-4) any new, parallel progress-computation system: every number
must be a live read of `enrollments`, `lesson_progress`, `submissions`, `attempts`,
`assessments`, `assignments`, and `certificates`, reusing the P4 certificate-eligibility
engine (`CertificatesService.isEligible`, ADR-0028/ADR-0033) verbatim for per-student
eligibility — never a re-derived or simplified formula.

Marking a batch complete is a narrow, additive `batches.status` transition
(`active → completed`) plus new `completed_at`/`completed_by_user_id` columns. It must
never touch enrollment/progress/grading/certificate rows (AC-42), must be idempotent (a
second call after the first succeeds returns `409 ALREADY_COMPLETED`, not a duplicate
transition, AC-39), and — because every actively-assigned mentor on a batch (lead or not)
holds `batches.markComplete`, alongside Admin/Branch Manager — multiple callers can race to
call it concurrently for the same batch (spec Part 4 edge case).

The soft-delete + audit Prisma-extension (ADR-0005) only instruments the extended client's
single-record `update`/`create`/`delete` calls, not `updateMany`; it provides no
transactional row-locking of its own. A naive "read status, then conditionally update"
implementation is vulnerable to a classic check-then-act race: two concurrent mark-complete
calls could both observe `status = 'active'`, both proceed, and (depending on isolation
level and update shape) either double-write `completed_at` or produce two audit rows for
what should be a single transition.

## Decision
**Rollup — pure read, zero new state.** `BatchCompletionService`/`BatchCompletionRepository`
compute headcount buckets (`certified` / `eligibleNotIssued` / `inProgress` / `dropped`),
`percentComplete` (average `progress_pct` across non-dropped enrollments), and
`assignmentsSubmittedPct` / `assessmentsPassedPct` / `finalProjectApprovedPct` directly from
`enrollments` / `submissions` / `certificates` rows on every request — no new table,
counter, or materialized snapshot duplicates this data. Per-student eligibility is
delegated verbatim to `CertificatesService.isEligible`. The rollup's numbers are always
computed and always included in the mark-complete response (Rule M-2), but never gate the
transition (AC-41) — completion is an operational "this program run has ended" milestone,
not a 100%-outcomes gate.

**Mark-complete — transactional, row-locking compare-and-set.**
`BatchCompletionRepository.markComplete` opens a Prisma `$transaction` that:
1. Issues a raw `SELECT status FROM batches WHERE id = ... AND tenant_id = ... AND
   deleted_at IS NULL FOR UPDATE`, taking a row lock and reading the current status.
2. Only if that locked read still shows `status = 'active'` does it perform a single
   `tx.batch.update({ data: { status: 'completed', completedAt, completedByUserId } })`
   inside the same transaction, and return `1` (affected).
3. Otherwise (row already `completed`/`archived`, or was flipped by a concurrent
   transaction that committed first) it returns `0` without writing.

The `FOR UPDATE` lock serializes any concurrent caller against the same batch row: the
second transaction blocks until the first commits, then re-reads `status = 'completed'`
and returns `0` instead of writing. The service layer treats `0` as "someone else already
completed it" and surfaces the same `409 ALREADY_COMPLETED` response as the ordinary
idempotency check — no double `completed_at` overwrite, no duplicate audit-log entry, no
error surfaced beyond the documented 409 to either caller.

The single `tx.batch.update` call (not a bulk `updateMany`) is deliberate: the audit
Prisma extension only instruments single-record calls, so routing the transition through
`update` is what keeps it audited (`entity = 'batch'`, before/after `status`/`completedAt`
diff) even inside the transaction. `tenant_id` is included directly in the `FOR UPDATE`
predicate as defense-in-depth, never relying solely on the prior scope-resolved read that
loaded the batch (the remaining bare-`{id}` mutation where-clauses elsewhere in the module
that don't yet do this are tracked as F6 in `docs/phase-8-followups.md`).

## Consequences
- No parallel/duplicated progress-tracking system exists for internship completion — every
  number the mentor dashboard, the CRM batch-completion panel, and any future report reads
  is traceable to the same source rows every other dashboard in the codebase already reads
  (consistent with the P7 analytics-reconciliation principle, ADR-0046).
- The mark-complete transition is safe under real concurrent access (two mentors, or a
  mentor and a Branch Manager, calling it milliseconds apart) without an
  application-level distributed lock or a unique-constraint trick — Postgres's row-level
  `FOR UPDATE` lock inside a single transaction is sufficient given the low-contention,
  single-row nature of this transition.
- The rollup remains uncached/live-read on every request. At current and near-term scale
  this is acceptable (mirrors `CertificatesService.listEligibility`'s existing
  N+1-per-row precedent); a future phase could layer a cache-aside (ADR-0046 style) on top
  without changing the transactional guarantee described here.
- Certificate eligibility and completion tracking can never silently drift apart — a
  change to the P4 eligibility rule set automatically reflects in the completion rollup
  with no separate mentor-feature code to update.

## Alternatives considered
- **Application-level distributed lock (Redis) around the mark-complete call.** Rejected —
  introduces a new failure mode (lock acquisition/release, Redis availability) for a
  problem Postgres's native row locking already solves correctly within a single
  transaction; the codebase does not otherwise take a Redis-lock dependency for single-row
  DB transitions.
- **Optimistic `UPDATE ... WHERE status = 'active'` compare-and-swap, without an explicit
  row lock.** Considered but rejected — checking the affected-row-count of a bare `UPDATE`
  would need a bulk `updateMany`-shaped call, which (per Decision above) bypasses the audit
  Prisma extension. The explicit lock-then-single-`update` sequence keeps both the
  race-safety and the audit guarantee.
- **A dedicated `batch_completion_snapshots` table populated at mark-complete time.**
  Rejected outright by LOCK-4 — this is exactly the "parallel, possibly-drifting progress
  system" the spec forbids; the rollup returned by mark-complete is a live read, not a
  frozen snapshot, computed and discarded per-request.
- **`completed → active` reverse transition as part of the same mechanism.** Out of scope
  (spec Part 4 edge case) — only the forward transition exists; a reverse transition, if
  ever needed, is `batches.edit` territory and a separate future decision.

## Related
Reuses the P4 certificate-eligibility engine (ADR-0028, ADR-0033) verbatim. Extends the
soft-delete/audit Prisma-extension pattern (ADR-0005) to a transactional compare-and-set.
See ADR-0053 (Mentor role + assigned-scope) for how callers reach this endpoint, and
ADR-0055 (AI-mentor exploration + removal) for the other Phase 8 mentor-track decision.
