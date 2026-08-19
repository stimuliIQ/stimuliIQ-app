# Staff Leave Management

> CRM ▸ Leave Management. ADR-0065. Built 2026-08-18.

## What it is

Staff apply for time off in the CRM; the **super admin** approves or rejects; the super
admin also authors the yearly allowances and the company holiday list. Everybody sees one
shared calendar of holidays, weekly offs and who is away.

Before this, leave was arranged outside the product entirely — no record, no trail, no
shared view.

## Screens

| Screen | Route | Permission | Who sees it |
|---|---|---|---|
| My Leave | `/leave` | `leave.view` | Every member of staff |
| Approvals | `/leave/approvals` | `leave.approve` | Super admin only |
| Calendar | `/leave/calendar` | `leave.calendar.view` | Every member of staff |
| Setup | `/leave/setup` | `leave.manage` | Super admin only |

The sidebar hides what the viewer lacks, so an ordinary member of staff sees exactly two
items. That is presentation only — the API guard is the enforcement (CLAUDE.md §3.5).

## Permissions

| Key | Scope granted | Held by |
|---|---|---|
| `leave.view` | `own` | every staff role (`all` for admin/super_admin) |
| `leave.request` | `own` | every staff role |
| `leave.calendar.view` | `all` | every staff role |
| `leave.approve` | `all` | **super_admin only** |
| `leave.manage` | `all` | **super_admin only** |

The first three are ordinary catalog permissions. The last two are seeded in a **dedicated
block outside the catalog** in `prisma/seed.ts`, so the admin + super_admin catch-all loop
cannot grant them — that block is the entire implementation of "only the super admin
decides". `student` and `mentor` get nothing: neither is staff with an allowance.

`leave.calendar.view` is separate from `leave.view` on purpose. The calendar is company-wide
but its endpoint returns a projection that never fetches `reason`, so the team can see *when*
somebody is out without anybody seeing *why*. See ADR-0065 (e).

## Rules

**Duration.** Computed server-side by `computeLeaveDuration` (`@repo/types`), the same
function the apply form runs for its live preview. Weekly offs and mandatory holidays are
skipped; optional (restricted) holidays are not, because taking one is a choice. A client
never supplies a duration.

**Half days.** Full day, first half, or second half. On a multi-day request only
`second_half` on the first day and `first_half` on the last are coherent — the opposite
pairings describe somebody back at their desk mid-absence, and are refused with 422
`leave.invalid_day_part`. On a single-day request `endDayPart` is ignored.

**Allowance.** Per leave type per year, company-wide. `remaining = entitled − approved −
pending`; pending counts, so nobody can queue more than they have. Checked at apply time
(a courtesy) and again inside the approval transaction (the authority). A year with no
allowance set gives 422 `leave.quota_not_set` — deliberately distinct from "none left".
Unpaid types skip the check entirely.

**Year boundary.** A request may not span two calendar years (422 `leave.cross_year`) —
the allowance is per year and one row cannot deduct from two.

**Overlap.** A person cannot hold two pending/approved requests covering the same day
(409 `leave.overlapping_request`), enforced under a per-user advisory lock.

**Decisions.** Only a `pending` request can be decided. Approving deducts; rejecting
requires a reason, which is emailed to the applicant verbatim and deducts nothing. Two
approvers racing produce one 200 and one 409 (`leave.already_reviewed`).

**Withdrawing.** The applicant's own action. A `pending` request always; an `approved` one
only before it starts — crediting back days somebody was actually absent for would make the
balance disagree with reality.

**Holidays.** Deleting one does **not** re-measure leave already approved across it.
`half_days` is stored at apply time, so a calendar correction in November cannot retroactively
lengthen leave people already took.

**Leave types.** Deleting one is refused (409 `leave.type_in_use`) once any request uses it —
deactivate instead, which removes it from the apply form and leaves history readable. The
balance screen unions in types referenced by the viewer's own requests, so a deactivated
type's deducted days never go unexplained.

## API

All under `/api/v1/crm/leave`, `JwtAuthGuard + PermissionsGuard + ScopeInterceptor`.

| Method | Path | Permission |
|---|---|---|
| GET | `/apply-context` | `leave.request` |
| GET | `/balances?year=&userId=` | `leave.view` |
| GET | `/calendar?from=&to=` | `leave.calendar.view` |
| GET | `/requests` | `leave.view` |
| GET | `/requests/:id` | `leave.view` |
| POST | `/requests` | `leave.request` |
| POST | `/requests/:id/cancel` | `leave.request` |
| POST | `/approvals/:id/approve` | `leave.approve` |
| POST | `/approvals/:id/reject` | `leave.approve` |
| GET | `/setup/types`, `/setup/quotas`, `/setup/holidays`, `/setup/settings` | `leave.view` |
| POST/PATCH/DELETE | `/setup/types[/:id]`, `/setup/holidays[/:id]` | `leave.manage` |
| PUT | `/setup/quotas` | `leave.manage` |
| PATCH | `/setup/settings` | `leave.manage` |

`GET /requests` and `/balances` are scope-filtered: `own` narrows to the caller (a
client-supplied `userId` is ignored, not rejected), `all` sees everybody. `branch` and
`assigned` fail closed with a 403 — there is no coherent branch partition of a company-wide
allowance.

Out-of-scope reads answer **404, not 403**: a 403 confirms the row exists.

## Data

Five tables, all soft-deleted and audited (registered in `SOFT_DELETE_MODELS` and
`AUDITED_MODELS`; there are no explicit audit calls anywhere in the module).

| Table | Holds |
|---|---|
| `leave_types` | Casual / Sick / Earned / Unpaid — CRM-authored rows, not an enum |
| `leave_quotas` | `(year, leave_type_id) → half_days` — the company-wide allowance |
| `holidays` | `date`, `name`, `optional` |
| `leave_settings` | one row per tenant: `weekly_off_days INTEGER[]`, 0 = Sunday |
| `leave_requests` | the work queue |

Durations are **integer half-day units** (`half_days = 7` means 3.5 days) — see ADR-0065 (a).
`start_date`/`end_date`/`holidays.date` are Postgres `DATE` and cross the wire as
`YYYY-MM-DD`, never as a timestamp.

Partial-unique indexes on `leave_types(tenant_id, key)`, `leave_quotas(tenant_id, year,
leave_type_id)`, `holidays(tenant_id, date)` and `leave_settings(tenant_id)` live in raw
migration SQL only — Prisma cannot express `WHERE deleted_at IS NULL`.

## Notifications

Three new types, in-app + email (SMS/WhatsApp stay dark behind the `DLT_PENDING` gate):

- `leave_requested` → every **active super_admin**, so the queue does not depend on somebody
  remembering to open the CRM.
- `leave_approved` / `leave_rejected` → the applicant; the rejection carries the reason.

All sends are best-effort past the commit point and swallow their own failures: a mail
provider having a bad afternoon must never undo an approval.

## Setting it up on an existing database

```bash
pnpm db:migrate:deploy   # additive: 5 tables, 2 enums, 3 NotificationType values
pnpm db:seed:leave       # permissions + grants, 4 leave types, Sundays off, this year's allowances
```

Do **not** run the full `pnpm db:seed` against a live database — it upserts demo students and
programs. `seed-leave.ts` writes only what this feature needs and skips anything staff have
already edited.

**No holidays are seeded, by design.** A holiday list is region- and company-specific, and a
wrong one fails silently in the direction nobody checks: it makes leave across that date cost
a day less than it should. Enter them in CRM ▸ Leave Management ▸ Setup.

## Tests

| File | Covers |
|---|---|
| `packages/types/src/crm/leave.spec.ts` | the duration function — 33 cases incl. DST and cross-year |
| `apps/api/src/modules/leave/leave.service.spec.ts` | scope mapping, allowance maths, races, 404-not-403 |
| `apps/api/src/modules/leave/leave-notification.service.spec.ts` | that no send can fail a mutation |
| `apps/api/src/modules/leave/leave.permission-catalog.spec.ts` | the super-admin narrowing, statically |
| `apps/api/test/integration/leave-management.integration-spec.ts` | the narrowing end-to-end, plus balances, concurrency, calendar privacy |
| `apps/crm/src/components/leave/*.test.tsx` | rendering, RBAC gating, mandatory reason, axe |
| `packages/ui/src/components/calendar.test.tsx` | the `dayTone`/`dayLabel` props |
