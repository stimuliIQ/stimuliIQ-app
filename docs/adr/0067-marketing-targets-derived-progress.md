# ADR-0067 — Monthly marketing targets: two numbers per row, progress never stored

**Status:** accepted · 2026-08-21
**Supersedes:** nothing
**Related:** ADR-0065 (leave: derived balances), `docs/specs/marketing-targets.md`
**Migration:** `20260821100000_marketing_targets`
**Seed step (live DB):** `pnpm db:seed:marketing-targets`

---

## Context

Marketing had a scoreboard and no goal.

`GET /crm/reports/lead-performance` already computed, per rep, how many leads they were
assigned, how many they contacted and how many converted. But nothing said what any of those
numbers were *supposed* to be. "Did Rahul have a good March" was a judgement call every time
it was asked, and — more to the point — **nobody on the marketing team could see what they
were being measured on at all.** The report is gated on `reports.lead_performance.view` and
reads as a management tool; a marketing person opening the CRM saw revenue and enrolment
charts for the whole business and nothing about themselves.

The owner asked for the goal: a monthly target per marketing person, visible to them on the
dashboard, settable and reportable by the super admin, with progress that moves on its own
as deals close.

## Decision

### 1. A target row carries TWO numbers, not one, and not two rows

`conversions_target` (deals) and `revenue_target_paise` (rupees) live in the same row.

A marketing target is one sentence — "close 40 deals worth ₹5,00,000 this month" — and the
two halves are one decision. Splitting them into separate rows would let somebody set the
deals number for March and forget the rupees one, leaving a dashboard card half-blank with
no way to tell whether that was deliberate.

Either number may be `0`, which means **"not measured on this"** and hides that card. A
missing row means **"no target at all"** and shows a different empty state. Those are
genuinely different states and the UI distinguishes them. A row with *both* at zero is
rejected (422) — it would render as a permanently-complete 0/0 card, and "no target" is what
deleting the row is for.

### 2. Progress is derived on read. There is no `completed` column

`completed` and `pending` are recomputed on every request from:

| Metric | Source | Window |
|---|---|---|
| Conversions | `leads.converted_at`, owned by the person | `[month, month+1)` |
| Revenue | `payments.status='captured' AND paid_at IS NOT NULL`, joined `order → student → lead.owner_id` | `[month, month+1)` |

This is the same call ADR-0065 made for leave balances, for the same reason: **a stored
counter drifts the first time a lead is reassigned, a conversion is undone or a payment is
refunded — and it drifts silently, in the direction that flatters the number.** A scoreboard
that is quietly wrong in the flattering direction is worse than no scoreboard.

It also means the owner's "when they closed, it should reduce automatically" requirement is
not a feature that has to be maintained: there is nothing to keep in sync, because nothing is
stored.

The revenue definition (`captured` + `paid_at`) is copied verbatim from `mv_revenue_daily`
(migration `20260704060200`) so the sum of every person's revenue reconciles with the revenue
dashboard rather than quietly disagreeing with it. Like that view, it is **gross of refunds**.

### 3. `leads.converted_at` is a new column, and is not backfilled

`leads.converted_student_id` already recorded *whether* a lead closed. Nothing recorded
*when*.

The obvious substitute — the student row's `created_at` — is wrong: converting **links** a
lead to a `StudentProfile` that may already have existed, so that timestamp is the day the
person became a student, not the day this deal closed. A monthly target must count the month
the deal actually closed, so the event gets its own column, written in the same `UPDATE` as
`converted_student_id`.

Existing converted leads keep `converted_at = NULL` and are counted in **no** month. A
best-effort backfill would mix real and inferred close dates inside a number people are
reviewed against. This is the same call the lead-ownership pass made for `created_by_id`:
history reads as unattributed, and the feature is correct from the migration forward.

### 4. Two permissions, NEITHER in the catalog

| Key | Held by | Scope | Answers |
|---|---|---|---|
| `marketing_targets.view` | `marketing` **only** | `own` | "What am I being measured on?" |
| `marketing_targets.manage` | `super_admin` **only** | `all` | "What should Rahul's number be?" + the team report |

Both are upserted in a dedicated block **outside** `permissionCatalog` — the array the
admin+super_admin catch-all loop iterates. Catalog membership would hand both to every
operational admin without anyone deciding to. `manage` is narrowed for the same reason as
`leave.approve`: setting the number a person is judged against is the owner's call.

`view` is kept out too, which is less obvious. An admin has no marketing target of their own,
so granting it would put a permanently-empty "My target" card on their dashboard forever.
The asymmetry (marketing has `view` not `manage`; super_admin has `manage` not `view`) is
deliberate and pinned by `marketing-targets.permission-catalog.spec.ts`.

The own-card endpoint is `GET /crm/marketing-targets/me` and takes **no user id**. The
subject is always the session user, so `scope=own` is the entire gate and there is no
parameter to tamper with.

### 5. One screen for setting and reporting, not two

CRM ▸ Marketing ▸ Targets is a single table: every targetable person, their number, their
progress, and a row action to edit it. You decide next month's number by looking at how this
month went, and splitting that across an "edit" page and a "report" page would mean holding
one in your head while reading the other.

People with **no** target still appear, with real completed figures and a "Not set" chip.
Omitting them would make "nobody gave Anil a target" look identical to "Anil is not on the
team", and the first is exactly what this screen exists to catch.

## Consequences

- Progress costs two aggregate queries per read. Both are indexed
  (`leads(tenant_id, owner_id, converted_at)`; the payments join rides existing keys) and the
  row set is the marketing team, not the lead table.
- Refunds do not reduce anybody's number, matching the existing house definition of revenue.
  If that changes, it should change in `mv_revenue_daily` and here together.
- Reassigning a lead moves its conversion to the new owner retroactively, including for
  months already closed. This matches the existing lead-performance report and is the honest
  reading of "leads this person owns", but it does mean a historical month can shift.
- A target survives its owner losing the marketing role: the row still reports, because the
  number was set and the month happened. Erasing it on a role change would delete history.

## Alternatives rejected

**Store `completed` and update it on conversion.** Faster reads, and wrong within a week —
every path that unwinds a conversion or refunds a payment becomes a place the counter can be
forgotten, and the failure is silent.

**One configurable metric per target row.** Considered (conversions *or* revenue *or* leads,
picked per target). Rejected: the owner wanted both tracked together, and a metric dropdown
makes the common case harder to state than it is.

**Reuse `reports.*` permissions.** Rejected: `reports.lead_performance.view` is held by
marketing at scope `all`, so folding targets into it would let any marketing person read the
whole team's numbers. The own-card view is a different privilege from the report.
