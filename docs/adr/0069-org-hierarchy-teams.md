# ADR-0069 — Org hierarchy as teams with two pointers, not a reporting chain

Status: **Accepted** (P17, 2026-09-01)
Related: ADR-0070 (two-step leave approval).

## Context

The product had no employee hierarchy. `user_roles.branch_id` was the only org-partitioning
column — a flat per-assignment tag — and `branch_manager` was a role key with no FK to the
branch it managed and no subordinates. Leave approval was consequently hardcoded to "every
active super_admin", so one person signed off every absence in the company.

## Decisions

**(a) A `Team` with `manager_user_id` and `lead_user_id`, not `users.reports_to_id`.**
A recursive parent pointer needs cycle detection on every write and an unbounded walk on
every approval. Two pointers give a fixed-depth chain — member → lead → manager →
super_admin — resolvable in one read, which **cannot form a cycle by construction**. The
cycle question is designed away rather than answered. A manager owning several teams is
several rows pointing at the same user.

**(b) Membership is `users.team_id`, a nullable column, not a join table.**
Exactly one team per person was a firm product decision. One column makes the wrong state
unrepresentable; a join needs a partial-unique index to say the same thing and can drift.
`User` is already in `AUDITED_MODELS`, so every move between teams is audit-logged for free.
The cost — losing a first-class join/leave row — is accepted; the audit trail carries it.

**(c) No new `RolePermissionScope` value.**
Adding `team` would mean a Prisma enum migration, the zod mirror, two separate `SCOPE_RANK`
maps, and — decisively — the CRM permission matrix hardcodes `GRANT_SCOPE = "all"` and saves
by full replace, so a `team` grant would be invisible in the one screen that exists to explain
narrowing, and silently widened to `all` on the next toggle. That is the `stats.headline`
trap. The team graph is resolved inside the modules that care instead.

**(d) `org.teams.manage` is seeded outside the permission catalog.**
Because the hierarchy is data and the approval rule is uniform, whoever can edit teams can
make themselves somebody's approver. That is authority equivalent to `leave.approve`, so it is
narrowed by the same device — a dedicated block outside the admin catch-all. `admin` does not
hold it. `org.teams.view` *is* in the catalog: reading the chart is information, not authority,
and a key held outside it would have to be remembered for every role that needs a team picker.

**(e) Branches are untouched.**
A branch is a place; a team is people. `teams.branch_id` is a label and nothing scopes on it.
Merging the two would have touched every branch-scoped module for no gain.

**(f) HR is a role, not a node in the tree.**
Its authority is company-wide by definition. Putting it in the tree would require every team
to have an HR member and would derive HR's authority from membership. HR staff still sit on an
ordinary team, so their own leave has a chain — it goes to the super admin.

**(g) Nothing is seeded but permissions and the empty `hr` role.**
No teams, no memberships, nobody given `hr`. A seeded team is a live approval route for real
people's absence, and a wrong one fails silently in the direction nobody checks. Same call
P13 made on holidays, P14 on job openings, P15 on targets and P16 on course types.

## Consequences

- On day one nobody has a team, so every approval chain is single-step and routes to
  HR/super_admin — exactly the prior behaviour. Nothing needs backfilling.
- Both pointers are nullable, so an incomplete team is an honest state that *shortens* the
  chain. The UI shows it as "Not set" rather than a blank cell.
- A team lead is not a member of their own team (the assignment rules forbid it, so they never
  approve themselves), so the repository treats a team they *lead* as their approval home.
  Without that, a lead's own leave falls through to the HR fallback instead of reaching their
  manager. Found by running the resolver against real rows, not by a unit test.
- Leading more than one team is allowed; the tie is broken by team name so the answer is
  stable rather than dependent on row order.
- Disbanding a team detaches its members rather than cascading, and detaches *before* the soft
  delete, so no member ever points at a disbanded team.
