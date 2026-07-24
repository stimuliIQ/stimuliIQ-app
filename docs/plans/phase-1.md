# Plan: Phase 1 — CRM Core ("P1")

> Scope boundary (`CLAUDE.md §6`): **"P1 CRM core: students/faculty/courses/batches CRUD,
> roles/permissions, audit logs."** This plan delivers exactly that, end-to-end
> (schema → contracts → backend → CRM frontend → tests → security → docs) and **does not**
> plan ahead into P2 (commerce/leads/payments/enrollment funnel), P3 (LMS/video/live class),
> P4 (certificates), P5 (website), P6 (engagement), or P7 (analytics dashboards). Tabs and
> nav for those later modules are rendered as **stubbed empty-state placeholders only**.
> Each task DoD references `CLAUDE.md §4` + the relevant `docs/03 §7.x` + acceptance
> criteria from `docs/03 §20`.

---

## Goal & success criteria

**Goal:** Turn the Phase-0 identity/RBAC foundation into a working **CRM operations core**:
staff can manage **students, faculty, programs/curriculum, batches (+ enrollment join),
roles/permission-matrix, branches, and read audit logs** — all tenant-scoped, RBAC-enforced
server-side with data-scope (`all|branch|assigned`), soft-deletable + restorable, audited on
every mutation, with shared zod DTOs and a dense, a11y-AA CRM SPA.

**Success criteria:**
1. **Students** (`docs/03 §7.2`): directory with server-side search/filter/paginate by
   program/batch/branch/status; profile view; lifecycle status (`lead|active|alumni`);
   create/edit; soft-delete + **restore**. Later tabs (payments/attendance/grades/
   certificates/tickets) render as empty-state placeholders.
2. **Faculty** (`docs/03 §7.3`): CRUD; expertise; assigned-batches view; faculty access
   **scoped to their own batches/students** (the §20 counsellor/faculty-scope criterion).
3. **Courses/Programs** (`docs/03 §7.4` core): programs CRUD with editable price/EMI fields;
   curriculum builder (modules→lessons reorder/CRUD); **publish/unpublish**. Coupons/pricing
   *flows* are P2 (only the existing `price_paise`/`emi` fields are editable here).
4. **Batches** (`docs/03 §7.5` core): CRUD (program, start/end, capacity, faculty, schedule,
   branch, mode); assign faculty; **enroll/move students** via the `enrollments` join; batch
   roster. Commerce side of enrollment is P2.
5. **Admin** (`docs/03 §7.16` / §9): **role management + permission-matrix editor**
   (module × action × scope) for the full default role set (Owner/SuperAdmin, Admin,
   BranchManager, Counsellor, Faculty, Finance, Marketing, Support, ContentEditor) with
   **server enforcement**; **branches CRUD**; **audit-log viewer** (read-only, who/what/when/
   before-after, filter + paginate).
6. **Cross-cutting** (`CLAUDE.md §3/§4`): every new table has `tenant_id` + soft-delete +
   audit; RBAC enforced server-side with data-scope; zod DTOs in `@repo/types` shared FE+BE;
   loading/empty/error states on every async UI; a11y AA; money in paise; `turbo run build
   lint test` green; unit + integration tests gate; security-reviewer sign-off (no high/crit).
7. **`docs/03 §20` acceptance criteria in P1 scope met:** (a) a Counsellor/Faculty sees only
   in-scope students; a forbidden action is **blocked server-side and logged**; (b) every
   create/update/delete on a sensitive entity writes an audit-log row with actor, timestamp,
   before/after diff. (Certificate-verify and revenue-reconcile criteria are P2/P4 — out of
   scope here.)

---

## Preconditions (what must already exist — verified from Phase 0)

- Monorepo + CI green (31/31 turbo tasks + 16 integration tests). `turbo run build lint test`
  passes from clean clone.
- Auth fully working: argon2id, RS256 JWT access + rotating/single-use refresh with reuse
  detection + family revoke, cookie + CSRF transport, sessions in Redis.
- **RBAC machinery exists and is proven on `/me`** and is **directly reusable**:
  - `apps/api/src/modules/auth/decorators/require-permission.decorator.ts`
  - `apps/api/src/modules/auth/guards/permissions.guard.ts`
  - `apps/api/src/modules/auth/interceptors/scope.interceptor.ts`
  - `apps/api/src/modules/auth/lib/scope-context.ts` (`all|branch|assigned|own` context)
- Core Prisma schema present (`prisma/schema.prisma`): tenants, branches, users, roles,
  permissions, role_permissions, user_roles, sessions, **programs, modules, lessons**,
  audit_logs — all uuid PK + tenant_id (where applicable) + soft-delete; AuditLog is
  append-only (no `deleted_at`). Soft-delete + audit Prisma extensions are live.
- **NOT yet present (P1 must add):** `student_profiles`, `faculty_profiles`, `batches`,
  `enrollments` — and the full CRM permission catalog/matrix (P0 seeded only the auth/`me`
  slice + admin-gets-all). `@repo/types` has only `auth` schemas; `@repo/ui` has only
  Button/Card/Input/Label/Toast (no DataTable/Drawer/Tabs/Select/StatusChip/EmptyState/
  Skeleton/FormField). The CRM app is a Phase-0 shell only.

**Carried P0 follow-ups that touch P1 (from `docs/phase-0-followups.md`) — address inside P1
where they intersect, otherwise leave tracked:**
- **`TENANT_SLUG="stimuliiq"` hardcoded** in `auth.service.ts`: P1 stays single-tenant; new
  repositories MUST still tenant-scope every query (don't add new hardcodes). Real
  multi-tenant resolution remains deferred (no second tenant in P1) but is flagged as a risk.
- **M-5 inactive-account enumeration / M-6 IP-rate-limit / L-1..L-4 / argon2 param pinning:**
  not P1 feature work; left tracked. Only fold in if a P1 task directly touches that code.
- **Playwright e2e + axe:** P1 finally has real CRUD UI; e2e is **optional/light** in P1
  (one happy-path per critical journey if time permits) — integration tests are the gate.

---

## New schema the db-architect adds in P1

Beyond P0 core, add these four tables (per `docs/05 §3` "Profiles" + "Batches & enrollment"),
each with `id` uuid PK, `created_at`/`updated_at`/`deleted_at`, `tenant_id` where applicable,
soft-delete + audit wired, and the `docs/05 §4` indexes. **Do not** add later-phase tables
(videos, resources, lesson_progress, attendance, assignments, submissions, assessments,
attempts, certificates, orders, payments, invoices, leads, activities, bookings, etc.).

| Table | Columns (P1 subset of `docs/05 §3`) | Notes |
|-------|-------------------------------------|-------|
| `student_profiles` | `user_id` (FK users, uniq), `tenant_id`, `college`, `course_type` (enum `btech\|degree\|diploma\|mca\|mba\|other`), `year`, `city`, `source`, `status` (enum `lead\|active\|alumni`) | 1:1 with a `student`-role user. Directory queries hang off this + `users`. |
| `faculty_profiles` | `user_id` (FK users, uniq), `tenant_id`, `expertise` (json/string[]), `bio`, `rating` (nullable, future), `branch_id` (FK branches, nullable) | 1:1 with a `faculty`-role user. `branch_id` drives branch scope; assigned-batch scope comes via `batches.faculty_id`. |
| `batches` | `tenant_id`, `program_id` (FK programs), `branch_id` (FK branches), `faculty_id` (FK faculty_profiles, nullable), `name`, `start_date`, `end_date`, `capacity` (int), `mode` (reuse `ProgramMode` enum), `schedule` (json), `status` (enum `planned\|active\|completed\|archived`) | Indexes `(tenant_id, program_id)`, `(branch_id)`, `(faculty_id)`, `(tenant_id, deleted_at)`. |
| `enrollments` | `tenant_id`, `student_id` (FK student_profiles), `batch_id` (FK batches), `program_id` (FK programs, denormalized for roster/reporting), `status` (enum `active\|completed\|dropped`), `progress_pct` (int default 0), `enrolled_at`, `completed_at` (nullable) | **P1 = the join/roster only**; payment/commerce side is P2. Indexes `(student_id)`, `(batch_id)`, `(tenant_id, status)`, uniq `(student_id, batch_id)` (where not soft-deleted). |

Plus **seed expansion**: the **full default role set** (`docs/03 §9`: Owner/SuperAdmin, Admin,
BranchManager, Counsellor, Faculty, Finance, Marketing, Support, ContentEditor), the full
**permission catalog** for in-scope CRM modules (`students, faculty, courses, batches,
enrollments, roles, branches, audit` × actions `view/create/edit/delete/export/approve`) with
the **scope per the §9 matrix** materialized into `role_permissions`, and **sample data** (a
branch or two, several programs with modules/lessons, a handful of faculty + students,
batches, and enrollments) so the CRM has something to render and tests have fixtures.

> Permission keys for **later-phase** modules (payments/leads/marketing/reports/certificates/
> etc.) MAY be seeded into the `permissions` catalog as forward-looking keys (harmless,
> matches `docs/03 §9`'s full matrix), but **no API/UI** is built for them in P1.

---

## Task graph

| # | Task | Owner agent | Depends on | Wave | DoD (refs `CLAUDE.md §4` + docs) |
|---|------|-------------|------------|------|------|
| 1 | **Schema + migration + seed.** Add `student_profiles`, `faculty_profiles`, `batches`, `enrollments` to `prisma/schema.prisma` per the table above (uuid PK, tenant_id, soft-delete, indexes `docs/05 §4`); wire them into the existing soft-delete + audit Prisma extensions. Forward-only migration applies clean. Expand `seed.ts`: full role set + full in-scope permission matrix per `docs/03 §9` + sample faculty/students/programs/batches/enrollments. Add an integration test proving soft-delete filter + audit-row-on-mutation for one new table. | db-architect | — | **W1** | §4: every table tenant_id + soft-delete + audit; migration forward-only; `docs/05 §3/§4`, `docs/03 §9`. Migration + seed run clean; middleware test green. |
| 2 | **Shared contracts + client.** In `@repo/types`: zod DTOs + types for Students (Create/Update/Query/ListItem/Detail/Restore), Faculty, Programs+Module+Lesson (curriculum + publish), Batches, Enrollments (create/move), Roles + permission-matrix (RolePermissionEntry: module×action×scope), Branches, AuditLog (query + row). Reuse the `{data,meta,error}` envelope + `Paginated<T>` + RFC-7807 errors from P0. Register all in the OpenAPI registry; regenerate `@repo/api-client` SDK methods. Money fields typed as integer paise. | api-designer | 1 | **W2** | §4: zod DTOs in `@repo/types` imported FE+BE; validation at every boundary. `docs/04 §2.14`. Client compiles; SDK methods exist for all in-scope resources. |
| 3 | **Backend A — People & Catalog.** NestJS modules `students`, `faculty`, `courses` (programs/modules/lessons + curriculum reorder + publish/unpublish). Each: controller→service→repository, `@RequirePermission` guard + `ScopeInterceptor` per the `docs/03 §9` matrix (students: Counsellor=assigned, BranchMgr=branch, Faculty=assigned; faculty: self/branch; courses: ContentEditor/Faculty author, others view), tenant-scoped repos, soft-delete + **restore** endpoints, audit on every mutation, server-side search/filter/paginate for the student directory. | backend-builder | 1, 2 | **W3** | §4: server-side RBAC + scope; soft-delete + restore + audit on mutations; loading-agnostic API. `docs/03 §7.2/§7.3/§7.4`, `§20(a)(b)`. |
| 4 | **Backend B — Batches/Enrollments & Admin/RBAC & Audit.** NestJS modules `batches` (CRUD + assign-faculty + roster), `enrollments` (create/move/withdraw join only — no commerce), `admin` (`roles` CRUD + **permission-matrix read/update** writing `role_permissions` with scope; `branches` CRUD), `audit` (read-only list/detail with filter + paginate, no write API). Same guard/scope/soft-delete/restore/audit discipline. Matrix-update endpoint itself is permission-gated + audited. | backend-builder | 1, 2 | **W3** | §4: server-side RBAC; mutations audited; matrix changes audited. `docs/03 §7.5/§7.16/§9/§20`. Audit endpoint is read-only + scoped. |
| 5 | **CRM design-system primitives.** Add to `@repo/ui` only the primitives the CRM needs that don't exist yet, per `docs/04 §3.1` + `docs/07`/`docs/03 §12`: **DataTable** (server-pagination + sort + virtualization-ready), **Drawer** (side-panel detail), **Tabs**, **Select**, **StatusChip** (label + color, never color-only — §15), **EmptyState**, **Skeleton**, **FormField** (label+error+a11y wiring), **ConfirmDialog**. All keyboard-first, focus-managed, AA. (Command palette ⌘K = optional stretch, not gating.) | design-system | — | **W2** (‖ #2) | §4: a11y pass (keyboard + SR labels), loading/empty/error built in. `docs/07`, `docs/03 §12/§15`. Each primitive has a unit/a11y test. |
| 6 | **CRM frontend A — People & Catalog UI.** CRM Vite SPA (TanStack Router + Query): nav/IA shell for in-scope modules per `docs/03 §10` (later modules = disabled/placeholder nav). Build **Students** (directory table + filters + profile drawer/page with placeholder tabs + create/edit form + soft-delete/restore), **Faculty** (list + profile + assigned batches), **Courses** (program list + curriculum builder + publish toggle). RHF + zod (`@repo/types`); RBAC-aware rendering (hide actions the API forbids); loading/empty/error states everywhere. | frontend-builder | 3, 5 | **W4** | §4: loading/empty/error on every async UI; a11y; no business logic in components (hooks/services); RBAC-aware UI. `docs/03 §7.2/§7.3/§7.4/§10/§11/§12`. |
| 7 | **CRM frontend B — Batches & Admin UI.** Build **Batches** (list + create/edit + assign-faculty + roster with enroll/move student), **Admin → Roles & Permissions** (matrix editor: module×action×scope grid writing via the matrix API), **Admin → Branches** (CRUD), **Admin → Audit Logs** (read-only table + filters + before/after diff drawer). Same RHF+zod, RBAC-aware, loading/empty/error discipline. | frontend-builder | 4, 5 | **W4** | §4: as #6. `docs/03 §7.5/§7.16/§10/§11/§12`. Matrix editor only shows/saves valid module×action×scope; audit view is read-only. |
| 8 | **Tests.** Unit (services: scope-filter builders, matrix→role_permissions mapping, soft-delete/restore, audit-diff). Integration (testcontainers, real PG/Redis): per-module CRUD; **RBAC scope allow/deny per the §9 matrix** (Counsellor sees only assigned students; Faculty only own batches/roster; BranchMgr only their branch; forbidden action → 403 + audit row); soft-delete hides + restore returns; **audit-row-written-on-every-mutation**; matrix-update reflects in subsequent authz. Light Playwright happy-path e2e on 1–2 critical CRM journeys (optional, non-gating). Wire into CI. | qa-engineer | 3, 4, 6, 7 | **W5** | §4: unit + integration green; tests gate merge. `docs/03 §20(a)(b)`. Coverage of every in-scope module + each scope mode. |
| 9 | **Security review.** Object-level authz / **IDOR** across all new endpoints (can user X read/edit student/batch/role outside their scope?); the **§20 scope-isolation criterion** (Counsellor/Faculty/Branch isolation) verified by attempted bypass; audit completeness (no mutation path skips the audit write); permission-matrix-editor cannot be used to **privilege-escalate** beyond the editor's own grants; tenant-scoping on every new repo query (no cross-tenant leak via the hardcoded-slug path); export endpoints (if added) are scoped. Report high/crit as fix tasks; re-verify. | security-reviewer | 8 | **W6** | §4: RBAC enforced server-side; matches `docs/04 §7` gate. No high/crit open. `docs/03 §17/§20`. |
| 10 | **Docs sync.** Update `README.md` (new modules + how to run/seed/verify P1), record ADRs for any P1 decisions (e.g. student/faculty profile-vs-user modeling, enrollment-as-join boundary, permission-matrix storage/update semantics, scope-filter strategy). Update `docs/phase-1-followups.md` with anything deferred (e.g. carried P0 items, optional e2e, later-phase tabs left as placeholders). Confirm `docs/05` reflects the 4 new tables as built. | docs-writer | 9 | **W6** | §4: short summary of what changed + how to verify. P1 closeout. |

---

## Execution order (waves)

- **Wave 1:** #1 (db-architect) — schema + migration + seed; everything depends on it.
- **Wave 2 (parallel):** #2 (api-designer) ‖ #5 (design-system). Contracts depend on schema;
  the UI primitives depend on nothing and can be built alongside.
- **Wave 3 (parallel):** #3 (backend-builder — People & Catalog) ‖ #4 (backend-builder —
  Batches/Enrollments + Admin/RBAC + Audit). Split to keep each a single-run-sized job; both
  depend only on #1 + #2 and share no files (distinct modules), so they parallelize cleanly.
- **Wave 4 (parallel):** #6 (frontend-builder — People & Catalog UI, needs #3 + #5) ‖ #7
  (frontend-builder — Batches & Admin UI, needs #4 + #5).
- **Wave 5:** #8 (qa-engineer) — needs all backend + frontend landed.
- **Wave 6:** #9 (security-reviewer) → #10 (docs-writer).

---

## Risks & open questions

1. **Student/faculty as `users` + profile vs standalone.** This plan models `student_profiles`
   / `faculty_profiles` as **1:1 extensions of `users`** (matches `docs/05 §3` ER:
   `USER ||--o| STUDENT_PROFILE`). That means creating a student/faculty in the CRM also
   creates a `user` row (with a `student`/`faculty` role, status `invited`, no login until P5
   funnel / invite flow). **Confirm** this vs. profiles that don't get a `user` until they log
   in. *Recommendation:* user-first (keeps RBAC/audit uniform); login can stay disabled.
2. **Scope semantics for Faculty/Counsellor.** "assigned" for **students** = students enrolled
   in a batch the faculty teaches (via `enrollments`→`batches.faculty_id`) or, for counsellors,
   students they own. P1 has no leads yet, so the **counsellor "assigned student" link needs a
   defined owner field** — *recommendation:* reuse a nullable `owner_id`/created-by on
   `student_profiles` OR scope counsellors to `branch` in P1 and tighten to lead-ownership in
   P2 when leads land. db-architect/api-designer must pick one; flag in ADR.
3. **Permission-matrix editor privilege-escalation.** Editing the matrix is powerful; the
   editor must not be able to grant a permission/scope broader than the editor's own
   (`Owner/Admin` only per §9). Security review (#9) explicitly checks this.
4. **Multi-tenant hardcode (P0 follow-up).** `TENANT_SLUG` is still hardcoded; P1 stays
   single-tenant but all new repos must tenant-scope. No second tenant is introduced; real
   resolution stays deferred. Risk only if a P1 task touches tenant resolution.
5. **Backend split sizing.** #3 and #4 are each multi-module; if either overruns a single
   specialist run, sub-split (#3 → students | faculty | courses; #4 → batches+enrollments |
   admin/rbac | audit) keeping the same wave.
6. **Virtualization scope.** `docs/03 §8` wants virtualized large tables; P1 ships
   server-pagination + a virtualization-*ready* DataTable. Full row-virtualization tuning can
   defer to P7 perf if needed.

---

## Open questions / secrets the user must provide for P1

- **Secrets/keys: NONE new.** CRM core is internal CRUD over the existing Postgres/Redis +
  the already-issued RS256 JWT keypair. No new vendor integration lands in P1 (Razorpay/MSG91/
  SES/Cloudflare/Zoom etc. are all P2+). The Phase-0 env set is sufficient. **Confirmed.**
- **Product decisions needed before/early in W1–W2** (defaults chosen if no answer):
  1. **Q1 (modeling):** student/faculty are `users`+profile (recommended) vs profile-only?
     *Default:* users + profile.
  2. **Q2 (counsellor student scope in P1):** add `student_profiles.owner_id` now, or scope
     counsellors to `branch` until leads land in P2? *Default:* scope to `branch` in P1, add
     `owner_id` semantics in P2 — simpler and avoids modeling lead-ownership early.
  3. **Q3 (batch `status` enum values):** confirm `planned|active|completed|archived`.
     *Default:* those four.
  4. **Q4 (student `course_type` enum):** confirm `btech|degree|diploma|mca|mba|other` (from
     `docs/05 §3`). *Default:* those.

---

## Definition of Done for the whole phase (gate to P2)

- [ ] Migration adds `student_profiles`, `faculty_profiles`, `batches`, `enrollments` (uuid PK,
      tenant_id, soft-delete, indexes), wired to soft-delete + audit extensions; seed creates
      the full role set + in-scope permission matrix (`docs/03 §9`) + sample data.
- [ ] zod DTOs for all in-scope resources in `@repo/types`, imported FE+BE; `@repo/api-client`
      regenerated with SDK methods for each.
- [ ] Backend modules (students, faculty, courses, batches, enrollments, admin/roles+branches,
      audit) expose CRUD + restore with `@RequirePermission` + scope per the §9 matrix; every
      mutation writes an audit row; audit API is read-only.
- [ ] CRM SPA renders all in-scope modules with dense tables, drawers, matrix editor, audit
      viewer; RBAC-aware UI; loading/empty/error on every async surface; later-phase tabs/nav
      are placeholders only.
- [ ] **`docs/03 §20(a)`:** a Counsellor/Faculty/BranchMgr sees only in-scope data; a forbidden
      action is blocked **server-side** and **logged** — proven by integration tests.
- [ ] **`docs/03 §20(b)`:** every create/update/delete on students/faculty/programs/batches/
      enrollments/roles/branches writes an audit-log row with actor, timestamp, before/after.
- [ ] Unit + integration tests green (each module + each scope mode + soft-delete/restore +
      audit-on-mutation); `turbo run build lint test` green; optional light e2e if added.
- [ ] a11y AA pass on new `@repo/ui` primitives and CRM screens (keyboard + SR labels).
- [ ] security-reviewer sign-off: no high/critical IDOR/scope/escalation findings open.
- [ ] README + ADRs + `docs/phase-1-followups.md` synced; `docs/05` reflects the 4 new tables.
