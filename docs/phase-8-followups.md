# Phase-8 follow-ups (Mentor track — carried into future work)

Recorded at Phase-8 human-Mentor closeout (mentor records/hiring, mentor↔batch assignment,
internship completion tracking + mark-complete, mentor dashboard — `docs/specs/
phase-8-mentor.md`) so nothing found during the security review or left stubbed during the
build gets lost. None of these blocked the Phase-8 GO decision; they are tracked here for
prioritization, not as open incidents.

**Feature shipped:** human Mentor — mentor records/hiring, mentor↔batch assignment,
internship completion tracking + mark-complete, mentor dashboard. Reuses
`batches`/`programs`/`enrollments`/the P4 eligibility + certificate engine verbatim — no
parallel progress system. New tables `mentors`, `batch_mentors` (partial-unique
`(batch_id, mentor_id) WHERE deleted_at IS NULL`), plus `Batch.completed_at` /
`Batch.completed_by_user_id`. Migrations `20260708080000_mentors_core`,
`20260708080100_mentors_partial_indexes`. New `mentor` Role; permissions
`mentors.view`/`create`/`edit`/`delete`/`assign`, `mentor.dashboard.view`,
`batches.markComplete`; the `mentor` role holds `batches.view` + `batches.markComplete` +
`reports.attendance.view` + `reports.engagement.view`, all at `assigned` scope. A new
permission-catalog regression spec (`mentors.permission-catalog.spec.ts`) guards the P6
`forum.read` bug class (an unseeded `@RequirePermission` string) for the mentor module too.

Test counts at Phase-8 closeout: **1453 api unit tests / 96 suites** (green); mentor
integration spec **31/31** green; `turbo run typecheck lint build` **23/23** green.

---

## Security review verdict

**GO.** All findings from the review were remediated **in-wave** — none are carried as open
Critical/High items. The headline invariants (mentor-dashboard assigned-scope IDOR
fail-closed, cross-tenant isolation, RBAC-catalog completeness, mark-complete authz, PII
audit-masking) were verified correct.

| ID | Title | Status |
|----|-------|--------|
| F2 | **Mark-complete concurrency race** | **FIXED this wave** — the `active → completed` transition now runs inside a Prisma transaction with a row-level `SELECT ... FOR UPDATE` compare-and-set (`BatchCompletionRepository.markComplete`): the lock serializes concurrent callers, and only the caller that observes `status='active'` under the lock performs the single `update` (which the audit Prisma extension still captures). A losing concurrent caller gets `0` affected rows and the same `409 ALREADY_COMPLETED` as the ordinary idempotency check — no double write, no duplicate audit row. See ADR-0054. |
| F5 | **Mentor dashboard 500'd when an assigned batch was soft-deleted** | **FIXED this wave** — the soft-delete Prisma extension does not filter nested `include`s, so a soft-deleted batch with a still-active `batch_mentors` row was flowing into `listActiveAssignedBatches` and then 500'ing when the per-batch summary re-queried the batch top-level (`deletedAt: null` → not found → unhandled). Fixed with an explicit relation filter, `batch: { deletedAt: null }`, in `MentorsRepository.listActiveAssignedBatches`. |
| F3 | **`includeDeleted` mentor-list param was not scope-gated** | **FIXED this wave** — `GET /crm/mentors?includeDeleted=true` is now honored only for an `all`-scope caller (Admin/Owner); a `branch`-scoped `mentors.view` holder is forced to active rows regardless of the query param, closing a path where a Branch Manager could otherwise read soft-deleted mentor rows outside the intended "active directory" view. |

**Confirmed-GOOD controls (this wave's evidence):**

- Mentor-dashboard assigned-scope resolution (`enrollment.batch_id → batch_mentors WHERE
  mentor_id = ... AND deleted_at IS NULL`, Rule M-1) fails closed to an empty result set —
  never "all" — for a `mentor`-role user with no linked `mentors` row or no active
  assignment; cross-batch/cross-mentor/cross-tenant reads all return 404, never a 403 that
  would confirm a batch's existence (AC-46–48).
- `mentor.dashboard.view` is re-evaluated live on every request, not cached at login — an
  `engagementStatus` flip to `inactive` takes effect on the mentor's very next request even
  with a still-valid token (AC-49, Rule M-4).
- `mentors.assign` and `mentors.edit` are independently enforced permissions (AC-29); the
  Mentor role holds neither, nor any `students.view`/`payments.*`/`invoices.*`/
  `submissions.grade`/`attempts.grade`/`certificates.*`/content-authoring permission (Rule
  M-3, AC-54–58) — confirmed by direct raw-HTTP-client bypass attempts, not just UI hiding
  (AC-61).
- Every mentor/assignment/mark-complete mutation is audit-logged (`entity = 'mentor'`,
  `'batch_mentor'`, `'batch'`+`action='complete'`) with PII (`email`/`phone`) subject to the
  same write-time masking registry as every other audited PII field (ADR-0049) — no raw
  PII leak in an audit snapshot.
- Cross-tenant/cross-branch IDOR on mentor CRUD, batch-mentor assignment, and mark-complete
  all return 404, never 403 or a scoped-but-200 leak (AC-13, AC-27, AC-28, AC-44, AC-45).
- The `batch_mentors_active_batch_mentor_key` partial-unique index is a real DB-level
  backstop for AC-19's duplicate-assignment case, not just a service-layer check — verified
  under a concurrent-assign race (Part 4 edge case), caught as a clean `409 ALREADY_ASSIGNED`
  via `P2002`, never a 500.

---

## Open follow-ups (tracked, non-blocking)

| ID | Title | Notes |
|----|-------|-------|
| F1 / DEFECT-P8-01 | **`mentors` has no `branch_id` — Branch Manager `mentors.*` grant is effectively tenant-wide** | By design (ADR-0053): mentors are modeled as org-shared external hires, not branch-owned staff, so there is no branch column for a `branch`-scoped grant to filter on in practice. **ACCEPTED as design**, not a bug to silently fix — but it means any Branch Manager with `mentors.view`/`edit`/`delete`/`assign` can see and act on every mentor in the tenant, including business-contact PII (email/institute) for mentors hired by/assigned to other branches. A `mentors.branch_id` migration is the documented future option if per-branch mentor ownership is ever needed. **Flagged for product sign-off.** |
| F4 | **Co-mentor business-contact PII visible to a peer mentor on a shared batch** | `GET /crm/batches/:id/mentors` (reused via `batches.view` at `assigned` scope, AC-23) returns every assigned mentor's `email` and `externalInstitute`, not just the caller's own. A Mentor who shares a batch with another mentor therefore sees that co-mentor's business-contact PII. This may be intended (mentors on the same batch coordinating) or may need a mentor-scoped projection that omits peer contact details. **Confirm product intent**; if PII-minimization is required, add a projection variant of the assignment-list DTO for `mentor`-role callers (mirrors the gamification leaderboard's PII-minimal precedent, ADR-0044). |
| F6 | **Add `tenant_id` to the remaining bare-`{id}` mutation where-clauses as defense-in-depth** | `markComplete`'s `FOR UPDATE` predicate already includes `tenant_id` (ADR-0054). A few other mentor-module single-row mutations (e.g. mentor edit/soft-delete-by-id, assignment update-by-id) rely on the caller having already passed a tenant-scoped read earlier in the same request rather than re-asserting `tenant_id` in the mutation's own `WHERE` clause. Not a demonstrated vulnerability (the prior read is itself tenant-scoped and IDOR-safe), but adding the redundant `tenant_id` predicate to every mutation is cheap, consistent defense-in-depth. |
| F7 | **Dashboard rollup availability depends on `mentor.dashboard.view` staying seeded at `assigned` scope** | The mentor dashboard's entire access model rests on this one seeded grant. Keep the permission-catalog regression spec (extended this wave to cover the mentor module) as the standing guard against this permission ever silently going unseeded or being re-seeded at the wrong scope — the exact bug class that produced the P7 `forum.read`/`notification_prefs.edit` CRITICALs. |
| M-1 | **400-vs-422 zod convention** | Documented, existing codebase convention (validation-shape errors are 422 via `ZodValidationPipe`; malformed-request-shape errors are 400) — applies unchanged to all new mentor DTOs. Not a defect. |
| M-2 | **PascalCase audit entity/action naming** | `audit_logs.entity` values (`'Mentor'`, `'BatchMentor'`) follow the existing PascalCase-per-Prisma-model-name convention (matches `'ExportJob'`, `'ReportSchedule'`, etc. from P7), not the lowercase/snake style used in some spec prose (`entity = 'mentor'`). Documented codebase convention, not a defect — the spec's lowercase wording is descriptive, not a literal required string.

---

## AI-mentor exploration + removal record

Earlier in Phase 8, before the human-mentor spec existed, an **AI-mentor chatbot**
(student-facing LLM doubt-solving assistant, backed by `@anthropic-ai/sdk` + a
pgvector-based retrieval data model) was explored and partially built. The user directed
that this track be **fully removed** — a "mentor" in this platform is a real, human,
externally-hired subject-matter expert, not a chatbot (see ADR-0055 for the full record and
rationale).

What was removed:
- `@anthropic-ai/sdk` uninstalled from `apps/api` (confirmed absent from
  `apps/api/package.json`).
- The `AiContentChunk` model (and any other AI/LLM-specific schema objects) dropped from
  `prisma/schema.prisma` — confirmed absent from the live schema.
- Two uncommitted migrations toward the `ai_content_chunks`/`vector`/HNSW-index data model
  were discarded, never shipped.
- `docs/specs/phase-8-ai-mentor.md` deleted.
- The codebase was rewound to its pre-AI-exploration baseline before
  `docs/specs/phase-8-mentor.md` (the human-mentor spec) was written and built.

**One unrelated real bug fix was deliberately kept**, not reverted along with the rest:
`packages/api-client/src/engagement/notifications.api.ts`'s `list()` method was
double-prefixing its query string (`toQueryString()` already returns a leading `?`, but the
call site wrapped it again as `` `?${qs}` ``, producing `??unread=true` and silently
dropping the `unread` filter — the P6 SSE-polling-fallback's unread filter never actually
filtered). This fix is unrelated to AI/mentor work and correct regardless of the reversal.

**One infra artifact was not rewound** (flagged, not fixed, by this docs pass — see
"Deferred" below): `infra/docker-compose.yml`'s local Postgres image remains
`pgvector/pgvector:pg16` rather than being reverted to `postgres:16-alpine`, with a header
comment still attributing the swap to "Phase 8 Wave 1 (AI Mentor pgvector retrieval)."
Functionally harmless (a strict superset of `postgres:16-alpine`; no code references
`vector` columns), but the comment is stale.

---

## Deferred

| Item | Notes |
|------|-------|
| **No API endpoint to provision a mentor's dashboard LOGIN** | `Mentor.userId` is nullable by design (ADR-0053) — a hiring record can exist long before a login is granted. The seed data links exactly one mentor (Ramesh) to a `user` row with the `mentor` role to demonstrate the "has login" case; a second mentor (Anjali) is seeded with no login to demonstrate the "prospective, no login yet" case. There is no admin-facing "invite/link mentor → user with `mentor` role" flow yet — a real mentor cannot self-provision or be granted dashboard access through the API today. This is the next mentor-feature increment needed before real (non-seeded) mentors can use the dashboard. |
| **`apps/crm` has no component-test harness** | Same gap carried since P6/P7 — the mentor directory, mentor-detail drawer, batch-mentors panel, batch-completion panel, and mentor dashboard screens are typecheck/lint/build-verified only; no jest-axe/RTL a11y or component-behavior tests were added this wave either. A CRM component-test harness remains a future item. |
| **`infra/docker-compose.yml` `pgvector/pgvector:pg16` image + stale comment** | Carried from the AI-mentor removal (see above) — functionally harmless, but the image should be reverted to `postgres:16-alpine` (or the comment corrected to explain why `pgvector` is being kept, if there's a reason to) in a future devops pass. Not fixed by this docs-writer pass (infra config, not documentation). |

---

## PRD conflict log (P8)

CONFLICT-P8-MENTOR-1 (`docs/03-prd-crm.md §9` / `docs/02-prd-lms.md §9`'s informal
"Faculty/Mentor" combined label) is **resolved this wave** — both sections are relabeled to
plain "Faculty," since Mentor is now a genuinely separate, first-class role (ADR-0053). See
`docs/specs/phase-8-mentor.md` Part 6 for the original conflict record.

CONFLICT-P8-MENTOR-2 (`CLAUDE.md §6`'s original P8 line naming "AI mentor" without a
separate human-mentor item) is **resolved this wave** — `CLAUDE.md §6` now names the
human-mentor track directly, with a parenthetical noting the AI-mentor chatbot was explored
and removed (ADR-0055). `docs/specs/phase-8-mentor.md`'s own stale references to the
deleted `docs/specs/phase-8-ai-mentor.md` file are reworded in this same pass to point at
ADR-0055 instead.

---

## Engineering notes

- **The `batch_mentors` partial-unique index is raw-SQL-only**, same caveat as every prior
  phase's partial-unique lesson (P4 submissions, P6 gamification/forum, P7 certificates/
  notification-suppressions): `UNIQUE (batch_id, mentor_id) WHERE deleted_at IS NULL` is not
  expressible in `schema.prisma`'s `@@unique` syntax — anyone auditing mentor-assignment
  uniqueness must check `prisma/migrations/20260708080100_mentors_partial_indexes/
  migration.sql` directly, not the schema file alone.
- **The internship-completion rollup introduces zero new progress-computation logic**
  (LOCK-4, ADR-0054) — it is a read composition over `enrollments`/`submissions`/
  `certificates` plus a verbatim call into the P4 `CertificatesService.isEligible` engine.
  Any future change to certificate-eligibility rules automatically flows into the
  completion rollup with no mentor-module code change required.
- **The mark-complete transition's race-safety comes from a transactional
  `SELECT ... FOR UPDATE` + single `update`**, not a bulk `updateMany` — deliberately, so
  the transition stays inside the audit Prisma extension's instrumented call surface (see
  ADR-0054 for the full reasoning).
- **The permission-catalog regression spec** (introduced in P7 to guard the
  `forum.read`/`notification_prefs.edit` unseeded-permission bug class) now also covers
  every `@RequirePermission` string introduced by the mentor module — no new CRITICAL of
  that shape was found this wave, which is itself evidence the guard is doing its job.

---

## Where decisions (vs. TODOs) live

Notable architectural decisions made during Phase 8's human-Mentor track are recorded as
ADRs 0053–0055 in `docs/adr/` (indexed in `docs/adr/README.md`), not in this file. This
file is for known gaps and planned work, not decisions.
