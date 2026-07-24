# ADR 0031: Faculty `assigned`-scope grading resolved via enrollment→batch→faculty_id

## Status
Accepted

## Context
ADR-0009 defined the scope-resolution strategy for the `ScopeInterceptor` and deferred
one open question: how does the `assigned` scope for faculty translate to a concrete DB
predicate when the resource being accessed is an assignment submission, an assessment
attempt, or a certificate recommendation?

The deferral in ADR-0009 was acceptable through P1, P2, and P3 because those phases
involved student-side consumption (students reading their own data) and admin-side reads
(`all` scope). Phase 4 is the **first phase with a faculty authoring and grading
surface** — faculty must be able to grade submissions and attempts, author assessments,
and recommend certificates for students in **their assigned batches only**, without
seeing other batches' data.

`programs` still has no `created_by` column. The plan noted this absence at P1 planning
time and carried it as a deferral. Adding `created_by` to `programs` is a future
migration; it does not unblock P4 because the scope anchor needed here is the **batch**,
not the program author.

The correct anchor for faculty `assigned` scope in the learning context is the
**`batches.faculty_id`** column, which was added in P1 (ADR-0009 context). A batch has
exactly one faculty member (`faculty_id` on `batches`). A student's enrollment has a
`batch_id`. A submission or attempt belongs to an enrollment. Therefore:

```
submission → enrollment.batch_id → batches.faculty_id = current_user.id
```

This chain is traversable in one Prisma query via nested `where` predicates.

## Decision

The scope resolver for faculty grading (`assigned` scope on `submissions`,
`attempts`, and `certificates.recommend`) is implemented as a predicate injected by
the `ScopeInterceptor` before the repository layer:

```typescript
// For a faculty user with scope 'assigned':
// Submission repository predicate:
where: {
  enrollment: {
    batch: {
      facultyId: currentUser.facultyProfile.id,
    },
  },
}

// Attempt repository predicate (same chain):
where: {
  enrollment: {
    batch: {
      facultyId: currentUser.facultyProfile.id,
    },
  },
}
```

This predicate is **fail-closed**: if `currentUser.facultyProfile` is null (the user has
a faculty role but no faculty profile — an edge case that should not occur in production
but could occur in test data), the interceptor rejects the request with 403 rather than
silently returning all records.

**Grading endpoint RBAC:**
- `PATCH /submissions/:id/grade` — requires `submissions.grade` permission + the
  submission's enrollment batch must satisfy the predicate above.
- `PATCH /attempts/:id/grade` (descriptive manual grade) — requires `attempts.grade`
  permission + same predicate.
- `POST /certificates/:enrollmentId/recommend` — requires `certificates.recommend`
  permission + same predicate.

The predicate is applied as a `where`-clause enhancement on the repository `findOne`
call. If the `submissions/:id` row does not satisfy the predicate for the requesting
faculty, the query returns null → the service throws a `NotFoundException` → HTTP 403
(or 404, per IDOR-safe design — see ADR-0022). Faculty cannot distinguish "this
submission doesn't exist" from "this submission exists but is in your unassigned batch."

**Integration test coverage (task #12):**
- Faculty A (assigned to Batch 1) attempts to grade Submission belonging to Batch 2
  (Faculty B's batch) → 403/404.
- Faculty A grades Submission in Batch 1 → 200 with graded status.
- Descriptive attempt manual grade — same assert pattern.

## Consequences
- The `assigned` scope for all P4 faculty-grading surfaces is now fully implemented and
  tested. ADR-0009's deferral for `programs.created_by` is no longer an open blocker for
  faculty grading; it may still be relevant for future program-authoring scope isolation.
- Adding a second faculty member to a batch (if batches support multiple faculty in a
  future phase) would require revisiting this predicate. Currently `batches.faculty_id`
  is a single nullable FK.
- `programs.created_by` remains absent. This does not affect P4 grading because the
  scope is anchored on the batch-to-faculty relationship, not on program ownership. If
  program authoring scope (faculty can edit only programs they created) is needed in a
  future phase, a `created_by` column and a new ADR are the path.
- This ADR supersedes the ADR-0009 deferral note regarding faculty grading. ADR-0009
  remains accepted for the general `ScopeInterceptor` design and `EnrollmentScopeRepository`
  pattern; only the specific grading predicate deferral is now resolved.

## Alternatives considered
- **Resolve via `program → modules → lessons → assignments → submissions`**: a longer
  chain that anchors on program ownership (once `programs.created_by` exists). Rejected
  for P4 — the batch anchor is shorter, already exists, and is semantically correct
  (a faculty member is assigned to teach a batch, not necessarily to author a program).
- **Add a `faculty_id` column directly to `submissions` / `attempts`**: denormalise the
  scope anchor onto the resource table for a simpler predicate. Rejected — the existing
  enrollment→batch→faculty chain is the canonical scope derivation and denormalising it
  would create an update-anomaly risk if batch faculty assignments change after
  submissions are created.
- **Scope by program (`programs.created_by` once added)**: deferred to a future phase
  where program-level authoring scope matters. Out of scope for P4.
