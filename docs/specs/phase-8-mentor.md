# Spec: Phase 8 — Mentor (Human, Externally-Hired Batch Lead)

> Written by: product-manager · Phase: P8 · Date: 2026-07-08. An AI-mentor chatbot track was
> explored earlier in P8 and then fully removed at the user's direction — mentors are human
> hires, not AI (see ADR-0055); this spec was never dependent on that track.
> Consumed by: db-architect (#1 — `mentors`/`batch_mentors` entities, `batches.completed_at`
> column, Mentor role/permission seed), api-designer (#2 — DTOs + endpoint contracts),
> backend-builder (#3 — mentor service, assigned-scope resolver, completion rollup,
> mark-complete transition), frontend-builder (#4 — CRM mentor directory + mentor-facing
> dashboard route), design-system (#5 — reuse existing DataTable/EmptyState/Skeleton/status
> chip primitives, no new visual system required), qa-engineer (#6 — all ACs, especially
> isolation), security-reviewer (#7 — RBAC boundary + IDOR ACs), docs-writer (#8 — resolve
> the "Faculty/Mentor" label collision named in Part 6).
>
> **IMPORTANT — this is a HUMAN mentor.** A mentor is a real subject-matter expert **hired
> from an external institute** who leads one or more batches through the internship program
> to completion. This spec contains **no AI, no chatbot, no LLM** of any kind. A
> student-facing AI doubt-solving chatbot was explored earlier in P8 and then fully removed
> at the user's direction — it is explicitly out of scope here (see LOCK-6, ADR-0055).
>
> Every numbered AC below maps to a test in task #6 and, where marked, a security check in
> task #7. Headline ACs: **AC-1** (mentor-record RBAC), **AC-17** (batch-assignment RBAC +
> duplicate/inactive guards), **AC-31** (completion rollup reconciles with existing data,
> no parallel progress system), **AC-46** (mentor dashboard cross-batch/cross-mentor/
> cross-tenant isolation, IDOR-safe). **Total AC count: 61.**

---

## Why (purpose + which metric it moves)

`docs/00-product-strategy.md §2` names the company's core competitive wedge explicitly:
**"structured, mentor-led, project-based internships with a verifiable certificate"** —
positioned directly against Internshala's "thin guided-learning" and Coursera/Udemy's
"impersonal" delivery. Today the platform's schema and PRDs only encode this at the
content-authoring layer (Faculty author/grade in the CRM) and conflate "Faculty" and
"Mentor" into one informal label (`docs/03-prd-crm.md §9`, `docs/02-prd-lms.md §9`). There
is no first-class way to record that a **named, externally-hired subject expert owns a
batch's outcome** — who they are, which institute they come from, which batch(es) they're
running, and whether that batch is actually progressing toward completion. This spec adds
that missing operational layer: a real person accountable for a real batch of students
finishing the program, visible as a role, a hiring record, and a scoped dashboard — without
inventing any new progress-computation machinery (it reads the same enrollment/progress/
assessment/certificate data every other dashboard in this codebase reads).

**Metrics moved:**

| Metric | Direction | Mechanism |
|--------|-----------|-----------|
| Program completion % (≥ 60%, `docs/02 §6`) | Up (indirectly) | A named, accountable mentor per batch — not just an authoring Faculty — is the product's stated differentiator for driving a batch to finish, per `docs/00 §2` |
| Certified Outcomes/Month (North Star, `docs/00 §6`) | Up (indirectly) | Mentor-led delivery is the wedge that is supposed to produce more completed, certified outcomes than unguided/self-paced competitors |
| "I lose motivation" pain point (`docs/00 §5`) | Down (indirectly) | A visible, accountable human running the batch (not just a content author) is a retention lever distinct from gamification |
| Operational throughput per staff member (`docs/03 §2`) | Up | Admin/Branch Manager gets a dedicated hiring + assignment workflow instead of ad hoc tracking of who's running which batch |
| Trust/credibility (North Star support, `docs/00 §10`) | Protected | Mentor dashboard isolation (own-batch-only, fail-closed) prevents a hired-but-scoped external party from ever seeing data outside their assignment |

---

## Users and roles affected

| Role | Scope | New capability in this spec |
|------|-------|------------------------------|
| Admin / Owner | all (tenant) | Create/edit/soft-delete/search mentor hiring records, assign/reassign/remove mentors on any batch, view any batch's completion rollup, mark any batch complete |
| Branch Manager | branch | Same mentor-management + assignment + rollup + mark-complete actions, scoped to their branch's mentors and batches |
| **Mentor (new role)** | assigned batches | Log into `crm`; see only their assigned batch(es): roster, per-student progress/eligibility, batch % complete; mark a batch complete |
| Faculty | assigned batches | **Unaffected.** Faculty continues to author content and grade (P4); this spec does not change Faculty's permissions or scope |
| Counsellor, Finance, Marketing, Support | — | No new capability; no access to mentor records or the mentor dashboard |
| Student (LMS) | own | No new capability. This spec ships no LMS-facing UI (no "meet your mentor" card) — see Part 5 outs |

RBAC is server-enforced (`@RequirePermission` + `ScopeInterceptor`, unchanged pattern from
P0–P7). The UI hides what the API already forbids. No mentor-management or mentor-dashboard
endpoint may return data outside the caller's tenant/branch/assigned scope — asserted
per-workstream below, not assumed.

---

## Locked Decisions (gate-confirmed, not up for debate)

**LOCK-1: Mentor is a new, distinct system role — not a relabeling of Faculty.** `mentors`
is a **1:1 profile extension of `users`**, mirroring the existing `faculty_profiles`
pattern exactly (`user_id` required, not nullable). Creating a mentor hiring record creates
(or links) a platform login account, the same way any other staff-side role's account is
provisioned today — this spec does not invent a new "pre-account" record pattern (unlike
`leads`→`student_profiles`).

**LOCK-2: Mentor `assigned` scope resolves via the new `batch_mentors` many-to-many join,**
not `batches.faculty_id`. This is the M:N analogue of ADR-0031's resolution chain
(`submission → enrollment.batch_id → batches.faculty_id = current_user.id`): for Mentor,
the chain is `enrollment.batch_id → batch_mentors WHERE mentor_id = current_user.mentorProfile.id AND active`.
Fail-closed identically to ADR-0031: a Mentor-role user with no `mentorProfile` (or no
active `batch_mentors` row for the requested batch) gets a 404, never a broader result set.

**LOCK-3: Mentor logs into the existing `crm` app** (the same app Faculty already use) via
a role-aware, simplified dashboard route — consistent with `docs/03 §13`'s existing
role-aware dashboard pattern ("counsellor sees pipeline first; finance sees revenue").
This is **not** a new fourth application and **not** the LMS.

**LOCK-4: The completion rollup and mark-complete action are a read/mutation surface over
EXISTING data** — `enrollments.progress_pct`, `lesson_progress`, `submissions`,
`attempts`, `assessments.is_required`, `assignments.is_final`, `certificates` — reusing the
P4 certificate-eligibility engine (`docs/specs/phase-4-learning-depth.md`) verbatim. This
spec introduces **zero** new progress-computation logic.

**LOCK-5: `batches.markComplete` is a new, narrowly-scoped permission**, distinct from the
existing `batches.edit`. A Mentor can signal a batch's program run is finished without
gaining rights to edit batch capacity, schedule, dates, faculty, or branch — those remain
Admin/Branch Manager territory via the existing `batches.edit` permission, unchanged.

**LOCK-6: An AI Mentor (student-facing LLM doubt-solving chatbot) was explored earlier in
P8 and then fully removed at the user's direction — mentors are human hires, not AI.** This
spec is exclusively the human, externally-hired mentor; no AI, no chat, no LLM provider is
touched here, and the codebase carries no AI/LLM/pgvector code as of this spec (see
ADR-0055). Where `CLAUDE.md §6`'s original P8 line item said "AI mentor," `CLAUDE.md` has
since been corrected to describe this human-mentor track directly — see Part 6 for the
naming reconciliation this creates.

---

## Part 1 — User Stories by Workstream

### WS-1: Mentor records + hiring (CRM/admin)

- As an Admin/Branch Manager, I can record a new mentor candidate (name, contact, external
  institute, expertise/subjects, notes) before they're fully onboarded, and track their
  engagement status through prospective → active → inactive.
- As an Admin/Branch Manager, I can search and filter the mentor directory by name,
  institute, expertise, and engagement status.
- As an Admin/Branch Manager, I can edit a mentor's record and soft-delete one who's no
  longer engaged, with every change captured in the audit log.
- As a Counsellor/Faculty/Finance/Marketing/Support user, I never see or touch mentor
  hiring records — that's not my job.

### WS-2: Assign mentors to batches

- As an Admin/Branch Manager, I can attach one or more mentors to a batch and optionally
  designate one as the lead mentor.
- As an Admin/Branch Manager, I can see at a glance which mentor(s) own which batch, and
  reassign or remove a mentor from a batch as staffing changes.
- As the system, I never let an inactive/prospective mentor be assigned to a live batch,
  and I never let the same mentor be double-assigned to the same batch.

### WS-3: Track internship program to completion (per batch)

- As a Mentor or Admin/Branch Manager, I can see a batch's progress toward finishing the
  program: how many students, their lesson/assignment/assessment/final-project progress,
  and an overall % complete — using the exact same numbers the LMS and CRM already compute,
  never a second, possibly-drifting copy.
- As a Mentor or Admin/Branch Manager, I can mark a batch complete once its program run has
  finished, with the current completion numbers visible to me before I do.

### WS-4: Mentor-facing dashboard

- As a Mentor, when I log into the CRM, I see only the batch(es) I'm assigned to — nothing
  else, ever, even if I guess another batch's ID.
- As a Mentor, I can see my batch's students and what's left for each of them to complete
  the program, and I can mark my batch complete.
- As a Mentor, I cannot manage other mentors, cannot see students or data outside my
  batch(es), cannot grade or author content, and cannot see payment/commerce data — that's
  not my job.

---

## Part 2 — Acceptance Criteria (Given / When / Then)

### WS-1: Mentor records + hiring (CRM/admin)

**AC-1 — HEADLINE: Only a caller with `mentors.create` can create a mentor record**
Given a Counsellor, Faculty, Finance, Marketing, or Support user with no `mentors.create`
permission,
When they call `POST /crm/mentors`,
Then the API returns 403; an Admin/Owner (all-scope) or Branch Manager (branch-scope) with
`mentors.create` succeeds.

**AC-2 — Mentor creation validates required fields**
Given a create request missing `name`, `externalInstitute`, or both `email` and `phone`
(at least one contact method is required),
When `POST /crm/mentors` is called,
Then the API returns 422 with a field-level zod validation error before any row is written.

**AC-3 — `engagement_status = 'active'` requires a joined date**
Given a create or edit request setting `engagementStatus: 'active'` with no `joinedDate`,
When the request is processed,
Then the API returns 422 `JOINED_DATE_REQUIRED`; `prospective`/`inactive` statuses do not
require a joined date.

**AC-4 — Mentor creation is tenant- and branch-scoped**
Given a Branch Manager for Branch B creates a mentor,
When the record is persisted,
Then `tenant_id` is the caller's tenant and `branch_id` is forced to Branch B — the caller
cannot set a `branch_id` outside their own branch (422 or silently forced, but never
another branch's id); an Admin/Owner may set any branch within their tenant.

**AC-5 — Mentor directory list/search is scoped**
Given Branch Manager M (Branch B) and Admin A,
When each calls `GET /crm/mentors`,
Then M sees only mentors with `branch_id = B`; A sees all mentors in the tenant; neither
sees another tenant's mentors.

**AC-6 — Search by name/institute**
Given mentors with varying `name`/`externalInstitute` values,
When `GET /crm/mentors?q=<substring>` is called,
Then only mentors whose name or institute contains the (case-insensitive) substring are
returned.

**AC-7 — Filter by engagement status and/or expertise**
Given mentors across all three engagement statuses and varying expertise tags,
When `GET /crm/mentors?engagementStatus=active&expertise=react` is called,
Then only mentors matching both filters are returned.

**AC-8 — Empty filter result is a valid empty list, not an error**
Given a filter combination matching zero mentors,
When the endpoint is called,
Then the response is 200 with an empty array — never 404 or 500.

**AC-9 — Editing a mentor is a partial update**
Given a mentor record with existing `notes` and `expertise`,
When `PATCH /crm/mentors/:id` is called with only `{ notes: "..." }`,
Then only `notes` changes; `expertise` and every other field are unchanged, requires
`mentors.edit`.

**AC-10 — Setting engagement status to inactive preserves history**
Given a mentor with existing `batch_mentors` rows (past or current assignments),
When their `engagementStatus` is set to `inactive`,
Then no `batch_mentors` row is deleted or altered — assignment history is preserved for
audit and reporting; only new assignment (WS-2) and dashboard access (WS-4) are affected.

**AC-11 — Soft-delete requires `mentors.delete`**
Given a caller without `mentors.delete`,
When `DELETE /crm/mentors/:id` is called,
Then 403; a caller with the permission succeeds, setting `deleted_at` and excluding the row
from default list/search results (per `docs/05 §5`).

**AC-12 — Soft-delete is blocked while the mentor has an active batch assignment**
Given a mentor with ≥1 non-removed `batch_mentors` row,
When `DELETE /crm/mentors/:id` is called,
Then the API returns 409 `MENTOR_HAS_ACTIVE_ASSIGNMENTS` with the list of batches still
assigning them — the caller must remove the mentor from every batch first (WS-2).

**AC-13 — Cross-tenant IDOR on mentor read/edit/delete**
Given Tenant A's mentor and an authenticated Tenant B Admin,
When Tenant B's Admin requests, edits, or deletes Tenant A's mentor by id,
Then the API returns 404 (tenant-scoped lookup, IDOR-safe).

**AC-14 — Every mentor mutation is audit-logged**
Given a create, edit, soft-delete, or restore action on a mentor record,
When the action completes,
Then an `audit_logs` row is written with `actor`, `entity = 'mentor'`, `entity_id`, and a
`before`/`after` diff.

**AC-15 — Non-mentors.* staff roles are fully blocked**
Given a Counsellor, Faculty, Finance, Marketing, or Support user,
When any of them calls any `POST/PATCH/DELETE/GET /crm/mentors*` endpoint,
Then the API returns 403 on every one — none of these roles hold any `mentors.*`
permission by default.

**AC-16 — Mentor directory loading/empty/error states**
Given the mentor directory screen,
Then it shows a loading skeleton while fetching, a clear empty state with a "Add mentor"
CTA when zero mentors exist tenant/branch-wide, and a non-blank error state with retry on a
failed request — never a blank panel.

---

### WS-2: Assign mentors to batches

**AC-17 — HEADLINE: Only a caller with `mentors.assign` can attach/detach/lead-change a batch assignment**
Given a caller without `mentors.assign` (including one who holds `mentors.edit` but not
`mentors.assign` — the two are distinct permissions, see AC-29),
When they call the assign/reassign/remove/lead-designation endpoint,
Then the API returns 403; Admin/Owner (all) and Branch Manager (branch, their branch's
batches only) with `mentors.assign` succeed.

**AC-18 — Assignment requires an active mentor**
Given a mentor with `engagementStatus` of `prospective` or `inactive`,
When `POST /crm/batches/:id/mentors` is called with that mentor's id,
Then the API returns 422 `MENTOR_NOT_ACTIVE` — only `active` mentors can be assigned.

**AC-19 — Duplicate active assignment is rejected**
Given Mentor X is already actively assigned to Batch B,
When the same assignment (Mentor X → Batch B) is attempted again,
Then the API returns 409 `ALREADY_ASSIGNED` (or is a no-op) — no duplicate `batch_mentors`
row is created.

**AC-20 — A batch may have multiple concurrently-assigned mentors**
Given Batch B with Mentor X already assigned,
When Mentor Y (also active) is assigned to Batch B,
Then both X and Y appear in Batch B's mentor list simultaneously — the relationship is
many-to-many, not exclusive.

**AC-21 — At most one lead mentor per batch**
Given Batch B with Mentor X marked as lead,
When Mentor Y is newly marked as lead for Batch B,
Then Mentor X's lead flag is automatically cleared — a batch never has two simultaneous
lead mentors.

**AC-22 — Lead designation is optional**
Given a batch with one or more assigned mentors and none marked as lead,
When the batch's mentor list is viewed,
Then this is a valid state — a lead is not required for a valid assignment.

**AC-23 — Viewing batch-mentor assignments reuses the existing `batches.view` scope**
Given a caller with `batches.view` at their applicable scope (own branch, assigned batch,
or all),
When `GET /crm/batches/:id/mentors` is called,
Then the same scope rules that already govern batch visibility apply — no separate "view"
permission is introduced for reading the assignment list.

**AC-24 — Removing a mentor from a batch is a soft-unassign**
Given Mentor X assigned to Batch B,
When Mentor X is removed from Batch B,
Then the `batch_mentors` row is marked removed (soft, timestamped) — not hard-deleted —
preserving "who ran this batch and when" for audit/history.

**AC-25 — A batch may have zero mentors at any time**
Given Batch B with exactly one assigned mentor,
When that mentor is removed,
Then Batch B is left with zero mentors — this is a valid state (e.g. before staffing, or
between reassignments); no lower-bound-of-one constraint is enforced.

**AC-26 — Assignment is blocked on completed/archived batches**
Given Batch B with `status = 'completed'` or `'archived'`,
When an assign (or lead-designation) call targets Batch B,
Then the API returns 422 `BATCH_NOT_ASSIGNABLE` — mentors may only be (re)assigned while a
batch is `planned` or `active`.

**AC-27 — Cross-tenant IDOR on assignment**
Given Tenant A's mentor and/or Tenant A's batch, and an authenticated Tenant B Admin,
When Tenant B's Admin attempts to assign across the tenant boundary in either direction
(Tenant A mentor → Tenant B batch, or vice versa),
Then the API returns 404 for the out-of-tenant resource — no cross-tenant assignment is
ever created.

**AC-28 — Branch Manager cannot assign outside their own branch**
Given Branch Manager M (Branch B) and a batch in Branch C,
When M attempts to assign a mentor to the Branch C batch,
Then the API returns 404 (IDOR-safe — M cannot distinguish "doesn't exist" from "not my
branch").

**AC-29 — `mentors.assign` is distinct from `mentors.edit`**
Given a caller holding `mentors.edit` but explicitly not `mentors.assign`,
When they attempt to attach/detach a batch assignment,
Then the API returns 403 even though they can freely edit the mentor's hiring-record
fields — staffing decisions are gated separately from profile editing.

**AC-30 — Every assignment mutation is audit-logged**
Given an assign, reassign, remove, or lead-designation action,
When it completes,
Then an `audit_logs` row is written with `entity = 'batch_mentor'`, actor, batch id,
mentor id, and the action taken.

---

### WS-3: Track internship program to completion (per batch)

**AC-31 — HEADLINE: The completion rollup reconciles exactly with existing data — no parallel progress system**
Given a batch B with enrollments, lesson_progress, submissions, attempts, and (where
issued) certificates,
When `GET /crm/batches/:id/completion` is called by an authorized caller,
Then every number in the response is computed by reading `enrollments`, `lesson_progress`,
`submissions`, `attempts`, `assessments`, `assignments`, and `certificates` directly (or via
the existing P4 eligibility engine) — never a second, independently-maintained progress
table or counter that could drift from what the student sees in the LMS or what the CRM
reports elsewhere (`docs/specs/phase-7-analytics-hardening.md` WS-A5).

**AC-32 — Per-student progress % is the exact `enrollments.progress_pct` value**
Given a student's enrollment with `progress_pct = 62`,
When the rollup includes that student,
Then the rollup's per-student progress figure is exactly `62` — the same value the
student's own LMS dashboard shows, not a recomputed or rounded-differently figure.

**AC-33 — Per-student certificate-eligibility reuses the P4 eligibility `reasons` object verbatim**
Given a student's enrollment,
When the rollup computes that student's eligibility status,
Then it calls the same eligibility-evaluation function defined in
`docs/specs/phase-4-learning-depth.md` (completion threshold, required-assessments-passed,
final-project-approved) and surfaces the identical `reasons` shape — not a re-derived or
simplified formula.

**AC-34 — Batch-level headcount buckets reconcile with a direct recomputation**
Given batch B's enrollments,
When the rollup computes headcounts (`totalActive`, `certified`, `eligibleNotIssued`,
`inProgress`, `dropped`),
Then each count equals `COUNT(enrollments) WHERE batch_id = B AND <bucket condition>` —
`certified` = has a `valid` certificate; `dropped` = `enrollments.status = 'dropped'`;
matching a direct recomputation exactly.

**AC-35 — Batch-level "% complete" formula is documented and reconciles**
Given batch B's active (non-dropped) enrollments,
When the rollup computes `percentComplete`,
Then it equals the average of `progress_pct` across those active enrollments (dropped
enrollments excluded from the average, but counted separately in the `dropped` bucket) —
this formula is the single source of truth for "% complete" across CRM and mentor
dashboards; both surfaces reference the identical computed value for the same batch.

**AC-36 — Empty batch rollup is a valid zero result**
Given batch B with zero enrollments,
When the rollup is requested,
Then the response is 200 with `totalActive: 0`, all buckets `0`, and `percentComplete: 0`
(or `null`, documented explicitly) — never a 404 or 500.

**AC-37 — Rollup is scope-resolved per caller**
Given Mentor Mn assigned to Batch B (via `batch_mentors`), Branch Manager for Batch B's
branch, and Admin/Owner,
When each requests `GET /crm/batches/:id/completion` for Batch B,
Then all three succeed; a Mentor requesting a batch they are not assigned to (per LOCK-2's
resolution chain) receives 404; a Branch Manager requesting another branch's batch receives
404.

**AC-38 — Mark-complete requires `batches.markComplete`**
Given a caller without `batches.markComplete` at the applicable scope,
When `POST /crm/batches/:id/complete` is called,
Then the API returns 403; Admin/Owner (all), Branch Manager (their branch), and any
**actively-assigned** Mentor for that batch (lead or non-lead — every assigned mentor
holds this right, not only the lead) succeed.

**AC-39 — Batch completion is a valid transition only from `active`**
Given Batch B with `status = 'planned'`,
When `POST /crm/batches/:id/complete` is called,
Then the API returns 422 `BATCH_NOT_ACTIVE`; given `status = 'active'`, the same call
succeeds; given `status = 'completed'` or `'archived'`, it returns 409
`ALREADY_COMPLETED` — the second call is a no-op, not a duplicate mutation (idempotent).

**AC-40 — Marking complete sets status and a new `completed_at` timestamp**
Given a successful mark-complete call on an `active` batch,
When the transition completes,
Then `batches.status` becomes `'completed'` and `batches.completed_at` is set to the
transition time (a new column — see Part 7); once set, this endpoint never overwrites
`completed_at` again (AC-39's idempotency guard prevents a second successful call).

**AC-41 — Completion does not require 100% student completion**
Given Batch B's rollup shows fewer than 100% of active students in the `certified` or
`eligibleNotIssued` bucket,
When an authorized caller marks Batch B complete,
Then the transition still succeeds — completion is an operational "this program run has
ended" milestone, not a gate on individual student outcomes; the current rollup numbers
(AC-31–35) are included in the mark-complete response so the action is taken with full
visibility, but they never block it.

**AC-42 — Marking complete never mutates enrollment/progress/grading/certificate data**
Given a successful mark-complete call,
When the underlying data is inspected afterward,
Then no `enrollments`, `lesson_progress`, `submissions`, `attempts`, or `certificates` row
is altered — the action is a pure `batches.status`/`completed_at` write plus an
`audit_logs` entry; the rollup it displayed remains a read, not a write, of that data.

**AC-43 — Mark-complete is audit-logged**
Given a successful mark-complete call,
When it completes,
Then an `audit_logs` row is written with `entity = 'batch'`, `action = 'complete'`, actor,
and the before/after `status`/`completed_at` values.

**AC-44 — Cross-tenant/branch IDOR on mark-complete**
Given Tenant A's batch and a Tenant B Admin, or a Branch Manager targeting another branch's
batch,
When mark-complete is attempted,
Then the API returns 404 in both cases (mirrors AC-37's read scoping).

**AC-45 — Unassigned Mentor cannot mark a batch complete**
Given Mentor Mn who is NOT assigned to Batch B,
When Mn calls `POST /crm/batches/:id/complete` for Batch B,
Then the API returns 404 (fail-closed, consistent with ADR-0031's ADR-0022 IDOR pattern —
Mn cannot distinguish "batch doesn't exist" from "batch exists but isn't mine").

---

### WS-4: Mentor-facing dashboard

**AC-46 — HEADLINE: A mentor sees only their actively-assigned batch(es); everything else is 404**
Given Mentor Mn actively assigned to Batch B only,
When Mn calls `GET /me/mentor/dashboard` (summary) or requests Batch B by id,
Then only Batch B appears in the summary; when Mn requests any other batch's detail or
completion rollup by id (a batch they are not assigned to), the API returns 404 — never a
403 that would confirm the batch's existence, never a partial or empty-but-200 object that
leaks the batch's existence.

**AC-47 — Cross-tenant isolation on the mentor dashboard**
Given Mentor Mn (Tenant A) and a Batch existing in Tenant B,
When Mn requests that Tenant B batch by a guessed/enumerated id,
Then the API returns 404 — Tenant B's batch is never reachable through Mn's session, tokens,
or any endpoint, regardless of ID guessing.

**AC-48 — Cross-mentor isolation**
Given Mentor X assigned only to Batch B and Mentor Y assigned only to Batch C,
When X requests Batch C (or Y requests Batch B),
Then each gets 404 for the batch they are not assigned to; if both X and Y are assigned to
the same Batch D, both see Batch D (each still scoped only to Batch D, not to each other's
other batches).

**AC-49 — `mentor.dashboard.view` is re-evaluated per request, not cached at login**
Given Mentor Mn with `engagementStatus = 'active'` and a valid session,
When Mn's `engagementStatus` is subsequently set to `inactive` by an Admin,
Then Mn's very next dashboard request (even with the still-valid token) returns 403 —
access is fail-closed and re-checked live, never cached from login time (mirrors the
`facultyProfile` null-check pattern in ADR-0031).

**AC-50 — Dashboard summary reuses the same rollup, not a duplicate computation**
Given Mentor Mn's assigned batch(es),
When `GET /me/mentor/dashboard` is called,
Then each listed batch shows program/batch name, student headcount, `percentComplete`
(the exact AC-35 formula/value), and `status` — sourced from the identical rollup function
CRM staff use for the same batch, not a separately-maintained mentor-only calculation.

**AC-51 — Empty state for a mentor with zero active assignments**
Given a Mentor with `engagementStatus = 'active'` but zero rows in `batch_mentors`,
When they load their dashboard,
Then they see a clear "no batches assigned yet" empty state — not an error, not a blank
screen.

**AC-52 — Batch detail matches the CRM staff view exactly**
Given Mentor Mn's assigned Batch B,
When Mn requests Batch B's detail/roster/completion rollup,
Then the response shape and values are identical to what an authorized CRM staff member
sees for the same batch (AC-31–35) — the mentor surface is a scoped view of the same data,
not a parallel/lite version with different numbers.

**AC-53 — Mentor can mark their own batch complete**
Given Mentor Mn assigned to Batch B (`status = 'active'`),
When Mn calls the mark-complete action from the dashboard,
Then it succeeds exactly as in AC-38/39/40 — the dashboard reuses the same endpoint and
permission (`batches.markComplete`), not a separate mentor-only completion mechanism.

**AC-54 — Mentor cannot manage other mentor records**
Given Mentor Mn,
When Mn calls any `POST/PATCH/DELETE /crm/mentors*` or assignment endpoint,
Then the API returns 403 — `mentors.create`/`mentors.edit`/`mentors.delete`/`mentors.assign`
are never granted to the Mentor role, and the mentor-facing UI never renders these actions.

**AC-55 — Mentor cannot browse the global student directory or students outside their batch**
Given Mentor Mn assigned only to Batch B, and Student S enrolled only in Batch C,
When Mn calls `GET /crm/students` (directory) or `GET /crm/students/:id` for Student S,
Then the directory call returns 403 (no `students.view` grant beyond their own batch
roster) and the direct lookup for Student S returns 404.

**AC-56 — Mentor cannot view payments/invoices/commerce/KYC data**
Given Mentor Mn,
When Mn calls any `payments.*`/`invoices.*`/commerce endpoint, or requests a student's KYC
documents,
Then the API returns 403 — the Mentor role holds no commerce/finance permission at any
scope.

**AC-57 — Mentor cannot grade or issue/recommend certificates**
Given Mentor Mn,
When Mn calls `PATCH /submissions/:id/grade`, `PATCH /attempts/:id/grade`, or
`POST /certificates/:enrollmentId/recommend` (or `.../issue`),
Then the API returns 403 — the Mentor role holds none of `submissions.grade`,
`attempts.grade`, `certificates.recommend`, `certificates.issue`; grading and certificate
recommendation remain exclusively Faculty/Admin actions (P4, unchanged by this spec).

**AC-58 — Mentor cannot author or edit program content**
Given Mentor Mn,
When Mn calls any create/edit endpoint under `programs`, `modules`, `lessons`,
`assignments`, or `assessments`,
Then the API returns 403 — the Mentor role holds no create/edit permission on any
content-authoring module; a mentor leads a batch, they do not author the curriculum.

**AC-59 — Mentor's own hiring-record fields are read-only to the mentor**
Given Mentor Mn viewing their own profile on the dashboard,
When Mn attempts to `PATCH` their own `mentors` row (e.g. change `engagementStatus` or
`externalInstitute`),
Then the API returns 403 — only staff with `mentors.edit` can change hiring-record fields;
Mn can view (not edit) their own record via `mentor.dashboard.view`'s own-scope read.

**AC-60 — Dashboard loading/empty/error states match the platform-wide pattern**
Given the mentor dashboard,
Then it shows a loading skeleton while fetching, the explicit empty state from AC-51 when
applicable, and a non-blank error state with a retry affordance on a failed request —
consistent with `@repo/ui` primitives used elsewhere in the CRM.

**AC-61 — Server-side enforcement is independent of the UI (defense-in-depth)**
Given the mentor-facing UI only renders assigned batches and permitted actions,
When a direct API call bypasses the UI entirely (e.g. via a raw HTTP client with a valid
mentor token) and targets an unassigned batch or a forbidden action,
Then every AC in this workstream (46–59) still holds — the UI's hiding of forbidden/
out-of-scope items is a UX convenience, not the security control (`CLAUDE.md §3.5`).

---

## Part 3 — Testable Rules

**Rule M-1 (mentor assigned-scope resolution is many-to-many, fail-closed):**
Mentor `assigned` scope resolves via `enrollment.batch_id → batch_mentors WHERE mentor_id =
current_user.mentorProfile.id AND removed_at IS NULL` (or equivalent active-row predicate),
not via a single FK. A Mentor-role user with no `mentorProfile`, or with no matching active
`batch_mentors` row for the requested batch, is rejected (404) rather than falling through
to a broader result set. Verified by AC-37, AC-45, AC-46–48.

**Rule M-2 (mark-complete is informational, never gated by completion numbers):**
The rollup's headcount/percentComplete values are always computed and always returned in
the mark-complete response, but never block the transition. Verified by AC-41.

**Rule M-3 (Mentor role's permission grant is a strict, named allowlist):**
The Mentor role holds exactly: `batches.view` (assigned, via Rule M-1), `batches.markComplete`
(assigned), `mentor.dashboard.view` (own). It holds **none** of: `mentors.*` (any),
`students.view` (directory), `payments.*`, `invoices.*`, `submissions.grade`,
`attempts.grade`, `certificates.*`, `programs.*`/`modules.*`/`lessons.*`/`assignments.*`/
`assessments.*` (create/edit). Verified by AC-54–58.

**Rule M-4 (dashboard access is re-checked live, never cached):**
`mentor.dashboard.view`'s own-scope predicate re-reads `mentors.engagement_status` on every
request; a session/token remaining valid does not imply continued dashboard access once
`engagement_status` leaves `active`. Verified by AC-49.

**Rule M-5 (assignment removal is a soft-unassign, preserving history):**
Removing a mentor from a batch never hard-deletes the `batch_mentors` row — it is
timestamp-marked removed, so "who ran this batch and when" survives for audit/reporting.
Verified by AC-24.

---

## Part 4 — Edge Cases and Error States

### WS-1: Mentor records + hiring

| Scenario | Expected behavior |
|----------|-------------------|
| Two staff create a mentor with the same email concurrently | Standard uniqueness handling on `users.email` (existing platform behavior) applies — the second request fails with a clear conflict, not a duplicate account |
| A mentor's `expertise` list is empty at creation | Allowed — expertise is a helpful filter/search aid, not a required gate |
| Restoring a soft-deleted mentor whose linked `user` was also deactivated | Restoring the `mentors` row does not silently reactivate a deactivated `users` row — that remains a separate, explicit staff action (existing user-management behavior, unchanged) |
| Search query is empty/whitespace | Returns the full (scoped, paginated) list — treated the same as no filter, not an error |
| Branch Manager attempts to view a mentor from another branch by id | 404 (IDOR-safe), consistent with AC-13's tenant pattern applied at branch scope |

### WS-2: Assign mentors to batches

| Scenario | Expected behavior |
|----------|-------------------|
| Assign call targets a mentor id that doesn't exist (typo/deleted) | 404, not 422 — distinguishes "bad reference" from "validation failure" |
| Removing the lead mentor from a batch (leaving other, non-lead mentors) | Batch is left with no lead mentor — valid state (AC-22); no automatic promotion of another mentor to lead |
| A mentor is removed from a batch, then re-assigned later | Creates a new active `batch_mentors` row; the old removed row remains as history (Rule M-5) — no reuse/resurrection of the old row |
| A batch moves from `planned` to `active` while mentors are already assigned | No effect on existing assignments — assignment is independent of the batch's own lifecycle transitions (only the assignment *action* is blocked on `completed`/`archived`, per AC-26) |
| Two staff assign the same mentor to the same batch at the same instant (race) | Idempotent outcome — exactly one active `batch_mentors` row exists afterward (AC-19), no duplicate |

### WS-3: Track internship program to completion

| Scenario | Expected behavior |
|----------|-------------------|
| A student drops mid-program (`enrollments.status = 'dropped'`) after the batch is already marked complete | No retroactive change — the rollup at the time of completion is not re-computed or altered; the `dropped` bucket simply reflects current data on any subsequent read (rollup is always a live read, not a frozen snapshot) |
| Rollup requested for a batch with 500+ enrolled students | Server-side pagination/bucketing applies to any per-student breakdown list (never an unbounded array in one response), consistent with `docs/specs/phase-7-analytics-hardening.md`'s dashboard pagination pattern |
| Two mark-complete calls arrive milliseconds apart from two different assigned mentors on the same batch | Idempotent — the first succeeds, the second returns 409 `ALREADY_COMPLETED` (AC-39), no double audit-log write for the same transition, no error surfaced to either caller beyond the documented 409 |
| Admin marks a batch complete, then later needs to reopen it (e.g. mistaken completion) | **Out of scope for this spec** — reopening/un-completing a batch is existing `batches.edit` territory (if/when that transition is supported at all); this spec only adds the forward `active → completed` transition |

### WS-4: Mentor-facing dashboard

| Scenario | Expected behavior |
|----------|-------------------|
| A Mentor is assigned to a batch, then later removed while they have the dashboard open (stale client state) | Their next request for that batch (refresh, or the next poll) returns 404 — the removal takes effect on the next server read, not retroactively on an already-rendered page |
| A Mentor account exists but has never been assigned to any batch | `mentor.dashboard.view` still succeeds (the account/role is valid) — they simply see the AC-51 empty state, not a 403 |
| A Mentor is assigned to a batch in a different branch than where they were originally hired (`mentors.branch_id`) | Allowed — assignment scope (Rule M-1) is via `batch_mentors`, independent of the mentor's own `branch_id` (which only drives Branch Manager's *hiring-record* management scope, WS-1) |
| A deactivated (`inactive`) mentor's browser session is still open | Session token itself is not force-revoked by this spec (session revocation on role/engagement change is existing platform session-management behavior, not duplicated here) — but every dashboard **request** with that token is rejected per AC-49/Rule M-4, so no data is served regardless of token validity |

---

## Part 5 — Scope Boundary (In vs. Out)

### In Scope (this spec)

| Workstream | What ships |
|-----------|------------|
| WS-1 Mentor records + hiring | `mentors` entity CRUD (create/edit/soft-delete/restore), search/filter/list, tenant+branch scoped, `mentors.*` RBAC, audit logging, loading/empty/error states |
| WS-2 Assign mentors to batches | `batch_mentors` many-to-many assignment, optional single lead-mentor designation, reassign/remove, `mentors.assign` RBAC, active-mentor-only + no-duplicate + batch-status guards |
| WS-3 Track program to completion | Read-only completion rollup (per-student + batch-level, reusing existing enrollment/progress/assessment/certificate data verbatim), `active → completed` batch transition (+ new `completed_at`), `batches.markComplete` RBAC |
| WS-4 Mentor-facing dashboard | Role-aware, scoped CRM dashboard view for the Mentor role (`mentor.dashboard.view`), reusing WS-3's rollup/mark-complete endpoints, full cross-batch/cross-mentor/cross-tenant isolation, explicit capability boundary (view + mark-complete only) |

### Explicitly Out of Scope (with justification)

| Item | Why it's out | Notes |
|------|---------------|-------|
| **AI Mentor (student-facing LLM chatbot)** | Explored earlier in P8, then fully removed at the user's direction | See ADR-0055 — the codebase was rewound to the pre-AI baseline; no AI/LLM/pgvector code remains; this spec is exclusively the human mentor |
| Mentor payroll / payments / compensation | Not requested; "payouts (future)" is already named as future scope for Faculty in `docs/03 §7.3` and applies equally here | Future item — needs its own spec (rate cards, invoicing, tax) |
| Mentor performance analytics (ratings, completion-rate leaderboards across mentors, SLA scoring) | Distinct from this spec's operational tracking (WS-3 tracks a *batch's* progress, not a *mentor's* performance) | Natural extension of `docs/specs/phase-7-analytics-hardening.md`'s dashboard family in a future phase, not this spec |
| Mentor-student direct messaging / chat | Not requested; the existing per-batch discussion forum (`docs/02 §7.14`) already covers mentor↔student Q&A | No new messaging surface is introduced |
| Mentors creating/editing program content (`programs`/`modules`/`lessons`/`assignments`/`assessments`) | Explicitly named as out by the requester — content authoring remains Faculty's domain (P4, unchanged) | Enforced by RBAC (Rule M-3, AC-58), not just documentation |
| Mentors grading submissions/attempts or recommending/issuing certificates | Grading and certificate recommendation are Faculty/Admin actions (P4); a mentor "leads a batch to completion" operationally, they don't grade | Enforced by RBAC (Rule M-3, AC-57) |
| LMS student-facing mentor identity/profile ("meet your mentor" card) | Not requested; this spec is CRM-side (mentor management + mentor dashboard) only | Natural future extension of `docs/01-prd-website.md §6`'s public "mentor cards" pattern into the LMS, not this spec |
| Un-completing / reopening a batch (`completed → active` reverse transition) | Not requested; only the forward transition is speced | If needed later, it's `batches.edit` territory, not a mentor-specific action |
| Mentor self-service onboarding / invite flow (mentor sets their own password via emailed link) | Not requested; mentor accounts are provisioned the same way any other staff account is today (existing platform behavior, unchanged) | No new onboarding UX is speced here |
| Faculty role changes of any kind | Faculty's permissions, scope, and grading/authoring workflow are completely unchanged by this spec | See Part 6 for the naming-only overlap this creates |
| Multi-tenant SaaS onboarding, recruiter/college/parent portals | `CLAUDE.md §6` P8 items unrelated to mentors | Untouched |

---

## Part 6 — Conflict Log (naming collision)

| Conflict ID | Reference | What it says | Resolution in this spec |
|-------------|-----------|---------------|--------------------------|
| CONFLICT-P8-MENTOR-1 | `docs/03-prd-crm.md §9` role list: "Faculty/Mentor"; `docs/02-prd-lms.md §9` table header "Mentor/Faculty*" | Both PRDs use "Faculty/Mentor" or "Mentor/Faculty" as an informal, *combined* label for the existing content-authoring/grading role — predating this spec's distinction | This spec introduces a **new, separate** system role with the key `mentor`, wholly distinct from Faculty. The pre-existing PRD label is a naming artifact, not a requirement that Faculty and Mentor be the same role. **Recommended docs-writer follow-up (not blocking):** update `docs/03 §9` and `docs/02 §9` to say plain "Faculty" for the existing role, so future readers don't conflate it with this spec's `mentor` role |
| CONFLICT-P8-MENTOR-2 | `CLAUDE.md §6` P8 line (original wording): "AI mentor, placement/recruiter/college/parent portals, multi-tenant SaaS" | Named "AI mentor" as a P8 item; did not separately name a *human* mentor feature | This spec is the human-mentor track. The AI-mentor chatbot track that line originally referred to was explored and then fully removed at the user's direction (see ADR-0055) — `CLAUDE.md §6` has since been corrected to name this human-mentor track directly. See LOCK-6 |

---

## Part 7 — Data and Permissions Impact

### Entities named (schema design deferred to `db-architect`)

| Entity | Nature | Notes |
|--------|--------|-------|
| `mentors` | **New table.** 1:1 extension of `users` (mirrors `faculty_profiles` — `user_id` FK, not nullable) | Fields per WS-1: `tenant_id`, `user_id`, `branch_id` (nullable FK→branches, drives Branch Manager hiring-record scope), `name`, `email`/`phone` (or reuse `users.email`/`phone` — `db-architect` decides), `external_institute`, `expertise` (json/string[], mirrors `faculty_profiles.expertise`), `engagement_status` (enum `prospective\|active\|inactive`), `joined_date` (nullable), `notes`. Standard `docs/05 §1` conventions (`id`, `created_at`, `updated_at`, `deleted_at`) apply |
| `batch_mentors` | **New join table.** Many-to-many `batches` × `mentors` | Fields: `tenant_id`, `batch_id`, `mentor_id`, `is_lead` (bool, default false), plus standard conventions; a soft "removed" marker (e.g. `deleted_at` reused, or a dedicated `removed_at`) satisfies Rule M-5's soft-unassign requirement; a partial-unique constraint on `(batch_id, mentor_id) WHERE <active>` prevents AC-19's duplicate-assignment case |
| `batches.completed_at` | **New nullable column** on the existing `batches` table | Set only by the `active → completed` transition (AC-40); `batches.status` already supports the `completed` enum value (`docs/05 §3`, `BatchStatus = planned\|active\|completed\|archived`) — only the timestamp column is new |
| `roles` seed row | New: `key = 'mentor'`, `name = 'Mentor'`, `is_system = true` | Seeded per-tenant alongside the existing default roles (`docs/03 §9`) |
| `permissions` seed rows | New: `mentors.view`, `mentors.create`, `mentors.edit`, `mentors.delete`, `mentors.assign`, `mentor.dashboard.view`, `batches.markComplete` | Follows the existing `module.action` key convention (`docs/05 §3`) |
| `role_permissions` grants | New rows per the RBAC table below | Including extending the Mentor role's grant of the **existing** `batches.view` permission at `assigned` scope (Rule M-1's resolution), plus (per the phase-7 gap this spec surfaces) mirroring the existing "Faculty / Mentor" combined grants in `docs/specs/phase-7-analytics-hardening.md` Part 8 (`reports.attendance.view`, `reports.engagement.view` at `assigned` scope) onto the new Mentor role explicitly — those were previously only literally granted to the Faculty role key |
| `audit_logs` entity values | New: `entity = 'mentor'`, `entity = 'batch_mentor'`; existing `entity = 'batch'` gains `action = 'complete'` | No schema change — `audit_logs` is schema-flexible per `docs/05 §3` |

### RBAC Permissions

| Permission | Student | Faculty | **Mentor** | Branch Mgr | Counsellor | Finance | Marketing | Support | Admin/Owner |
|------------|:-------:|:-------:|:----------:|:----------:|:----------:|:-------:|:---------:|:-------:|:-----------:|
| `mentors.view` | – | – | – | branch | – | – | – | – | all |
| `mentors.create` | – | – | – | branch | – | – | – | – | all |
| `mentors.edit` | – | – | – | branch | – | – | – | – | all |
| `mentors.delete` | – | – | – | branch | – | – | – | – | all |
| `mentors.assign` | – | – | – | branch | – | – | – | – | all |
| `mentor.dashboard.view` | – | – | own | – | – | – | – | – | – *(not needed — Admin/BranchMgr already reach the same data via `batches.view`)* |
| `batches.view` *(existing permission, new scope resolver for Mentor)* | – | assigned *(via `batches.faculty_id`)* | **assigned** *(via `batch_mentors`, Rule M-1)* | branch | view | – | – | – | all |
| `batches.markComplete` *(new)* | – | – | assigned | branch | – | – | – | – | all |

Data scope semantics (unchanged from P0–P7, `docs/specs/phase-7-analytics-hardening.md` Part 8):
- `own` = resource tied to `currentUser.id` (here: a mentor reading their own `mentors`
  row); IDOR→403/404 for any other user's row.
- `assigned` = for Mentor, resolved via the `batch_mentors` join (Rule M-1) rather than a
  single FK — IDOR→404 for an unassigned batch.
- `branch` = `branch_id` matches the Branch Manager's assigned branch; IDOR→404 for a
  different branch.
- `all` = tenant-wide, still tenant-scoped; IDOR→404 across tenants.

---

## Part 8 — Dependencies (Agents and Modules)

| Dependency | Source | Consumed by |
|------------|--------|-------------|
| `faculty_profiles` 1:1-user-extension pattern | P1 (`docs/plans/phase-1.md`) | WS-1 `mentors` table design (LOCK-1) |
| `batches` / `enrollments` (`BatchStatus`, `EnrollmentStatus`) | P1 core | WS-2 assignment guards, WS-3 rollup |
| ADR-0009 (`ScopeInterceptor`, fail-closed guards) | P0/P1 | All RBAC/scope ACs |
| ADR-0031 (faculty assigned-scope resolution chain) | P4 | WS-2/WS-3/WS-4 Mentor assigned-scope resolution (Rule M-1 is its M:N analogue) |
| ADR-0022 (IDOR→404, preview bypass pattern) | P3/P4 | All cross-tenant/branch/assigned IDOR ACs |
| P4 certificate-eligibility engine (`docs/specs/phase-4-learning-depth.md`, `is_required`/`is_final` flags) | P4 | WS-3 rollup (AC-33), reused verbatim per LOCK-4 |
| `lesson_progress`, `submissions`, `attempts`, `certificates` | P3/P4 | WS-3 rollup source data |
| `audit_logs` + soft-delete Prisma extensions | P0 | WS-1/WS-2/WS-3 audit ACs |
| `@RequirePermission` + `PermissionsGuard` | P0/P1 | All permission-gated ACs |
| `docs/03 §13` role-aware dashboard layout pattern | P1 CRM | WS-4 mentor dashboard route placement (LOCK-3) |
| `@repo/ui` DataTable, EmptyState, Skeleton, status chips | design-system (existing) | WS-1 directory UI, WS-4 dashboard UI — no new primitives required |
| `@repo/types` zod DTOs | api-designer | All new mentor/assignment/rollup/complete DTOs |
| `@repo/api-client` SDK (regenerated) | api-designer | CRM mentor directory + mentor dashboard screens |
| `docs/specs/phase-7-analytics-hardening.md` Part 8 RBAC table (`reports.attendance.view`/`reports.engagement.view` "Faculty / Mentor" grants) | P7 | Cross-check/extension noted in Part 7 — those grants need to also name the new `mentor` role key explicitly |
| ADR-0055 (AI-mentor exploration + removal record) | P8 | Explicitly NOT a dependency — named only to record why an earlier AI-mentor chatbot track is not part of this spec (LOCK-6, CONFLICT-P8-MENTOR-2) |

---

*Spec authored by `product-manager` for Phase 8 (Human Mentor track), Task #0. Effective
date: 2026-07-08.*
