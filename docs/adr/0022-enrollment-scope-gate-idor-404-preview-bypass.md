# ADR 0022: Enrollment-scope gate, IDOR→404, and preview-bypass

## Status
Accepted

## Context
Every LMS content endpoint (curriculum, lesson detail, stream-url mint) must verify
that the requesting student is enrolled in the program that contains the lesson, and
that the enrollment belongs to the requesting user. Without this gate, any authenticated
user could read any lesson's content or mint a signed video URL for any lesson — a
classic IDOR (Insecure Direct Object Reference) vulnerability.

Three access modes exist for lesson content:

1. **Enrolled access**: student is actively enrolled in the batch/program that contains
   the lesson. Full content + stream-url mint allowed.
2. **Preview access**: the lesson is flagged `is_preview = true` and the caller is
   unauthenticated or enrolled in a *different* program. A limited content preview is
   allowed; stream-url minting is NOT allowed.
3. **No access**: student is authenticated but not enrolled in the program, AND the
   lesson is not marked `is_preview`. Response must be indistinguishable from "lesson
   not found" (no existence disclosure).

An additional concern is the tenant scope on the lesson lookup: the `is_preview` path
must also be scoped to the requesting tenant to prevent a cross-tenant preview of
lessons belonging to a different tenant's program.

## Decision

### Single gate: `resolveEnrollmentForLesson`
All content endpoints call a single `resolveEnrollmentForLesson(userId, tenantId, lessonId)`
function that returns `{ enrollment, lesson }` or throws:

- Looks up the lesson as `findLessonById(tenantId, lessonId)` with a deep-join filter
  `where: { id: lessonId, module: { program: { tenantId } } }`. This ensures the
  lesson belongs to the requesting tenant on **both** the enrolled path and the
  preview path. (M-1 fix — see `docs/phase-3-followups.md`.)
- Looks up the enrollment via `findActiveEnrollmentForProgram(userId, programId)`.
- If enrollment found and `enrollment.student.userId === userId` (JWT-derived): returns
  both. No cross-student enrollment re-use is possible.
- If no enrollment and `lesson.is_preview === true`: returns `{ enrollment: null, lesson }`.
  This is the only path where `enrollment` may be `null`.
- If no enrollment and `lesson.is_preview === false`: throws `NotFoundException` (404).
  The response is identical whether the lesson does not exist, belongs to another
  tenant, or the student is simply not enrolled — no existence disclosure.

### IDOR→404
A student who is authenticated but not enrolled in the lesson's program receives `404
Not Found` for any lesson that is not marked `is_preview`. This is the same pattern
used in ADR-0009 (fail-closed scope) and ADR-0018 (leads IDOR→404).

Cross-enrollment reuse is impossible because the gate verifies the resolved
enrollment's `student.userId` against the JWT `sub` claim. A student cannot supply
another student's `enrollmentId` to escalate access.

### Preview bypass
The `enrollment=null` branch is reachable **only** when `lesson.is_preview === true`.
Stream-url minting is gated separately and requires `enrollment !== null`. Preview
lessons may render text/reading content but cannot mint a signed video URL.

### JWT as sole identity source
`userId` and `tenantId` are always derived from the JWT payload by the `JwtAuthGuard`.
No body, query, or path parameter is trusted for identity resolution.

## Consequences
- Every content endpoint shares one authz path — no per-route authz duplication.
- The 404 posture for unenrolled lessons matches the IDOR→404 pattern used consistently
  across P1 (ADR-0009) and P2 (ADR-0018), giving the platform a uniform security
  posture.
- Cross-student IDOR (a student supplying a different student's enrollmentId) is
  structurally impossible because the gate never accepts a client-supplied enrollmentId.
- Cross-tenant lesson access via the preview path is blocked by the tenant-scoped
  lesson lookup (M-1 fix applied in P3 security remediation).
- Preview lessons that are later un-flagged (`is_preview = false`) immediately become
  enrollment-gated on the next request, with no cache invalidation required.

## Alternatives considered
- **Per-endpoint authz checks**: allows fine-grained variation but creates multiple
  diverging code paths, increasing the attack surface and maintenance burden. Rejected
  — a single gate is easier to audit.
- **Return 403 for unenrolled lessons**: reveals that the lesson exists, which is an
  IDOR. Rejected — 404 is the correct posture.
- **Allow preview via a separate unauthenticated route**: would simplify the auth
  logic for preview but requires a parallel route with its own security surface.
  Rejected — the single gate handles both modes with one code path.
- **Accept enrollmentId from the client**: allows the client to select which
  enrollment to use but creates an IDOR risk if the client can supply arbitrary IDs.
  Rejected — the server always resolves the enrollment from `(userId, programId)`.
