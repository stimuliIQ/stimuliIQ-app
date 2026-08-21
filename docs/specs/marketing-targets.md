# Monthly marketing targets

**Status:** implemented
**Touches:** `marketing-targets`, `leads` (API) · `crm` (UI) · `@repo/types`, `@repo/api-client`
**Migration:** `20260821100000_marketing_targets`
**Seed step (live DB):** `pnpm db:seed:marketing-targets`
**Decision record:** ADR-0067

---

## 1. The problem

Marketing had a scoreboard and no goal.

`GET /crm/reports/lead-performance` already reported, per rep, leads assigned, contacted and
converted. Nothing said what any of those numbers were supposed to be, so "did Rahul have a
good March" was re-litigated every time it came up.

Worse, **the marketing team could not see any of it.** That report is gated on
`reports.lead_performance.view` and reads as a management tool. A marketing person opening
the CRM got revenue and enrolment charts for the whole business, and nothing at all about
what they personally were being measured on.

## 2. What a target is

One row per person per month, carrying **two** numbers:

| Field | Meaning | `0` means |
|---|---|---|
| `conversions_target` | deals to close this month | not measured on volume |
| `revenue_target_paise` | rupees to collect this month (integer paise) | not measured on revenue |

Both at zero is rejected (422) — that row would measure nothing and render as a permanently
complete `0/0` card. Deleting the target is how you say "no target".

A **missing row** and a **zero** are different states and the UI shows them differently:
a zeroed metric hides its card, a missing row shows "No target set for this month yet"
alongside what the person has actually closed.

## 3. Progress is derived, never stored

There is no `completed` or `pending` column. Both are recomputed on every read:

| Metric | Definition | Window |
|---|---|---|
| Conversions | `leads.converted_at` inside the month, `leads.owner_id = person` | `[1st, next 1st)` |
| Revenue | `payments.status = 'captured' AND paid_at IS NOT NULL`, joined `payment → order → student → lead.converted_student_id → lead.owner_id` | `[1st, next 1st)` |

`pending = max(target - completed, 0)`, clamped so beating a target reads as "done" rather
than as a negative backlog. `percent` is `null` (not `0`, not `1`) when no target is set —
rendering either would claim something untrue about performance.

That single rule lives in **`summariseTargetMetric` (`@repo/types`)** and is run identically
by the API and the dashboard card, the same discipline as `computeLeaveDuration` and
`buildOnboardingAnswerIssues`. Two implementations would drift, and the first symptom would
be a card disagreeing with the report the same person is reviewed against.

This is also what satisfies "when they close a deal it should reduce automatically": there is
nothing to keep in sync, because nothing is stored.

### `leads.converted_at`

New nullable column, written in the same `UPDATE` as `converted_student_id`
(`LeadsRepository.setConverted`).

`converted_student_id` recorded *whether* a lead closed; nothing recorded *when*. The
tempting substitute — the student's `created_at` — is wrong, because converting **links** a
lead to a `StudentProfile` that may already have existed.

**Not backfilled.** Leads converted before the migration have `converted_at = NULL` and are
counted in no month. Inferring a close date would mix real and guessed dates inside a number
people are reviewed against — the same call the lead-ownership pass made for `created_by_id`.

## 4. Permissions

| Key | Held by | Scope |
|---|---|---|
| `marketing_targets.view` | `marketing` **only** | `own` |
| `marketing_targets.manage` | `super_admin` **only** | `all` |

**Neither key is in the permission catalog.** The catalog is the array the admin+super_admin
catch-all loop iterates in `prisma/seed.ts`; membership would hand both keys to every
operational admin without anyone deciding to. Both are upserted in a dedicated block, the
same device as `leave.approve` / `leave.manage`.

The asymmetry is deliberate: marketing has `view` but not `manage`; super_admin has `manage`
but not `view`. A super admin has no marketing target of their own, and granting `view` would
pin a permanently-empty card to the owner's dashboard forever. The team report **is** the
admin surface. `marketing-targets.permission-catalog.spec.ts` pins all of this.

## 5. Endpoints

| Method | Path | Permission |
|---|---|---|
| `GET` | `/crm/marketing-targets/me?month=YYYY-MM` | `marketing_targets.view` |
| `GET` | `/crm/marketing-targets?month=YYYY-MM` | `marketing_targets.manage` |
| `PUT` | `/crm/marketing-targets` | `marketing_targets.manage` |
| `DELETE` | `/crm/marketing-targets/:id` | `marketing_targets.manage` |

`/me` takes **no user id**. The subject is always the session user, so `scope=own` is the
entire gate and there is no parameter to tamper with. Reading someone else's number is the
list endpoint's job, behind a different permission, and it returns the whole team at once so
a row cannot be quoted out of context.

`PUT`, not `POST` + `PATCH`: "the target for Rahul in March" is one fact, so setting it is
idempotent. A create/edit split would make the caller check existence first and race with
anyone else doing the same.

`month` travels as `YYYY-MM`, never a full date — a `2026-03-17` on the wire would force
every consumer to decide whether that means March or is a bug.

## 6. Screens

**Marketing person — CRM ▸ Dashboard.** A "My target · March 2026" section above the generic
KPI row. For a marketing person this *is* the dashboard; burying it under three charts they
cannot act on would mean scrolling past it every morning. Each measured metric shows
Target / Completed / Pending plus a progress bar, and a verdict chip that only considers
metrics the person was actually given.

**Super admin — CRM ▸ Marketing ▸ Targets.** One table: every targetable person, their
number, their progress, a row action to set or edit it, and four roll-up KPIs. Setting and
reporting are the same screen because you decide next month's number by looking at how this
month went.

Every targetable person is a row **whether or not they have a target**, with a "Not set" chip
and their real completed figures. Omitting them would make "nobody gave Anil a target" look
identical to "Anil is not on the team", and the first is what this screen exists to catch.

## 7. Known limits

- **Gross of refunds.** Copied deliberately from `mv_revenue_daily`, so per-person revenue
  reconciles with the revenue dashboard. If that definition changes it should change in both.
- **Reassignment is retroactive.** A lead's conversion counts for whoever owns it *now*, so
  reassigning a closed lead moves the credit, including in months already reported. This
  matches the existing lead-performance report.
- **Pre-migration conversions count for nobody** (see §3).
- **Targets are per person only.** The team total is the sum of the rows; there is no
  separately-settable team number, which would be a second source of truth free to disagree
  with its own parts.
- **No notification.** Hitting or missing a target sends nothing. If "you hit your target"
  becomes a notification, `MarketingTargetsModule` needs `NotificationsModule`.

## 8. Setup on an existing / live database

```
prisma migrate deploy          # additive: one table, leads.converted_at, two indexes
pnpm db:seed:marketing-targets # the two permissions + their grants. No targets are seeded.
```

Do **not** run the full `pnpm db:seed` against a live DB — it upserts demo students, programs
and campaigns. No targets are seeded on purpose: a seeded target is a number a real person is
measured against, and a wrong one fails silently in the direction nobody checks, by making
somebody look like they are missing a goal nobody set.
