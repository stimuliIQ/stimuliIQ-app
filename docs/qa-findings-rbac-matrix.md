# QA Findings — Generated RBAC Matrix (first run)

> Artifact: `apps/api/test/integration/rbac-matrix.integration-spec.ts`
> Runner: `pnpm --filter @stimuliiq/api test:integration:safe`
> Run against the isolated `stimuliiq_test` database. No application source was modified.

## What the matrix does

It introspects the **live Nest router** at runtime — reading the real `@RequirePermission`,
`@UseGuards`, `@Controller` and route metadata off the actual controller classes — and derives
its assertions from that inventory rather than from a hand-written list. It therefore cannot go
stale: a route added tomorrow is picked up automatically, and if it is unguarded or carries an
unseeded permission key, the suite fails the day it merges.

**Coverage achieved on the first run:**

| | |
|---|---|
| Routes discovered | **382** |
| Permission-protected routes | **324** |
| Roles | **12** |
| Authorization cells asserted | **3,888** |

The load-bearing insight that makes this generatable: Nest runs `guards → pipes`, so
`PermissionsGuard` fires *before* validation. A caller lacking the permission gets 403
regardless of whether the body or path params are valid — so an empty probe request is still a
sound authorization test.

Two assertions per cell:
- role **lacks** the permission → **must be 403** (exact)
- role **holds** the permission → **must not be 403** (proves the grant actually grants)

---

## Headline result: the permission layer is sound

**Zero routes let a role through that it lacked the permission for.** Across all 3,888 cells,
`shouldHaveBeenDenied` was empty for every one of the 12 roles. There is no missing guard, no
route reachable by an unprivileged role, no privilege escalation via a forgotten decorator.

That is the security-critical direction, and it is clean.

---

## F-1 — `attempts.grade` is missing from the seed. Descriptive grading is a dead feature. **[OPEN]**

**Severity: High (functional, not security — it fails closed).**

`PUT /api/v1/crm/attempts/:id/grade` requires `@RequirePermission("attempts.grade")`
([assessments-crm.controller.ts:153](../apps/api/src/modules/assessments/assessments-crm.controller.ts#L153))
— it is the endpoint faculty use to grade a **descriptive** assessment attempt.

`prisma/seed.ts` never defines that key. The P4 catalog block seeds `attempts.take` and
`attempts.view` and stops:

```ts
// prisma/seed.ts:194
{ key: "attempts.take",      label: "Take Assessment Attempt" },
{ key: "attempts.view",      label: "View Assessment Attempts" },
// attempts.grade — ABSENT
```

`grep -rn "attempts.grade" prisma/seed.ts` returns **nothing**: not in the catalog, not granted
to any role.

**Consequence.** A permission absent from the catalog cannot be granted to any role, so no user
can ever hold it, so the route returns **403 to everyone — including `super_admin`** — in any
real deployment. Descriptive-assessment grading does not work, and the CRM's "Grade descriptive
attempt" drawer (`/academics/assessments`) can never succeed. Scenario **H-05** in the test plan
would have failed.

### Why no existing test caught it — the part that matters

Two independent blind spots lined up:

1. **The per-module drift guards are opt-in.** 19 modules ship a `*.permission-catalog.spec.ts`
   that asserts their `@RequirePermission` keys exist in the seed. **`assessments` is not one of
   them.** A guard nobody remembered to write cannot fail.

2. **An integration fixture manufactures the missing permission.**
   [p4-learning-depth-journey.integration-spec.ts:257](../apps/api/test/integration/p4-learning-depth-journey.integration-spec.ts#L257)
   upserts `["attempts.grade", "Grade Attempts"]` itself, because the journey it exercises needs
   it. So the key *exists* in any database that suite has touched, that spec goes green, and the
   seed gap is invisible. The test suite is green **because it creates the thing the seed forgot.**

This is the exact class of bug a generated, router-derived matrix exists to catch, and it fell
out on the first run.

### Fix

Add to the P4 block in `prisma/seed.ts` and grant it alongside the existing `submissions.grade`:

```ts
{ key: "attempts.grade", label: "Grade Assessment Attempt" },
```
Grant: `faculty` at `assigned`; `admin` / `super_admin` at `all`.

Then delete the `F-1 REGRESSION` test in the matrix spec, and remove the fixture upsert in
p4-learning-depth-journey so it exercises the real seeded permission.

---

## F-2 — Dead grants: roles hold permissions whose scope can never resolve **[OPEN, by design but wrong]**

**Severity: Medium (functional/UX — fail-closed, so safe).**

Several roles are granted permissions that the scope layer then makes unusable. The requests
403 *despite* a valid grant.

| Route(s) | Roles affected | Why |
|---|---|---|
| `GET/PATCH /crm/courses*` (6 routes) | `faculty`, `branch_manager`, `counsellor` | [courses.repository.ts:9-17](../apps/api/src/modules/courses/courses.repository.ts#L9-L17) documents it: faculty is seeded `courses.view/create/edit` at **scope=assigned**, but `programs` has **no author/owner column** to resolve "assigned" against, so it **fails closed**. `branch`/`own` were never implemented for this module either. |
| `GET /crm/enrollments` | `student` | The `student` role holds `enrollments.view` at `own` scope (for `/me/enrollments`). The CRM list route reuses the same permission **key**, and the **scope layer** is what correctly denies it. |

The `/crm/enrollments` case is the security model **working**: a student must never list CRM
enrollments, and the scope layer stops it even though the permission layer would not. Good.

The `/crm/courses` case is a genuine product bug: faculty, branch managers and counsellors are
granted Courses permissions, **the CRM sidebar therefore shows them the Courses nav item**, and
every request they make 403s. Either the grant should be removed from the seed, or `assigned`
scope needs a resolvable definition (the code comment suggests `programs.created_by`, or
deriving it from `batches.facultyId`).

---

## F-3 — Quiet-hours notification test fails **[OPEN, pre-existing]**

**Severity: Medium — needs triage.**

`p6-engagement.integration-spec.ts` → `N-13 AC-9: quiet hours (whole-day window, deterministic)
defers a non-urgent send` **fails**: a non-urgent announcement was **sent** during a quiet-hours
window instead of being deferred (`expect(jest.fn()).not.toHaveBeenCalled()` — received 1 call).

**Not caused by the matrix work** — verified by running `p6-engagement` in isolation with the
new spec absent from the run; it fails standalone. Given the test is deliberately named
"deterministic" (whole-day window, chosen to avoid timezone flake), this is either a real
quiet-hours regression or a timezone-sensitivity bug in the window computation. Worth a look —
the user-visible failure mode is "we notify students during their quiet hours."

---

## Non-findings (verified correct, recorded so they aren't re-investigated)

- **`/me/mentor/dashboard` 403s for a wildcard-granted admin.** Correct: it re-verifies the
  caller is an *assigned mentor*, a deliberate defense-in-depth IDOR guard. Holding
  `mentor.dashboard.view` is necessary but not sufficient.
- **`/me/referrals`, `/crm/referrals` 403 without a student profile.** Correct — the Wave-6 H1
  referrals-scope fix.
- **Scope fails closed for a role with no branch/profile.** A `branch`-scoped user whose
  `UserRole.branchId` is null cannot resolve a scope context and is denied rather than shown
  everything. This is the fail-open bug class (`R-05`) **not** happening.
- **Routes with no `@RequirePermission`** (authenticated-only by design): `GET /me`,
  `POST /auth/logout`, `crm/saved-views/*` (own-scoped in the service), `feature-flags/evaluate`,
  `public/enroll/*`. All enumerated and allowlisted in the spec — a *new* one will now fail the
  suite.
- **Unauthenticated routes**: all public reads, captcha-gated intake, HMAC-verified webhooks,
  signed-token endpoints, `/metrics` (bearer-guarded), `/api-docs.json`. Enumerated and
  allowlisted; a new one will now fail the suite.

---

## Open decision

The general drift guard ("every `@RequirePermission` key exists in the seed catalog") currently
checks the **live DB**, which is weaker than it should be — that is precisely the weakness that
let F-1 hide, since test fixtures upsert permissions into the DB. The robust version must read
the catalog `prisma/seed.ts` actually produces, but it cannot today: the catalog is assembled
inside `main()` from unexported `buildPhaseXPermissionCatalog()` cross-product builders.
Re-deriving them in the test would only make the test agree with the seed *by construction*
rather than verify it.

**Fix: a one-line export in `prisma/seed.ts`** so the test imports the real catalog. Pending
approval — it is a change to source, not to tests. Until then the `F-1 REGRESSION` test pins the
concrete bug.
