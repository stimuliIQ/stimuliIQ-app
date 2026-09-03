# Org hierarchy — teams, managers, team leads, HR (P17)

Status: **Complete.** Teams, two-step leave approval, and all three team-scoped reporting
surfaces are shipped.

ADRs: [0069](../adr/0069-org-hierarchy-teams.md) (the hierarchy),
[0070](../adr/0070-two-step-leave-approval.md) (two-step approval).

---

## 1. Why this exists

The product had **no employee hierarchy of any kind**. A grep of `prisma/schema.prisma` for
`team|manager|supervisor|reportsTo` returned nothing. The only org-partitioning column was
`user_roles.branch_id` — a flat per-assignment tag — and `branch_manager` was a role key with
no FK to the branch it managed and no subordinates.

The visible cost was leave. `LeaveRepository.listApprovers` hardcoded *"every active
super_admin"*, and `leave.approve` was seeded outside the permission catalog so not even
`admin` held it. One person signed off every absence in the company.

## 2. The shape

**Manager → Team Lead → Members**, held as two nullable pointers on the team
(`teams.manager_user_id`, `teams.lead_user_id`) rather than a recursive `users.reports_to_id`.

A recursive parent pointer needs cycle detection on every write and an unbounded walk on
every approval. Two pointers give a **fixed-depth chain** — member → lead → manager →
super_admin, at most three hops — that resolves in one read and **cannot form a cycle by
construction**. The cycle question is not answered; it is designed away.

**Membership is exactly one team per person**, stored as a nullable `users.team_id`. One
column makes the wrong state unrepresentable; a join table needs a partial-unique index to
say the same thing and can drift. Two teams would mean two leads and two managers, which
makes "who approves your leave" a non-function.

**Branches are untouched.** A branch is a *place* (which centre a batch or student belongs
to); a team is *people*. `teams.branch_id` is a label and nothing scopes on it.

**HR is not a node in the tree.** Its authority is company-wide by definition, so putting it
in the tree would mean every team needed an HR member. HR staff sit on an ordinary team like
anyone else, so their own leave has a chain (it goes to the super admin); their authority
comes from the `hr` role.

### Assignment rules

`validateTeamAssignment` (`@repo/types`) is run identically by the CRM form and the API. All
three rules exist to keep the approval chain a **function**:

| Rule | Why |
|---|---|
| manager ≠ lead | Otherwise a member's two approval steps are the same signature twice — a one-step approval wearing a disguise. |
| the manager is not a member of their own team | They would end up approving their own leave. |
| the lead is not a member of their own team | Same. |

Both pointers are **nullable on purpose**. A team is routinely created before its lead is
hired. An unresolved pointer *shortens* the chain rather than stranding the request, and shows
in the UI as a named gap ("Not set") rather than a fabricated one.

## 3. Who approves whose leave

`resolveLeaveApprovalChain` (`@repo/types`) is the one definition, run by the API to authorise
and by the CRM to say where a request is going.

| Applicant | Step 1 | Step 2 |
|---|---|---|
| a member of team T | T's lead | T's manager |
| T's own lead | *skipped* | T's manager |
| a manager | *skipped* | super admin |
| HR | *skipped* | super admin |
| on no team yet | *skipped* | HR / super admin |

**Nobody ever approves their own request.** Wherever resolution lands on the applicant, that
step is dropped and the chain shortens — enforced server-side (`leave.self_review`, 403), not
by hiding a button. This closed a hole that existed before: the super admin's `scope=all`
covered their own row.

A team lead is **not a member of their own team**, so their `users.team_id` is null. The
repository therefore treats a team they *lead* as their approval home. Without that, a lead's
leave fell through to the HR fallback instead of reaching their manager. (Found by running
the resolver against real rows, not by a unit test — there is now a regression test for it.)

## 4. Two-step leave approval

One new status: **`lead_approved`**. `pending` is deliberately not renamed — it still means
"not yet decided", every existing row carries that meaning, and three indexes and the whole
front-end filter enum are built on it.

```
pending ──lead approves──▶ lead_approved ──manager confirms──▶ approved
   │                            │
   └──────── reject ────────────┴──────────────────────────────▶ rejected
```

A single-step chain goes `pending → approved` directly, exactly as before.

**A lead may reject outright but may not approve outright.** Deliberately asymmetric: a "no"
should not wait for a second signature, because the applicant needs to re-plan. Same call P4
makes on grading and P14 on its four verbs.

### The status sets

`LEAVE_UNCOMMITTED_STATUSES` and `LEAVE_LIVE_STATUSES` are defined **once** in `@repo/types`
and imported everywhere. Before this, ten separate string literals across the leave service
and repository answered "which requests are still live?". Missing one when a third live
status was added would not fail a test — it would silently stop counting somebody's days for
the hours their request sat with the manager, and let two requests be approved against one
allowance. `leaveStatusSetsCoverEveryStatus()` is asserted in the spec so a future status
cannot be added without being classified.

**Days are deducted only on the final approval.** A `lead_approved` request still blocks an
overlap and still counts against the balance as *pending*.

### Race guards, all preserved

- **Status-guarded `updateMany`** — the lead step moves `from: ["pending"]`, the manager step
  `from: ["lead_approved"]`. A zero-row result is a 409.
- **The final transition is narrowed to the state actually read**, so a lead approving between
  the read and the write produces a 409 rather than the manager's id overwriting the lead's.
- **The advisory lock and in-transaction allowance re-check stay on the final step only** —
  the lead's step commits nothing, so there is nothing to double-charge.

### The queue

Every staff role holds `leave.approve` at `scope=own`, uniformly. **The permission says you
may act; the org chart decides on whom.** A lead who leads no team resolves to an empty set of
subordinates: their queue holds only their own requests, and deciding one is refused twice
(404 for no standing, 403 for self-review).

The alternative — a dedicated `team_lead` role granted per person — was rejected because a
person's position would then live in two places, the role and the team, and those drift.

`leave.view` stays at `scope=own` for staff, and the queue is widened from the **org chart**
rather than the permission: the actor sees their own requests plus those of the people they
actually approve for. Widening the grant to `all` would hand them the whole company, reasons
included — exactly what `leave.calendar.view` was split out to avoid.

## 5. Permissions

| Key | In the seed catalog? | Held by |
|---|---|---|
| `org.teams.view` | **Yes** | super_admin, admin, hr, branch_manager |
| `org.teams.manage` | **No** | super_admin, hr |
| `leave.approve` | **No** | super_admin, hr (`all`); every staff role (`own`) |
| `leave.manage` | **No** | super_admin, hr |

`org.teams.manage` sitting outside the catalog is the **security keystone**. Because the
hierarchy is data and the approval rule is uniform, *whoever can edit teams decides who signs
off whose leave* — authority equivalent to `leave.approve`, narrowed by the same device.

`admin` holds neither authority key. That invariant is pinned by
`leave.permission-catalog.spec.ts` and `org.permission-catalog.spec.ts`.

**Known limitation:** a team manager who holds only the `admin` role cannot approve, because
`admin` is deliberately excluded from `leave.approve`. Give such a person a staff role or
`hr`. Flagged rather than silently resolved, because relaxing it would undo the P13 narrowing.

## 5b. The three team-scoped surfaces

All three follow the same rule as leave — **the permission is uniform, the org chart
decides** — and all three are granted at `scope=own` to every staff role, with the wider
grants left alone.

| Surface | Company-wide (`all`) | Team (`own`) |
|---|---|---|
| Marketing targets | super_admin sees and sets for everyone | a manager sees and sets for their own people |
| Lead performance | super_admin / marketing see everyone; branch_manager sees their branch | a manager sees themselves plus their team |
| Leave calendar | everyone, the default | "My team" — team-mates, the lead and the manager |

Three details worth knowing:

- **The marketing-target list EXCLUDES the actor; the lead-performance report INCLUDES
  them.** Deliberate, not an inconsistency. A manager must not set their own number (same
  reasoning as "nobody approves their own leave"), but they are measured on lead
  performance alongside their team, and omitting them would make the team total disagree
  with the company one.
- **The calendar filter is a convenience, not a privacy control.** `LEAVE_CALENDAR_SELECT`
  never fetches `reason` at any setting, so the company-wide default leaks nothing the team
  view would have hidden. Do not let a later edit treat the filter as the reason a wider
  projection feels safe.
- **`grant()` upserts and UPDATES scope**, so `seed-org.ts` carries a `DO_NOT_DOWNGRADE`
  list: `branch_manager` and `marketing` already hold `reports.lead_performance.view` at
  wider scopes, and re-granting would silently shrink a report they rely on.

## 5c. The staff form finally writes team AND branch

Both pickers were added together, because shipping a Team picker beside a Branch picker
that silently did nothing is the `stats.headline` trap.

`user_roles.branch_id` had existed since Phase 0 and **nothing ever wrote it** — so a
`branch_manager` created through the CRM had no branches, every branch-scoped query
returned zero rows, and the role was unusable without a hand-edit in the database. The
branch is written onto each role assignment (where the column lives), and on edit it is
read back BEFORE the role purge and re-applied, so renaming somebody no longer empties
their territory.

## 6. Screens

| Screen | Route | Gate |
|---|---|---|
| Organisation ▸ Teams | `/org/teams` | `org.teams.view` to open, `org.teams.manage` to write |
| Leave ▸ Approvals | `/leave/approvals` | `leave.approve`, filtered by the org chart |

The team drawer edits name, manager, lead and roster together, because they are one decision.
The approvals queue gained an "Awaiting the manager" filter, and the drawer's primary verb
reads **Confirm** rather than **Approve** on a request the lead has already approved.

## 7. Setting it up on an existing database

```
prisma migrate deploy      # additive: teams, users.team_id, lead_approved, 3 leave columns
pnpm db:seed:org           # permissions, the hr role, the grants
```

**Never** run the full `pnpm db:seed` against a live database.

**No teams are seeded, nobody is put on one, and nobody is given the `hr` role.** A seeded
team is not placeholder data — it is a live approval route for real people's absence, and a
wrong one fails silently in the direction nobody checks. Same call `seed-leave.ts` makes on
holidays and `seed-careers.ts` on job openings.

**Day one:** nobody has a team, so every chain is single-step and routes to HR/super_admin —
byte-for-byte today's behaviour. Existing `pending` rows keep their meaning. No backfill.

## 8. Tests

| File | Covers |
|---|---|
| `packages/types/src/crm/org.spec.ts` | the chain in every position, and the assignment rules |
| `packages/types/src/crm/leave.spec.ts` | status-set coverage — a new status must be classified |
| `apps/api/src/modules/org/org.service.spec.ts` | assignment refusals, 404-not-403, disband ordering, chain resolution incl. the lead's approval home |
| `apps/api/src/modules/org/org.permission-catalog.spec.ts` | `org.teams.manage` stays out of the catalog; no teams seeded |
| `apps/api/src/modules/leave/leave.service.spec.ts` | the two-step chain, self-review, the narrowed final guard |
| `apps/api/src/modules/leave/leave.permission-catalog.spec.ts` | the narrowing, widened to hr and still excluding admin |
| `apps/crm/src/components/org/teams-workspace.test.tsx` | incomplete teams flagged, writes hidden from viewers |
| `apps/crm/e2e/org-teams.e2e.spec.ts` | the Teams screen in a real browser: drawer opens, pickers populate, the shared validator disables Save. Stubs the API, so it needs no backend |
| `apps/crm/e2e/leave-two-step.e2e.spec.ts` | the LIVE chain: member → lead → manager, with the balance moving only at the end. Double-gated behind `QA_LEAVE_PASSWORD` + `QA_ALLOW_DESTRUCTIVE=1`, because it writes real leave records |
| `apps/crm/e2e/team-scoped-reports.e2e.spec.ts` | the three narrowings, live: a manager must see a STRICT SUBSET of what the owner sees, on marketing targets, lead performance and the calendar. Needs `QA_LEAVE_PASSWORD` but NOT the destructive gate — it is read-only |
| `scripts/dev-provision-e2e-org.cjs` (`pnpm dev:provision:e2e-org`) | builds the approval chain both live specs above name as their defaults. Added 2026-09-03: the accounts are seeded `invited` with placeholder hashes and nobody is on a team, so on any freshly seeded database both specs had always skipped themselves. Local-only, guarded like `dev-set-passwords.cjs`, idempotent |

The Playwright journey earned its place immediately: it caught a gap no unit test had, where
a **manager could approve straight from `pending` and skip the team lead entirely**. The rule
matched on "are you the final approver?" without asking whether the request had reached the
final step. It fails invisibly — the row simply comes back approved — which is exactly the
class of bug an end-to-end journey exists to find.
