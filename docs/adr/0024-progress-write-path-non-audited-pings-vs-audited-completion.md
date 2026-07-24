# ADR 0024: Progress write path — non-audited `baseClient` for high-frequency pings vs audited `client` for completion

## Status
Accepted

## Context
The LMS tracks two categories of progress write:

1. **Position pings** (`PATCH /lms/lessons/:lessonId/progress`): the player emits a
   ping every ~10 s (throttled) reporting `lastPositionSeconds`. These are high-frequency
   writes that update a single column (`last_position_s`) on `lesson_progress`. They
   carry no business significance beyond "resume point"; they are not state transitions
   and do not change the student's enrollment status or completion record.

2. **Mark-complete** (`POST /lms/lessons/:lessonId/complete`): the student or the
   player signals that the lesson is fully watched. This writes `status = 'completed'`
   and `completed_at` on `lesson_progress`, and triggers a rollup that recalculates
   `enrollment.progress_pct`. It is a meaningful business event (it may unlock the next
   lesson, eventually trigger certificate eligibility) and should be audited.

The audit-log Prisma extension (ADR-0005) intercepts writes on the `baseClient`
extension chain by wrapping the `client` object. Every write through `client` produces
an `audit_logs` row. Writing high-frequency position pings through the audited client
would produce a very large number of audit rows with zero audit value, inflating the
`audit_logs` table and adding unnecessary write load.

Additionally, the `attendance` table requires idempotent writes: a student cannot earn
two attendance records for the same lesson on the same enrollment. At the DB level,
a partial unique index on `(enrollment_id, lesson_id)` enforces this.

## Decision

### Two write clients
- **`baseClient`** (the raw Prisma client, below the audit extension): used for
  `lesson_progress` position-ping `upsert`. No audit row is produced. The write is an
  `upsert` (not an `update`) so it is idempotent: the first ping creates the row;
  subsequent pings update `last_position_s`.
- **`client`** (the audited Prisma extension): used for `lesson_progress` status
  transition to `completed` and for `enrollment.progress_pct` rollup. An `audit_logs`
  row is written for each completion event.

### Mark-complete idempotency
`POST /lms/lessons/:lessonId/complete` is idempotent at the DB state level:
- If `lesson_progress.status` is already `completed`, the handler returns 200 without
  re-writing the row or producing a duplicate audit entry.
- The `progress_pct` rollup queries the `lesson_progress` table for the current
  completion count; re-running it against the same state produces the same result.

### Attendance idempotency
`attendance` rows are written with an `upsert` keyed on `(enrollment_id, lesson_id)`.
The partial unique index `WHERE source = 'recorded'` on the `attendance` table
(enforced at the Postgres level) prevents duplicate recorded-attendance rows for the
same `(enrollment_id, lesson_id)` pair. A repeated mark-complete does not insert a
duplicate attendance row.

### Integer rollup
`progress_pct` is computed as `(completedLessonCount / totalLessonCount) * 100`,
rounded to the nearest integer, stored as `enrollment.progress_pct` (an integer
column). This is consistent with the `CLAUDE.md §3.6` rule (money in integer minor
units, by analogy all quantitative fields use integer representation where appropriate).

## Consequences
- High-frequency position pings do not pollute `audit_logs`. The table remains a
  meaningful record of business events, not a position-timeseries.
- Completion and attendance remain fully audited and idempotent.
- The `baseClient` / `client` split is a documented pattern that future high-frequency
  write paths (e.g. quiz answer auto-save in P4) can reuse without re-discovering the
  audit-inflation risk.
- `progress_pct` is derived and stored (not purely computed on read). This is a
  deliberate denormalization for read performance on the dashboard; the source of
  truth remains the `lesson_progress` rows.

## Alternatives considered
- **Use the audited client for all writes, filter pings out of audit UI**: produces
  the rows anyway (storage + write cost), then silently discards them in the UI.
  Rejected — the right fix is not to write them at all.
- **Skip the `last_position_s` update entirely; derive resume from client state**:
  loses cross-device resume and server-authoritative progress. Rejected — server-
  side resume is a stated requirement (`docs/02-prd-lms.md §7.2`).
- **Write position pings to a separate time-series table**: clean separation but adds
  schema complexity and storage for data with a short useful life. Deferred — if
  learning-analytics dashboards need play-event granularity in P7, a separate events
  table is the right place; for P3 only the resume position matters.
- **Use a Redis write-through cache for pings (write to DB on interval)**: reduces DB
  write frequency but adds complexity and a failure mode (Redis crash loses in-flight
  position). Deferred to P7 hardening if DB write throughput becomes an issue.
