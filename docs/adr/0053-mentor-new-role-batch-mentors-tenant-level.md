# ADR 0053: Mentor as a new role — nullable-login profile, `batch_mentors` M:N assigned-scope, tenant-level records

## Status
Accepted

## Context
`docs/specs/phase-8-mentor.md` (Phase 8, human-mentor track) requires a new operational
layer: a real, named, **externally-hired** subject-matter expert accountable for leading a
batch of students to internship completion — distinct from the existing internal Faculty
role, which authors content and grades (P4). Before this spec, `docs/03-prd-crm.md §9` and
`docs/02-prd-lms.md §9` informally combined "Faculty/Mentor" as one label (the spec's
CONFLICT-P8-MENTOR-1).

The spec's LOCK-1 called for `mentors` to be a strict 1:1 profile extension of `users`,
mirroring `faculty_profiles` (ADR-0007) exactly — `user_id` FK required, not nullable — so
that creating a mentor hiring record would always atomically create/link a platform login,
the same way student/faculty creation works. The spec's Part 7 entity table also named a
nullable `branch_id` FK on `mentors`, driving Branch Manager hiring-record scope the same
way `faculty_profiles.branch_id` does.

During implementation, two deliberate divergences from that literal design were made:

1. **`Mentor.userId` is nullable**, not required. A mentor hiring/sourcing record is
   routinely created by admin/staff during recruitment — often long before (or without ever)
   that mentor being given a dashboard login. Forcing an atomic user-creation at
   record-creation time (the `faculty_profiles`/`student_profiles` pattern) would mean
   inventing a throwaway login for every prospective mentor, most of whom may never need
   one. `userId` is `@unique` (nullable-safe — Postgres unique indexes permit multiple
   `NULL`s), so at most one mentor row may ever be linked to a given user once a login IS
   granted, preserving the 1:1 guarantee for mentors that have one while allowing many that
   don't — a hybrid of the `faculty_profiles` 1:1-extension pattern (ADR-0007) and the
   `leads` → `student_profiles` pre-account pattern (ADR-0018).
2. **`mentors` carries no `branch_id` column at all.** Every mentor row is tenant-scoped
   only. Unlike Faculty (an internal hire tied to one branch's roster), a mentor is
   explicitly modeled as an **org-shared external hire**: the same externally-hired expert
   can plausibly run batches across branches, and their hiring record (institute, contact,
   expertise) is a tenant-wide directory entry, not a branch possession.

## Decision
Mentor ships as a new, distinct system role (`roles.key = 'mentor'`) — never a relabeling
or an alias of Faculty.

- `mentors` is a profile-adjacent table with a **nullable** `user_id` (`@unique`), not a
  strict required 1:1 extension. A hiring record can exist standalone (sourcing/onboarding)
  and later be linked to a login when dashboard access is actually granted; linking is a
  one-way, at-most-once operation enforced by the unique constraint.
- `mentors` has **no `branch_id`**. Every row is tenant-level (`tenant_id` only).
- The Mentor role's `assigned` data scope is the M:N analogue of ADR-0031's faculty
  resolution chain: `enrollment.batch_id → batch_mentors WHERE mentor_id =
  current_user.mentorProfile.id AND deleted_at IS NULL`, resolved by
  `EnrollmentScopeRepository.resolveBatchIdsForMentor(tenantId, userId)`. Fail-closed
  identically to ADR-0022/ADR-0031: a `mentor`-role user with no linked `mentors` row, or
  with no active `batch_mentors` row for the requested batch, resolves to an empty result
  set — never "all" — surfacing 404 for any out-of-scope batch, never a 403 that would
  confirm the batch's existence.
- The `mentors` ↔ `batches` relationship is a new many-to-many join, `batch_mentors`
  (`BatchMentor`), not a single FK column on `batches` (unlike `batches.faculty_id`) —
  a batch may have multiple concurrently-assigned mentors, at most one flagged `is_lead`.
  A partial-unique index `batch_mentors_active_batch_mentor_key` on
  `(batch_id, mentor_id) WHERE deleted_at IS NULL` (raw SQL — Prisma cannot express a
  partial `@@unique`, migration `20260708080100_mentors_partial_indexes`) is the DB-level
  backstop for "at most one active assignment per mentor per batch," matching the
  established `user_badges_active_user_badge_key` / `forum_post_votes_active_post_user_key`
  / `submissions_active_no_resubmit_unique` pattern.
- `mentors.assign` (attach/detach/lead-change a `batch_mentors` row) is a permission
  distinct from `mentors.edit` (hiring-record field edits) — a Branch Manager or Admin can
  hold one without the other, and **neither is ever granted to the Mentor role itself**
  (a mentor can never manage other mentor records or assignments, including their own).
- **Consequence of no `branch_id`:** a Branch Manager's `mentors.*` grant, though nominally
  `branch`-scoped in `role_permissions`, is effectively tenant-wide in practice for mentor
  hiring-record CRUD, since there is no branch column to filter on. This is an accepted
  design tradeoff, tracked as F1/DEFECT-P8-01 in `docs/phase-8-followups.md`, not a bug — a
  future `mentors.branch_id` migration is the documented path if per-branch mentor
  ownership is ever required (flagged for product sign-off).

## Consequences
- Faculty is completely unaffected — its permissions, `batches.faculty_id` FK, and
  grading/authoring scope are unchanged by this ADR.
- A mentor hiring record can be created, searched, and managed by Admin/Branch Manager
  staff well before (or without ever) provisioning a dashboard login — matching how
  sourcing/recruitment actually works. Provisioning the login itself has no dedicated API
  endpoint yet (the seed data demonstrates both states: one mentor with a linked user, one
  without) — a "invite/link mentor → user with `mentor` role" admin flow is a deferred item
  (`docs/phase-8-followups.md`).
- Because `mentors` has no `branch_id`, Branch Manager `mentors.*` grants cannot be scoped
  below the tenant today; accepted per the "org-shared external hire" model, but a real
  privacy/ownership concern if a future customer needs per-branch mentor siloing.
- The M:N `batch_mentors` join supports multiple concurrent mentors per batch and
  lead-mentor designation out of the box, at the cost of one extra join-table query on
  every scope resolution — the same cost profile as the existing Faculty single-FK
  resolution, not a distinct concern.
- CONFLICT-P8-MENTOR-1 (the informal "Faculty/Mentor" label in `docs/03-prd-crm.md §9` /
  `docs/02-prd-lms.md §9`) is resolved by this ADR: those PRD sections are relabeled to
  plain "Faculty," since Mentor is now a genuinely separate, first-class role.

## Alternatives considered
- **Strict 1:1 `user_id`-required extension (the spec's literal LOCK-1 wording), mirroring
  `faculty_profiles` exactly.** Rejected in implementation — it would force creating a
  throwaway login for every mentor still in the prospective/sourcing stage, most of whom
  may never need a dashboard account, adding account-management noise with no benefit
  until a login is actually needed.
- **Reuse a `batches.faculty_id`-style single FK for mentor assignment.** Rejected — the
  spec explicitly requires multiple concurrently-assigned mentors per batch (WS-2) plus an
  optional lead designation, which a single FK cannot express; the M:N join is the direct
  analogue already established for adjacent joins elsewhere in the schema.
- **Add `mentors.branch_id` now, matching `faculty_profiles.branch_id`.** Deferred, not
  rejected outright — the spec named it, but mentors were reframed during implementation as
  org-shared external hires whose hiring record isn't naturally one branch's possession;
  the gap is accepted and tracked (F1/DEFECT-P8-01) rather than silently dropped.
- **Fold `mentors.assign` into `mentors.edit` as one combined permission.** Rejected — the
  spec (AC-29) requires them to be independently grantable so staffing decisions (who runs
  a batch) can be delegated separately from profile-data edits (contact info, notes).

## Related
Extends ADR-0007 (student/faculty as profile extensions) and ADR-0018 (lead own/assigned
scope) with a hybrid pattern; extends ADR-0031's faculty assigned-scope resolution chain to
its M:N form; follows ADR-0022's IDOR→404 fail-closed pattern. See ADR-0054 (completion
rollup + mark-complete) and ADR-0055 (AI-mentor exploration + removal) for the other two
Phase 8 mentor-track decisions.
