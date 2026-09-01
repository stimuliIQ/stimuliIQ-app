# ADR-0070 — Two-step leave approval, and the status sets that make it safe

Status: **Accepted** (P17, 2026-09-01)
Amends ADR-0065 (leave management). Depends on ADR-0069 (the org hierarchy).

## Context

ADR-0065 shipped leave with a single approval step held by the super admin alone — the only
option available, because there was no org chart to route by. With teams (ADR-0069) the owner
asked for a lead-then-manager chain.

## Decisions

**(a) One new status, `lead_approved`. `pending` is not renamed.**
`pending` still means "not yet decided"; every existing row carries that meaning, and three
indexes plus the front-end filter enum are built on it. Not renaming it is what makes the
existing-requests story a no-op. The enum value ships in its own migration, because Postgres
refuses to use a newly added enum value inside the transaction that added it and Prisma wraps
each migration in exactly one.

**(b) A lead may reject outright but may not approve outright.**
Asymmetric on purpose. A "no" should not wait for a second signature — the applicant needs to
re-plan. Same reasoning as P4's grade/send-back and P14's four verbs.

**(c) The status sets are defined ONCE, in `@repo/types`.**
This is the load-bearing decision of the phase. Ten string literals across the leave service
and repository previously answered "which requests are still live?". Missing one when adding a
third live status does not fail a test — it silently stops counting somebody's days for the
hours their request sits with the manager, and lets two requests be approved against one
allowance. It fails in the direction nobody checks. `LEAVE_UNCOMMITTED_STATUSES` and
`LEAVE_LIVE_STATUSES` are imported everywhere, and `leaveStatusSetsCoverEveryStatus()` is
asserted in the spec so a future status cannot ship unclassified.

**(d) Days are deducted only on the final approval.**
The lead's step commits nothing, so it takes no advisory lock and does no allowance
arithmetic. A `lead_approved` request still blocks an overlap and still counts against the
balance as pending. Verified end to end: with one approved 2-day request and one sitting with
the manager, the balance reads `used=2 pending=2 remaining=8`.

**(e) The final transition is narrowed to the state actually read.**
`from: ["pending"]` or `from: ["lead_approved"]`, never both. Accepting both would let a lead
approving between the read and the write have their identity overwritten by the manager's. The
narrow guard turns that race into a 409, which is the correct answer.

**(f) The permission is uniform; the org chart decides.**
`leave.approve` is granted to every staff role at `scope=own`. Whose requests somebody sees is
resolved from the team graph. A dedicated `team_lead` role was rejected because a person's
position would then live in two places — the role and the team — which drift: appoint a lead
in the Teams screen, forget the role, and they quietly cannot approve anything. Data-only is
one place. The approvals queue is likewise widened from the org chart rather than by widening
`leave.view` to `all`, which would hand a lead the whole company's reasons — exactly what
`leave.calendar.view` was split out to avoid.

**(g) Nobody decides their own request.**
Enforced in the service (403 `leave.self_review`), not by a permission, because a permission
cannot express it — the super admin's `scope=all` previously covered their own row. This is
the one place the module answers 403 rather than 404: the actor unambiguously knows the
request exists, because it is theirs, so there is nothing to conceal.

**(h) HR and the owner may approve directly from `pending`.**
The escape hatch for when a lead is themselves on leave, and the only way a request whose
chain has a gap ever gets decided. Visible rather than silent: the row records that actor as
both the lead approver and the final one, so the trail says one person did both rather than
implying a first step that never happened.

## Consequences

- A team manager holding only the `admin` role cannot approve, because `admin` is deliberately
  excluded from `leave.approve` (ADR-0065 (d)). Give such a person a staff role or `hr`.
  Flagged rather than resolved — relaxing it would undo a narrowing two test suites protect,
  and it is a product call, not an implementation detail.
- The notification for a new request now goes to the resolved first approver instead of every
  super admin, with HR + the owner as the fallback. A second hop tells the manager once the
  lead has approved — without it a two-step chain would be strictly worse than the one-step
  one it replaced, because the request would sit silently until somebody opened the queue.
- `reviewed_by_id` keeps meaning "the final decision" on every row, old and new. The lead's
  step writes a separate trio, so no historic row changes meaning.
- The applicant can still withdraw a request the lead has approved but the manager has not yet
  confirmed — it is not a committed absence.
