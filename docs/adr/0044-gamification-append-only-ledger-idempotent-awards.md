# ADR 0044: Gamification append-only points ledger with partial-unique dedupe for idempotent awards

## Status
Accepted

## Context
P6's gamification workstream (WS-3) awards points/XP and badges by **consuming existing
domain events** already emitted in P3/P4 (`lesson_completed`, `assignment_graded`,
`assessment_passed`, `project_approved`, `certificate_issued`, plus a P6 `streak_day` event)
— no new emit points are introduced (`docs/02 §7.12/§7.13/§19`). Those events are dispatched
at-least-once (per the sync-seam and any future BullMQ retry semantics, ADR-0039) — a service
restart, a retry, or a duplicate webhook can cause the same logical event to be processed
more than once. Gamification must not double-award points or badges when this happens; a
naive "increment a counter" model would be trivially exploitable (farm points by replaying an
event) and would double-count on ordinary infrastructure retries, not just abuse.

Similarly, the batch leaderboard (`docs/02 §7.12`: "opt-in, privacy-safe") must never expose
PII to other students, and must honor opt-out promptly.

## Decision
**`points_ledger` is append-only** — rows are only ever `INSERT`ed, never `UPDATE`d (AC-47).
Each row carries `(user_id, delta, reason, ref)`; a **partial-unique constraint on
`(user_id, reason, ref) WHERE deleted_at IS NULL`** makes an award idempotent by
construction: replaying the same domain event (same `ref` — the source event/entity id, same
`reason` — the award category) hits the unique constraint on the second attempt, and the
service treats that as a no-op, not an error (AC-44 — the headline gamification AC). A
student's total XP is the `SUM` of all their non-deleted ledger rows (AC-49) — never a
separately-maintained counter that could drift from the ledger.

**Reversals are new negative-delta rows**, never a mutation or a `deleted_at` on the original
award (AC-48) — the ledger remains a complete, auditable history of every point ever
awarded or reversed.

**`user_badges` follows the same idempotency shape**: a **partial-unique constraint on
`(user_id, badge_id) WHERE deleted_at IS NULL`** ensures a badge is awarded at most once per
user, even if the threshold-crossing check runs multiple times across event replays (AC-45,
AC-46).

**Leaderboard is opt-in and PII-minimal** (`LeaderboardEntryDto` structurally omits email,
phone, enrollment id, and any field beyond `{rank, displayName, totalPoints}` — a type-level
assertion in `@repo/types` enforces this at compile time, and AC-50 asserts it at the response
level via a response-key scan test). Only students with `leaderboard_opt_in = true` appear;
opt-out removes the student from the projection within the cache TTL (60s default, AC-51).
The leaderboard read is a cache-aside projection (`docs/04 §2.7`) over the ledger, not a
separate mutable table — it is always derivable from the append-only ledger + badge award
tables plus the opt-in flag.

## Consequences
- Points/badges cannot be double-awarded by replaying a domain event — this is enforced at
  the database level (a constraint violation), not merely by application-level "check before
  insert" logic that could race.
- The ledger is a complete audit trail by construction — no award or reversal is ever lost or
  overwritten, satisfying the audit-on-mutation spirit of `CLAUDE.md §3.4` even though the
  ledger itself, being append-only, effectively *is* its own audit log for point/badge events
  (this is called out explicitly rather than also writing a separate audit-log row for every
  ledger insert, to avoid duplicate bookkeeping for a table that is already immutable and
  complete).
- A leaderboard leak of PII is structurally prevented at the DTO type level, not merely by
  developer discipline at the query-writing layer — a future engineer adding a field to the
  leaderboard query cannot accidentally serialize PII without the type assertion failing.
- Total XP display can, in principle, be negative after a reversal exceeding the original
  award; the LMS renders a display floor of 0 rather than a negative number (edge case,
  `docs/plans/phase-6.md` §Part 4).

## Alternatives considered
- **A mutable `user_points` counter table, incremented per event.** Rejected — provides no
  natural idempotency key to dedupe against (an increment is not naturally replay-safe without
  additional bookkeeping), and loses the audit trail of *why* a student has their current
  total. The append-only ledger with `SUM()` gives both idempotency and history for the same
  cost.
- **Idempotency via application-level "check if a row exists, then insert" without a DB
  constraint.** Rejected — race-prone under concurrent event processing (two workers/requests
  could both pass the check before either inserts); the partial-unique constraint makes the
  guarantee atomic and connection-pool-safe.
- **Soft-delete + re-insert for reversals (mark the original row deleted, insert a
  corrected one).** Rejected — violates the append-only principle and would make the ledger's
  history reconstructible only by inspecting `deleted_at`, weakening the audit trail; a
  negative-delta row is simpler and keeps every row live.
- **Non-opt-in leaderboard (all students shown by default).** Rejected — `docs/02 §7.12`
  requires opt-in; showing students by default and letting them opt out afterward would
  expose data before consent, the wrong default for a PII-adjacent feature.

## Related
Follows the idempotency-via-unique-constraint discipline established in ADR-0014 (payment
idempotency and order→enrollment atomicity), applied to the gamification domain.
