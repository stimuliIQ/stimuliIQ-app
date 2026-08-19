# ADR 0065: Staff leave — derived balances, integer half-days, super-admin-only approval

## Status
Accepted.

## Context

Staff had no way to request time off inside the product. Leave was arranged over WhatsApp
and remembered in somebody's head, so there was no record of who was off when, no approval
trail, and no shared view of company holidays. Nothing in the codebase modelled staff
absence: a search for `leave` or `holiday` returned zero domain code, and the retired
`Attendance` model hangs off `Enrollment` (students), which makes it structurally useless
for employees.

The requirements set before the build were:

1. Any member of staff applies; the **super admin** approves or rejects, and nobody else.
2. A **yearly allowance per leave type**, deducted as leave is approved, with the apply form
   showing what is left and refusing to overspend it.
3. One shared **calendar** carrying public holidays, configurable weekly offs, the viewer's
   own leave, and everybody else's — so the team can plan cover.
4. **Half-day leave**, because it is the normal unit of a short absence in this market.

Four decisions in the design were genuinely contested and are recorded here.

## Decision

### a. Durations are integer half-day units, never a decimal

`leave_requests.half_days` and `leave_quotas.half_days` are `INTEGER`. `7` means 3.5 days.
The API divides by two on the way out, so the UI reads "3.5 days" while the database only
ever sees whole numbers.

`0.5` is not exactly representable in binary floating point, and this schema contains no
`DECIMAL` or `NUMERIC` column anywhere — money is stored as integer paise (CLAUDE.md §3.6).
Prisma's `Decimal` was the obvious alternative and was rejected on a second ground as well:
it crosses the API envelope as a JSON **string** (`"3.5"`), so every consumer would need a
`Number()` at the boundary, which is precisely the class of bug the integer-paise rule
exists to prevent. The unit is in the column name so nobody ever writes `1` meaning one day.

### b. Balances are derived, not ledgered

Remaining allowance is computed as `quota(type, year) − Σ half_days of that person's
APPROVED requests in that year`, aggregated with a single `groupBy`. There is no balance
column and no ledger table.

Staff counts are small enough that the aggregate is free. A stored balance is a second
source of truth, and it drifts the first time a request is cancelled, restored, or
soft-deleted through a path that forgets to credit it back — at which point the number
everybody plans around is quietly wrong with nothing to reconcile it against.

**Pending requests count against the remaining figure**, not just approved ones. Without
that, somebody with a twelve-day allowance can queue five ten-day requests, see "12 days
left" throughout, and hand the approver a pile that only makes sense two at a time. It also
keeps the apply-time check and the approval-time check in agreement.

### c. A request may not span a calendar year

The allowance is per year, so one row cannot cleanly deduct from two. Cross-year requests
are refused with a 422 asking the applicant to split it, rather than charging the whole
thing to the starting year and quietly overdrawing the wrong one.

A configurable financial leave year (Apr–Mar, the Indian HR norm) was considered and
**rejected for now**. Nobody asked for it, and shipping a `yearStartMonth` column that no
UI sets and no code varies would be another instance of the feature-flags trap this project
already cleaned up once (CLAUDE.md §6 P9): a setting that appears to control something and
does not. Adding it later is an additive migration.

### d. Approval and configuration are super_admin-only, enforced by where they are seeded

`leave.approve` and `leave.manage` are upserted in a **dedicated block outside the
permission catalog** in `prisma/seed.ts` — the array the admin + super_admin catch-all loop
iterates — so `admin` does not inherit them. This is the same device the Phase-10 page
builder uses, and it is the entire implementation of "only the super admin decides".

Two guards protect it, because the failure is silent: a permission-catalog spec asserts the
two keys are **not** in `LEAVE_PERMISSIONS`, and an integration test logs in as `admin` and
asserts a 403 on approve and on every setup write.

A note on `grant()`: it is an upsert that **updates the scope**. Re-granting `leave.view` at
`own` to `adminRole` in the staff loop would silently downgrade admin from `all` and break
the approval queue, so admin and super_admin are excluded from that loop by name.

### e. The calendar has its own permission and a projection with no reason field

`leave.calendar.view` is a separate key from `leave.view`, held by every staff role at
`scope=all`.

Folding the calendar into `leave.view` would force a choice between two bad options: at
`scope=own` you cannot see when your colleagues are out, which defeats the purpose; at
`scope=all` everybody can read everybody's stated reason for being off, which will contain
medical detail. The split gives team-wide visibility of *when* without any visibility of
*why*.

The privacy is structural rather than conventional: the calendar's Prisma `select` never
fetches `reason` or `review_note`, so no future careless spread in a mapper can leak them.

### f. Overlap is prevented with an advisory lock, not an exclusion constraint

Overlap is a range predicate, which no unique index can express. Postgres *can* express it
with `EXCLUDE USING gist (user_id WITH =, daterange(...) WITH &&)`, but that requires
`CREATE EXTENSION btree_gist`, and no migration in this repo has ever imposed an extension
prerequisite on a deployment target.

Instead, creating and approving both take `pg_advisory_xact_lock(hashtext(user_id))` inside
the transaction — the primitive already proven here for invoice numbering
(`CommerceRepository.generateInvoiceNumber`), needing no migration at all. It is keyed on
the applicant rather than the tenant because the invariant is per-person, so there is no
cross-staff contention.

That closes the INSERT race. A separate mechanism closes the TRANSITION race: approve and
reject run `updateMany ... WHERE status = 'pending'`, and a zero-row result is how the
service learns another approver got there first (a 409, not a second deduction). The two
races are different and neither guard substitutes for the other.

### g. One duration function, run identically in both places

`computeLeaveDuration` lives in `@repo/types` and is called by the CRM apply form for its
live "3.5 working days" preview and by the API as the authority. The API recomputes from its
own holiday list and ignores any duration the client sends.

This follows the `buildOnboardingAnswerIssues` precedent (ADR-0064) for the same underlying
reason: when both sides must agree on a rule, two hand-written implementations drift, and
the first symptom is a form that previews four days and then 422s — or worse, books
something other than what it showed. All arithmetic is `Date.UTC`-based so the host timezone
cannot change the answer.

## Consequences

- Changing next year's holiday list cannot retroactively alter the length of leave already
  taken: `half_days` is computed at apply time and **stored**. Deleting a holiday therefore
  affects only future requests, which the CRM says explicitly in the delete dialog.
- A leave type that has ever been used cannot be deleted (409) — only deactivated — so past
  leave keeps a readable label. The balance screen additionally unions in types referenced
  by the viewer's own history, so a deactivated type's deducted days never go unexplained.
- Unpaid leave (`paid: false`) skips the allowance check entirely and reports a `null`
  entitlement rather than a zero, which would read as a refusal.
- No holidays are seeded. A holiday list is region- and company-specific, and a wrong seeded
  holiday fails silently in the wrong direction: it makes leave across that date cost a day
  less than it should, and nobody notices until the balances are audited.
- Three new `NotificationType` values (`leave_requested`, `leave_approved`,
  `leave_rejected`) default to email as well as in-app — unlike `lead_assigned`, the other
  staff-facing type, which is in-app only. Volume is a handful a month rather than one per
  lead, and somebody is waiting on each of them.
