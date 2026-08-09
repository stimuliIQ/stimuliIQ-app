# Lead ownership & accountability

**Status:** implemented
**Touches:** `leads`, `activities`, `notifications`, `analytics`, `public` (API) · `crm` (UI) · `@repo/types`, `@repo/api-client`, `@repo/ui`
**Migration:** `20260808100000_lead_ownership_accountability`
**Seed step (live DB):** `pnpm db:seed:lead-performance`

---

## 1. The problem

Assigning a lead to a staff member was a silent single-column `UPDATE`.

- **Nobody was told.** No email, SMS, WhatsApp or in-app signal fired on assignment. The
  CRM's top-bar bell was a hard-disabled "coming soon" placeholder. The assignee found out
  whenever they next happened to open the pipeline.
- **Assignment was impractical.** Every owner control — lead drawer, create form, bulk
  toolbar — was a raw **user-UUID text box**. Correct assignment required a database query,
  so in practice leads stayed with whoever the round-robin picked.
- **`marketing` could not find their own leads.** The role holds tenant-wide (`all`) lead
  scope, and the pipeline filter bar offered only Search / Source / Stage. There was no
  "assigned to me".
- **Nothing was measurable.** The lead row recorded no creator, no assigner, and no
  contact timestamp. `audit_logs` held the events but is admin-only, polymorphic and
  append-only — fine for forensics on one record, useless for aggregating a per-rep report.

## 2. What changed

### 2.1 Schema (additive, five nullable columns + one enum value)

| Column | Meaning | NULL means |
|---|---|---|
| `leads.created_by_id` | staff user who keyed the lead in | **inbound** (website form / API), not "missing" |
| `leads.assigned_by_id` | staff user who set the current owner | round-robin chose it; no human decided |
| `leads.assigned_at` | when the current owner was set | never assigned |
| `leads.first_contacted_at` | first call/whatsapp/email/note logged | **nobody has contacted this lead** |
| `leads.last_activity_at` | most recent logged activity | no activity at all |

Plus `NotificationType += lead_assigned` and two report indexes
(`(tenant_id, created_by_id, created_at)`, `(tenant_id, owner_id, assigned_at)`).

Historic rows are **not** backfilled. Creator/assigner for old leads are only recoverable
from `audit_logs`, and a partial best-effort backfill would produce a report that silently
mixes real and inferred attribution. Old leads read as unattributed; the report is correct
from the migration forward.

**`first_contacted_at` is write-once.** `LeadsRepository.touchLeadContact` uses a
conditional `updateMany ... WHERE first_contacted_at IS NULL`, so two reps logging a call
concurrently cannot race to write two different "first" contacts. A `task` activity
(scheduling a callback) moves `last_activity_at` but **does not** count as contact —
otherwise a rep could book a reminder and score a perfect response time without ever
picking up the phone.

### 2.2 Assignment now notifies the assignee

`NotificationsService.notifyLeadAssigned()` fires from:

- `LeadsService.create` (CRM "Add lead", incl. round-robin pick)
- `LeadsService.assignOwner` (manual reassign **and** bulk assign, which loops it)
- `PublicFunnelService.createLead` (inbound website lead → round-robin) — the case that
  matters most, since nobody in the CRM is watching for it

**In-app only by default.** `DEFAULT_PREFS_MATRIX` sets `lead_assigned` email to `false` —
the only type that does. A manager can bulk-assign 50 leads in one click, and 50 emails
would train the rep to filter the sender. A rep who wants email opts in per-type from their
notification preferences. Email/SMS/WhatsApp bodies exist in the template registry because
`renderAll()` renders all four channels, and are written to be correct for that opt-in.

Notification failure is **non-fatal and logged** — a lead that changed hands must never be
reported as failed because the bell did not ring.

Silent cases (deliberate): unassign, no-op re-save of the same owner, and claiming a lead
for yourself.

### 2.3 Who can own a lead

`LEAD_OWNER_ROLE_KEYS = ["counsellor", "marketing"]` — widened from counsellor-only.
Marketing staff work leads here, not just source them. Round-robin picks the lead-owning
user with the fewest currently-open (non-won/lost) leads; ties break by user id so the pick
is deterministic on a fresh tenant.

### 2.4 New endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /crm/leads/assignable-users` | `leads.view` | Owner-picker source. **Not** `users.view` (admin-only), which is exactly why a counsellor could never populate a picker before. Returns name, email, role keys, open-lead count — no credential state, no non-lead-owning staff, nothing deactivated. Declared above `@Get(":id")` or the param route swallows it. |
| `GET /crm/reports/lead-performance` | `reports.lead_performance.view` | Per-rep scoreboard. |

`ListLeadsQuery` gains `mine`, `unassigned`, `createdById`. The three owner filters are
**mutually exclusive** (422 if combined) — they answer the same question in incompatible
ways, and letting one silently win would make a saved view lie about what it shows.
`mine` is resolved **server-side from the session**, so no client needs its own user id and
nobody can ask on someone else's behalf.

### 2.5 The performance report

`GET /crm/reports/lead-performance` is the one report that reads **live tables, not a
materialized view**, and carries no `asOf`/`stale` pair. LOCK-D1 exists so heavy aggregates
don't contend with transactional traffic — right for revenue trends over weeks, wrong for
"has this rep called anyone today", where an MV-latency answer gets someone unfairly pulled
up in a stand-up. Cost is bounded: per-rep `groupBy`s over the indexes above, restricted to
a staff-sized id list.

Windowed by `[from,to]`: `leadsCreated`, `leadsAssigned`, `callsLogged`,
`activitiesLogged`, `followUpsCompleted`, `converted`, `contactRate`,
`avgFirstResponseMinutes`.
**As of now, ignoring the range:** `openLeads`, `overdueFollowUps`. The UI labels this split
explicitly — comparing an as-of-now number against a windowed one produces wrong decisions.

`avgFirstResponseMinutes` is `null`, never `0`, when nobody has been contacted — `0` would
read as an instant response, the opposite of the truth. The SQL also excludes
`first_contacted_at < assigned_at` so reassigning an already-called lead can't drag the new
owner's average below zero.

Every rep in the pool gets a row **including an all-zero one** — a missing row reads as "no
data" when it means "no work".

`unassignedLeads` / `uncontactedLeads` are tenant-wide totals surfaced next to the table:
they belong to no rep's row, which is precisely why they are invisible today.

**Known limitation (documented, not a bug):** `leads` carries `branch_id`, `activities`
does not. For a branch-scoped caller the lead metrics are branch-filtered while activity
counts include everything that branch's staff logged, even on out-of-branch leads.
Filtering activities via their parent lead's branch would drop every student-attached
activity, understating real work by more than the current over-count. Stated in the page's
footnote.

### 2.6 CRM UI

- **`OwnerSelect`** — one picker replacing all three UUID text boxes (drawer, create form,
  bulk toolbar) and doubling as the pipeline's owner filter. Shows
  `Name · role · N open`, because handing a lead to whoever is top of the alphabet is how
  one rep ends up with 200 leads and another with 12.
- **Pipeline** — Owner filter (All / Assigned to me / Unassigned / a named rep), persisted
  into saved views as the discriminated union so a saved "Assigned to me" stays personal to
  whoever opens it. Unassigned and never-contacted render in **warning colour** in the
  table, kanban card and drawer — a lead nobody owns or has called is a problem to fix, not
  a neutral state to scroll past.
- **`LeadAssignmentProvenance`** — owner / assigned-by / created-by / first contact / last
  activity on the drawer's Overview tab, with elapsed-since-assignment.
- **Notification bell** — replaced the disabled placeholder. Polls (60s, incl. backgrounded
  tabs) rather than opening an SSE stream per tab: the CRM is a long-lived dashboard left
  open all day, and the badge is fine arriving within a minute. `openStream()` is available
  if that ever changes.
- **`/leads?owner=mine`** — deep link from the bell. A named mode, not a user id, so a
  pasted link shows the reader *their* leads.
- **Analytics ▸ Team Performance** — the report page.

## 3. Permissions

| Role | `reports.lead_performance.view` |
|---|---|
| super_admin / admin | `all` |
| marketing | `all` |
| branch_manager | `branch` |
| counsellor | **not granted** |

Separate from `reports.funnel.view` on purpose: the funnel measures the business, this
names individuals. Whether a rep sees colleagues' numbers is a management decision, so it
gets its own switch. Grant it from Admin ▸ Roles for an open scoreboard.

## 4. Applying this to an existing database

```bash
pnpm prisma migrate deploy          # additive: 5 nullable columns, 2 indexes, 1 enum value
pnpm db:seed:lead-performance       # the one new permission + its role grants
```

Do **not** run the full `pnpm db:seed` against a live database — it upserts demo students,
programs and campaigns. `seed-lead-performance.ts` writes only the permission and grants.
Without it the Team Performance page 403s for everyone, including super_admin (whose access
comes from a catch-all over the catalog, not a wildcard).

## 5. How to verify

1. Assign a lead to another user from the drawer → their bell badges within a minute; the
   row reads `New lead: <name>` with the phone number, and "Open lead" lands them on
   `/leads?owner=mine`.
2. Submit the public website lead form → the round-robin owner gets the same notification;
   the lead shows "Created by Website (inbound)".
3. Log a call on a lead → `First contact` fills in with elapsed-since-assignment; log a
   second → it does not move.
4. Filter the pipeline to **Unassigned** → warning-coloured rows, matching the
   "Unassigned right now" tile on Team Performance.
5. Team Performance over the last 30 days → every counsellor/marketing user has a row,
   including all-zero ones.
