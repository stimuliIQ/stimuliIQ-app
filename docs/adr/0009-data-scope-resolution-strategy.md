# ADR 0009: Data-scope resolution via ScopeInterceptor, fail-closed guards, and EnrollmentScopeRepository

## Status
Accepted

## Context
`docs/03-prd-crm.md §9` and `docs/05-database-design.md §3` specify four data scopes
for role-permission grants: `all`, `branch`, `assigned`, and `own`. Each scope narrows
the rows a user may read or mutate:
- `all` — unrestricted within the tenant.
- `branch` — rows belonging to the user's assigned branch.
- `assigned` — rows the user is directly assigned to (e.g. a faculty member's batches).
- `own` — rows the user owns (e.g. their own profile).

Phase-1 must enforce these scopes across every CRM module without each service author
implementing ad-hoc filtering. The scope logic is non-trivial for `branch` and
`assigned` because those dimensions aren't encoded directly in every table — a faculty
member's "assigned" students are students enrolled in that faculty's batches, not a
direct FK on `student_profiles`.

## Decision

### ScopeInterceptor + requireScopeContext
A NestJS interceptor (`ScopeInterceptor`) runs after auth for every CRM route. It
reads the requesting user's role-permission grants, determines the effective scope for
the requested operation, and attaches a `ScopeContext` object to the request. Service
methods call `requireScopeContext(ctx)` — a helper that **throws 403 if the scope
context is absent or the operation is not permitted at any scope**. This is
**fail-closed**: if the interceptor fails to attach a context (e.g. a new route that
forgets to opt in), the service guard throws rather than defaulting to open access.

### Repository-applied filters
Every CRM repository accepts a `ScopeContext` parameter and applies the corresponding
`WHERE` clause additions:
- `all` → no additional filter beyond `tenant_id`.
- `branch` → `AND branch_id = :branchId` (user's `UserRole.branchId`).
- `assigned` → delegated to `EnrollmentScopeRepository` (see below) for students and
  batches; for other modules, `assigned` without a resolution helper is treated as
  fail-closed (empty result set / 403).
- `own` → `AND (student_id = :userId OR user_id = :userId)` as appropriate per table.

### EnrollmentScopeRepository for branch/assigned resolution via enrollments→batches
For the `students` and `batches` modules, resolving `branch` or `assigned` scope
requires joining through `enrollments → batches → faculty_profiles`:
- A faculty user with `assigned` scope on `students` may only see students enrolled in
  batches where `faculty_id = their facultyProfile.id`.
- A branch_manager with `branch` scope sees all students enrolled in batches belonging
  to their branch.

A shared `EnrollmentScopeRepository` (in `common-scope.module.ts`) executes these
joins and returns the set of permitted `studentId` / `batchId` values, which the
calling repository then uses as an `IN (...)` filter. This keeps the join logic in one
place rather than duplicated across `students.repository.ts` and `batches.repository.ts`.

### courses `assigned` scope is fail-closed in P1
The `courses` module has no column linking a program to its author or to a faculty
member directly (`Program` has no `created_by` or `faculty_id`). There is a
`derive-via-batches` helper stub (programs reachable via batches the faculty teaches)
but it was not wired in P1 because the performance and semantics are unclear (a faculty
member teaching a batch doesn't necessarily have authorship rights over the program).
`courses` `assigned` scope therefore returns a fail-closed 403 for all P1 requests
and is tracked as a P1 follow-up (see `docs/phase-1-followups.md`).

## Consequences
- Scope enforcement is centralized and consistent: no service author can accidentally
  skip it, and a forgotten opt-in fails closed rather than open.
- The `EnrollmentScopeRepository` is the single source of truth for cross-table scope
  resolution involving enrollments; future scope expansions (e.g. a new "cohort" scope)
  extend this repository without touching individual module repositories.
- The fail-closed posture on `courses` `assigned` scope means faculty cannot browse
  all courses via the CRM in P1 — an acceptable tradeoff over silently showing all
  courses or returning incorrect scope. A `programs.created_by` column or explicit
  program-faculty mapping table resolves this in a future phase.
- `IN (...)` filters from `EnrollmentScopeRepository` could grow large for high-
  enrollment faculty; if this becomes a performance issue, replace with a subquery or
  a materialized "faculty→accessible_students" view in P7 analytics hardening.

## Alternatives considered
- **Row-level security (RLS) in PostgreSQL**: enforces scopes at the DB layer and
  catches any ORM bypass. Rejected for P1 — RLS requires the DB session to carry
  the tenant/user context (via `SET LOCAL` or connection-level parameters), which adds
  complexity and latency per request, and the approach is harder to test in
  testcontainers. Deferred as a future hardening option.
- **Per-service ad-hoc scope checks**: each service applies its own filter logic
  inline. Rejected — guarantees drift and near-certain missed cases as the module count
  grows.
- **Policy objects (ability / CASL)**: a popular pattern in the Node ecosystem for
  encapsulating authorization policies. Not adopted because the existing
  `@RequirePermission` + `ScopeInterceptor` layering already provides the same
  separation of concerns and is simpler to audit (one interceptor, one guard).
