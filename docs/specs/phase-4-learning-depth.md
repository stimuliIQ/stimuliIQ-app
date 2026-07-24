# Spec: Phase 4 — Learning Depth (Assignments, Projects, Assessments, Certificates)

> **Consuming agents:** `db-architect` (#1), `api-designer` (#2), `integrations` (#3, #4),
> `backend-builder` (#6, #7, #8), `frontend-builder` (#9, #10, #11), `qa-engineer` (#12),
> `security-reviewer` (#13).
> This spec is the single authoritative source for acceptance criteria and eligibility
> semantics. Every numbered AC below maps directly to a test in task #12 and a check in
> task #13.

---

## Why

Phase 4 closes the critical learning journey defined in `docs/04 §6`:
**login → watch → submit → certify**. P3 delivered _watch_; P4 delivers _submit_
(assignments, projects, assessments) and _certify_ (eligibility engine, PDF issuance,
public verification).

**Metrics moved:**
- Program completion % (target ≥ 60%) — certificate eligibility requires it.
- Assessment pass % (target ≥ 75%) — gates certificate.
- Certificates issued per month (North Star metric, `docs/00 §6`).
- Certificate issuance time (target < 1 min, `docs/03 §6`).

---

## Users & Roles Affected

| Role | Scope | New capabilities in P4 |
|------|-------|------------------------|
| Student | own enrollments | Submit assignments/projects, take assessments, view grades, download certificate when eligible |
| Faculty / Mentor | assigned batches | Author assignments/assessments/projects, grade submissions, grade descriptive attempts, recommend certificate eligibility |
| Admin / Owner | all | Issue, revoke, reissue certificates; view all submissions/attempts |
| Branch Manager | branch | Issue certificates within branch |
| Ops (Admin role) | all | Issue/revoke/reissue certificates |
| Public (unauthenticated) | n/a | Verify a certificate by `cert_uid` |

RBAC is server-enforced (`@RequirePermission` + `ScopeInterceptor`). The UI hides what the
API forbids. Students never see another student's data; faculty see only assigned-batch data.

---

## Part 1 — Locked Scope Decisions (Gate Confirmations)

The following decisions were set in `docs/plans/phase-4.md §1` as product defaults (Q1–Q7).
They are now **locked** for P4. Any change requires an ADR and re-scoping.

### LOCK-1: Proctoring — Basics Only

**In scope:** question shuffle (server-randomized order per attempt), server-enforced time-box
(`time_expires_at` set server-side from `started_at + time_limit_s`, late submits rejected),
tab-switch flag (client reports switches; stored as `attempts.flags.tabSwitchCount`; does NOT
block or auto-submit — it is a signal for faculty to review).

**Out of scope in P4:** webcam/screen proctoring, lockdown browser enforcement, plagiarism
detection, ML-based cheat detection, IP-binding. These are deferred to a later hardening phase.

**PRD reference:** `docs/02 §7.9` says "anti-cheat basics (shuffle, time-box, tab-switch flag)"
— this lock matches that wording exactly. No PRD conflict.

### LOCK-2: Question Types — MCQ Auto-Grade + Descriptive Manual; No Code Execution

**In scope:** `QuestionType = mcq | descriptive`. MCQ questions have an `answer_key` (stored
server-side only, never in any student-facing DTO or HTTP response). MCQ is auto-graded on
submission server-side. Descriptive answers are stored and queued for manual grading by faculty
using the same rubric surface as assignments.

**Out of scope in P4:** code-execution questions (no sandbox or runner), AI auto-grading of
descriptive answers, peer grading.

**PRD reference:** `docs/02 §7.9` lists "MCQ, code, descriptive" as question types. The PRD's
mention of "code" questions is **a PRD conflict with this gate decision**. Resolution: code
questions require an isolated execution sandbox which is out of P4 scope. The `QuestionType`
enum ships as `mcq | descriptive`; a future phase adds `code` behind the same enum. This is
recorded as a known PRD deviation in `docs/phase-4-followups.md`.

### LOCK-3: Certificate Templates — Seeded Server-Side Set; No Designer UI

**In scope:** a small set of `certificate_templates` rows seeded in `prisma/seed.ts`
(design stored as JSON, rendered by the `CertificatePdfPort`). Ops selects a template at
issuance time from the seeded list.

**Out of scope in P4:** WYSIWYG drag-drop template designer UI (`docs/03 §7.7` mentions
"designer"). The PRD's "designer" capability is **a PRD conflict with this gate decision**.
Resolution: seeded templates are sufficient for MVP issuance; the designer is deferred to P7.
Recorded in `docs/phase-4-followups.md`.

### LOCK-4: Issuance Mode — Sync Single/Small-Batch; Bulk/Auto Deferred

**In scope:** single certificate issuance triggered manually by an authorized user
(`certificates.issue` permission) or in a small batch (≤ batch size of one program's eligible
students, run synchronously). The `CertificateGenPort` seam exists with a
`SyncCertificateGenAdapter` (inline generation).

**Out of scope in P4:** queue-driven bulk auto-issuance at scale. The BullMQ `certificate-gen`
worker is deferred behind the seam (ADR-0020 pattern). The seam is in place; the worker ships
in a later phase.

**PRD reference:** `docs/03 §7.7` says "bulk + auto issuance." This is **a PRD conflict with
this gate decision**. Resolution: the seam makes this a configuration change, not a rewrite.
Recorded in `docs/phase-4-followups.md`.

### LOCK-5: Public Verify Payload — Minimal, No Excess PII

**In scope:** `GET /verify/:certUid` returns `{ valid: boolean | "revoked", program: string,
issuedAt: ISO8601, holderName: string }` for a valid certificate, or `{ valid: "revoked",
program: string, issuedAt: ISO8601, holderName: string }` for a revoked one, or a 404-shaped
error for an invalid/nonexistent `cert_uid`. No internal IDs, no enrollment ID, no student
email, no phone, no payment data are returned.

**Out of scope in P4:** LinkedIn "add to profile" deep API integration; forensic watermarks
burned into the PDF; share beyond a URL + OG-image link.

**No PRD conflict** — `docs/02 §7.11` and `docs/03 §7.7` describe verification but do not
mandate LinkedIn API. The share link + OG-image is satisfied by the public verify page URL.

### LOCK-6: Notifications for Grade/Certificate Events — Deferred to P6

**In scope:** domain events and audit rows are written on grade/issuance. The CRM UI updates
in real time via normal query invalidation.

**Out of scope in P4:** email/WhatsApp/in-app notification fan-out when a grade is posted or
a certificate is ready (`docs/02 §7.15`). Deferred to P6.

**PRD reference:** `docs/02 §7.15` includes "grades, certificate ready" notifications.
This is **a PRD conflict with this gate decision**. Recorded in `docs/phase-4-followups.md`.

---

## Part 2 — Certificate Eligibility Rule (Implementable Definition)

### The Rule

```
isEligible(enrollment) =
  enrollment.progress_pct >= COMPLETION_THRESHOLD
  AND allRequiredAssessmentsPassed(enrollment)
  AND finalProjectApproved(enrollment)
```

This function is the single source of truth consumed by `backend-builder` task #8
(`CertificatesService.isEligible`). All three sub-conditions must be `true`. If any is
`false`, issuance is blocked.

### Sub-condition 1: Completion Threshold

**`enrollment.progress_pct >= 90`**

The threshold is **90%** (not 100%).

Justification: `docs/02 §7.11` states "course completion" as a gate but does not specify a
percentage. `docs/02 §6` targets "Program completion % ≥ 60%" as a success metric (the
external target, not the eligibility bar). `docs/00 §1` describes the journey as "enrolled →
skilled → certified." In practice, a student may have completed all graded lessons but one
optional or supplemental resource; a 100% bar causes certificate-blocking edge cases on
non-content items (e.g., reading resources that are not lesson-completeable). A 90% bar
ensures substantive completion while avoiding over-strictness on non-critical items. If the
product team wishes to enforce 100%, this is a single constant change with no schema impact.

**Implementation:** `enrollment.progress_pct` is the existing P3-computed field on the
`enrollments` table. P4 reads it; it does not recompute it.

**The constant `COMPLETION_THRESHOLD = 90` is stored in the backend config (not hard-coded
inline) so it can be overridden per-tenant if needed in future.**

### Sub-condition 2: All Required Assessments Passed

**`allRequiredAssessmentsPassed(enrollment)` =**
For every `Assessment` where `assessment.is_required = true` that belongs to any `Module`
within the `Program` of this `enrollment`, there exists an `Attempt` where:
- `attempt.enrollment_id = enrollment.id`
- `attempt.passed = true`
- `attempt.submitted_at IS NOT NULL`

**"Required" marking:** the `assessments` table carries a boolean column `is_required`
(default `false`). Faculty/admin set this to `true` when authoring an assessment to mark
it as a certificate gate. An assessment with `is_required = false` is a practice quiz
and does not gate eligibility. This allows a program to have optional quizzes that don't
block certification.

**"Passed" definition:** `attempt.passed = true`. This field is set by the server at
auto-grade time for MCQ-only attempts (when all questions are MCQ). For attempts with
descriptive questions, `passed` remains `null` until faculty manually grades the descriptive
portions and explicitly marks the attempt as passed (`PUT /attempts/:id/grade` with
`{ passed: boolean }`). An attempt with `passed = null` is treated as NOT passing for
eligibility purposes (it fails closed).

**Edge case — multiple attempts:** if `attempts_allowed > 1`, the student passes the
assessment if ANY of their submitted attempts has `passed = true`.

**Edge case — no required assessments:** if the program has zero assessments with
`is_required = true`, this sub-condition evaluates to `true` (vacuously satisfied). This
is intentional — a program with no mandatory assessments should not be blocked by a gate
that doesn't apply to it.

### Sub-condition 3: Final Project Approved

**`finalProjectApproved(enrollment)` =**
There exists a `Submission` where:
- `submission.enrollment_id = enrollment.id`
- `submission.assignment_id` points to an `Assignment` where:
  - `assignment.kind = 'project'`
  - `assignment.is_final = true` (see below)
- `submission.status = 'graded'`
- `submission.score IS NOT NULL`
- The assignment has at least one `AssignmentMilestone` and ALL milestones for this
  enrollment's submissions have `submission.status = 'graded'` (i.e., every milestone
  is reviewed — not just the final one)

**"Final project" marking:** the `assignments` table carries a boolean column `is_final`
(default `false`, only meaningful when `kind = 'project'`). There should be at most one
`Assignment` with `kind = 'project' AND is_final = true` per program. If there are zero
final projects defined (`is_final = true`), this sub-condition evaluates to `true`
(vacuously satisfied), consistent with the assessment rule above.

**"Approved" definition:** a project submission with `status = 'graded'` and a non-null
`score`. There is no separate boolean "approved" field — a graded score is approval.
If the score is 0 and `status = 'graded'`, the project is considered reviewed but
still satisfies the gate (the gate is about completion of review, not about achieving
a minimum project score). If the team wants a minimum project score threshold, that is a
future enhancement.

**All milestones requirement:** every `AssignmentMilestone` row for the project must have
a corresponding `Submission` from this enrollment with `status = 'graded'`. A project with
unreviewed milestones is not considered approved.

**Edge case — project with no milestones:** an `Assignment` with `kind = 'project'` and
no `AssignmentMilestone` rows is treated as a single-submission project. The condition
reduces to: `submission.enrollment_id = enrollment.id AND submission.assignment_id = project.id
AND submission.status = 'graded'`.

### Canonical TypeScript Signature

The backend service implementing this rule must match:

```typescript
async isEligible(enrollmentId: string): Promise<{
  eligible: boolean;
  reasons: {
    completionPct: number;
    completionPassed: boolean;
    requiredAssessmentsPassed: boolean;
    finalProjectApproved: boolean;
  };
}>
```

The `reasons` object enables the CRM eligibility list to show exactly which gate a
student has not yet cleared, without multiple DB round-trips.

---

## Part 3 — User Stories

### Assignments (Student)

- As a student, I can see all assignments for my enrolled courses, each showing its status
  (assigned / submitted / graded / overdue).
- As a student, I can submit an assignment via file upload, text, or link before the due date.
- As a student, I can resubmit an assignment if the faculty allowed resubmission.
- As a student, I can view my grade, rubric breakdown, and feedback once graded.

### Assignments (Faculty)

- As a faculty member, I can create an assignment on a lesson within my assigned batches,
  specifying instructions, attachments, max score, due date, and whether resubmission is
  allowed.
- As a faculty member, I can view all submissions for assignments in my assigned batches.
- As a faculty member, I can grade a submission using a rubric, add feedback, and assign a
  score. I cannot grade submissions outside my assigned batches.
- As a faculty member, I can see a before/after audit when I change a grade.

### Projects (Student)

- As a student, I can submit files and links for each milestone of a project.
- As a student, I can view mentor feedback on each milestone.
- As a student, I can see the overall project review state (submitted / under review /
  graded).

### Projects (Faculty)

- As a faculty member, I can define project milestones with due dates when authoring a
  project assignment.
- As a faculty member, I can review each milestone submission, add feedback, and mark it
  graded.
- As a faculty member, I can mark a project as approved (by grading it) to unblock
  certificate eligibility for that student.

### Assessments (Student)

- As a student, I can see available assessments for my enrolled courses with attempt status.
- As a student, I can start a timed assessment; the timer runs server-side and the
  assessment auto-submits on expiry.
- As a student, I can see my instant score for MCQ questions after submission.
- As a student with remaining attempts, I can start a new attempt on the same assessment.
- As a student, I cannot see the correct answers or answer key for MCQ questions at any
  point during or after an attempt.

### Assessments (Faculty)

- As a faculty member, I can create an assessment with MCQ and descriptive questions,
  setting `pass_pct`, `time_limit_s`, `attempts_allowed`, `shuffle`, and `is_required`.
- As a faculty member, I can manually grade descriptive answers for my assigned batches.
- As a faculty member, I can mark an attempt as passed or failed after grading all
  descriptive questions.

### Certificates (Student)

- As a student, I can see my certificate status in the LMS (not yet eligible / eligible /
  issued).
- As a student who has been issued a certificate, I can download a signed PDF.
- As a student who has not yet met eligibility criteria, the download button is absent or
  disabled and the reason is shown.
- As a student, I can copy a shareable verification link for my certificate.

### Certificates (Ops/Admin)

- As an ops user, I can see the eligibility status for each student (which of the three
  gates they have or have not cleared).
- As an ops user, I can issue a certificate for an eligible student.
- As an ops user, I can revoke a certificate with a stated reason; revocation takes effect
  immediately.
- As an ops user, I can reissue a revoked certificate.

### Certificates (Faculty)

- As a faculty member, I can recommend a student for a certificate (flag, does not issue).

### Public Verification

- As any user (unauthenticated), I can enter a `cert_uid` or visit the verify URL and see
  whether the certificate is valid or revoked, along with the program name, issue date, and
  holder name.
- If I enter a fabricated or tampered `cert_uid`, I receive a clear "not found / invalid"
  response with no server internals exposed.

---

## Part 4 — Acceptance Criteria (Given / When / Then)

### AC-A: Assignments — Submit

**AC-A1 — Student submits assignment (file)**
Given a student with an active enrollment and an assignment in status `assigned`,
When the student POSTs to `POST /assignments/:id/submit` with a valid storage key (obtained
via the signed upload URL flow), text, or link,
Then the response is 201, a `Submission` row is created with `status = 'submitted'`,
`enrollment_id` matching the student's enrollment, and `attempt_no = 1`.

**AC-A2 — Student cannot submit after due date (no resubmit flag needed)**
Given an assignment where `due_at` is in the past,
When a student attempts to submit,
Then the API returns 422 with error code `ASSIGNMENT_OVERDUE`.

**AC-A3 — Student cannot submit to an assignment not in their enrolled program**
Given a student enrolled in Program A,
When they attempt to submit to an assignment belonging to a lesson in Program B,
Then the API returns 404 (IDOR-safe, no information leakage about Program B).

**AC-A4 — Resubmission allowed**
Given an assignment with `allow_resubmit = true` and an existing submission with
`status = 'graded'` or `status = 'returned'`,
When the student submits again,
Then a new `Submission` row is created with `attempt_no = previous + 1`, `status = 'submitted'`.

**AC-A5 — Resubmission blocked**
Given an assignment with `allow_resubmit = false` and an existing submission,
When the student attempts to submit again,
Then the API returns 409 with error code `RESUBMIT_NOT_ALLOWED`.

**AC-A6 — Resubmit after graded (not blocked by status, blocked by flag)**
Given an assignment with `allow_resubmit = false` and `submission.status = 'graded'`,
When the student attempts to submit again,
Then the API returns 409 (the graded status alone does not re-open submission; only
`allow_resubmit = true` does).

### AC-B: Assignments — Grade

**AC-B1 — Faculty grades a submission in assigned batch**
Given a faculty member with `submissions.grade` permission and a submission in a batch
assigned to them,
When they PUT `{ score, rubric, feedback }` to `PATCH /submissions/:id/grade`,
Then the submission `status` becomes `graded`, `score`, `rubric`, `feedback`, `graded_by`,
and `graded_at` are set, and an audit log entry is written with `before` (prior status/score)
and `after` (new values).

**AC-B2 — Faculty cannot grade a submission in an unassigned batch**
Given a faculty member and a submission belonging to a batch not assigned to them,
When they attempt to grade it,
Then the API returns 403.

**AC-B3 — Grade change is audited**
Given a submission that was already graded (score = 80),
When a faculty member re-grades it (score = 90),
Then the audit log entry for this action contains `before: { score: 80 }` and
`after: { score: 90 }`.

**AC-B4 — Student cannot grade their own submission**
Given a student with a submitted assignment,
When they attempt to call the grade endpoint,
Then the API returns 403.

**AC-B5 — Student views grade and feedback**
Given a submission with `status = 'graded'`,
When the student calls `GET /assignments/:id/my-submission`,
Then the response includes `score`, `rubric`, and `feedback` and does NOT include
other students' submission data.

### AC-C: Projects — Milestones

**AC-C1 — Student submits a milestone**
Given a project assignment with milestones and the student has an active enrollment,
When the student submits to `POST /assignments/:id/milestones/:milestoneId/submit`,
Then a `Submission` row is created with `milestone_id` set and `status = 'submitted'`.

**AC-C2 — Faculty reviews a milestone**
Given a milestone submission in the faculty's assigned batch,
When the faculty grades the milestone with `PATCH /submissions/:id/grade`,
Then the submission `status` becomes `graded`.

**AC-C3 — Final project eligibility gate**
Given a project with `is_final = true` and two milestones, and the student has graded
submissions for both milestones,
When `isEligible(enrollment)` is evaluated,
Then `finalProjectApproved = true`.

**AC-C4 — Ungraded milestone blocks eligibility**
Given a project with `is_final = true` and two milestones, and only one milestone is graded,
When `isEligible(enrollment)` is evaluated,
Then `finalProjectApproved = false`.

### AC-D: Assessments — Take

**AC-D1 — Student starts an attempt**
Given an assessment with `time_limit_s = 1800` and `attempts_allowed = 2` and the student
has 0 prior attempts,
When the student POSTs to `POST /assessments/:id/attempts`,
Then a new `Attempt` row is created, `started_at` = server time, `time_expires_at` =
`started_at + 1800s`, and the response includes `time_expires_at` and the questions
(without `answer_key` or any `is_correct` field).

**AC-D2 — Answer key is never in student response**
Given an in-progress attempt,
When the student calls `GET /attempts/:id` or `POST /assessments/:id/attempts`,
Then the JSON response body MUST NOT contain any of: `answerKey`, `answer_key`,
`isCorrect`, `is_correct`, `correctOption`. This is asserted at the DTO type level
and by an integration test scanning the raw response JSON.

**AC-D3 — Student submits answers before expiry**
Given an in-progress attempt where `time_expires_at` is in the future,
When the student PUTs `{ answers: [...] }` to `PUT /attempts/:id`,
Then MCQ questions are auto-graded server-side, `score` is computed, `passed` is set
(`score / max_score >= assessment.pass_pct / 100`), `submitted_at` is set, and the
response includes `score` and `passed`.

**AC-D4 — Server rejects submission after expiry**
Given an in-progress attempt where `time_expires_at` has passed,
When the student attempts to submit answers,
Then the API returns 422 with error code `ATTEMPT_EXPIRED`. The server does NOT
use the client-supplied timestamp; it uses `NOW()` to compare against `time_expires_at`.

**AC-D5 — Attempts limit enforced**
Given an assessment with `attempts_allowed = 1` and the student has one submitted attempt,
When the student attempts to start a new attempt,
Then the API returns 422 with error code `ATTEMPTS_EXHAUSTED`.

**AC-D6 — Tab-switch is flagged, not blocked**
Given an in-progress attempt,
When the client sends `PATCH /attempts/:id/flag` with `{ event: 'tab_switch' }`,
Then `attempts.flags.tabSwitchCount` is incremented by 1, and the attempt is NOT
auto-submitted or terminated.

**AC-D7 — Idempotent submit**
Given a submitted attempt (already has `submitted_at`),
When the client replays the same PUT to `PUT /attempts/:id`,
Then the API returns 200 with the existing result and does NOT recompute the grade
or create a duplicate audit entry.

**AC-D8 — Shuffle is server-side**
Given an assessment with `shuffle = true`,
When two different students start attempts,
Then the question order in each response may differ. The order is determined server-side
and stored (or deterministically re-derived from a per-attempt seed) — not trusted from
the client.

**AC-D9 — Descriptive attempt pending manual grade**
Given an assessment with at least one descriptive question,
When the student submits answers,
Then `attempt.passed` remains `null` and `score` is partial (MCQ-only auto-scored points).
The attempt is visible to faculty for manual grading.

**AC-D10 — Student cannot read another student's attempt**
Given Student A and Student B with separate attempts on the same assessment,
When Student A calls `GET /attempts/:id` using Student B's attempt ID,
Then the API returns 404.

### AC-E: Certificates — Eligibility and Issuance

**AC-E1 — Issuance blocked when ineligible (incomplete course)**
Given an enrollment where `progress_pct = 85` (below the 90% threshold),
When an ops user attempts to issue a certificate,
Then the API returns 422 with error code `NOT_ELIGIBLE` and `reasons.completionPassed = false`.

**AC-E2 — Issuance blocked when required assessment not passed**
Given an enrollment where `progress_pct = 95` and a required assessment where no attempt
has `passed = true`,
When an ops user attempts to issue a certificate,
Then the API returns 422 with error code `NOT_ELIGIBLE` and
`reasons.requiredAssessmentsPassed = false`.

**AC-E3 — Issuance blocked when final project not approved**
Given an enrollment where `progress_pct = 95`, all required assessments passed, but the
final project has a milestone with `submission.status != 'graded'`,
When an ops user attempts to issue a certificate,
Then the API returns 422 with error code `NOT_ELIGIBLE` and
`reasons.finalProjectApproved = false`.

**AC-E4 — Certificate issued when all gates pass**
Given an enrollment meeting all three eligibility conditions,
When an ops user issues a certificate via `POST /certificates`,
Then a `Certificate` row is created with `status = 'valid'`, `cert_uid` (a verifiable
signed hash), `storage_key` (pointing to the generated PDF in StorageProvider), `issued_at`,
and `issued_by`. An audit log entry is written. Exactly one certificate exists per
enrollment (unique constraint on `enrollment_id`).

**AC-E5 — Faculty can recommend but not issue**
Given a faculty member with `certificates.recommend` permission but not `certificates.issue`,
When they call the recommend endpoint for an eligible student,
Then the student's record is flagged as recommended (a field/event in the eligibility list),
and no `Certificate` row is created.
When the same faculty member attempts to call the issue endpoint,
Then the API returns 403.

**AC-E6 — Only one certificate per enrollment**
Given a student who already has a valid certificate for an enrollment,
When an ops user attempts to issue another certificate for the same enrollment,
Then the API returns 409 with error code `CERTIFICATE_ALREADY_EXISTS`.

### AC-F: Certificates — Download

**AC-F1 — Student can download own certificate when issued**
Given a student with a certificate in `status = 'valid'`,
When they call `GET /me/certificates/:id/download`,
Then the response includes a short-lived signed URL pointing to the PDF in StorageProvider.
The URL expires and cannot be reused.

**AC-F2 — Download blocked when not yet issued**
Given a student who is eligible but whose certificate has not yet been issued,
When they call the download endpoint,
Then the API returns 404 (no certificate row exists yet — the LMS UI shows "pending issuance"
based on eligibility status, not certificate existence).

**AC-F3 — Download blocked for ineligible student**
Given a student who has not met eligibility criteria,
When they attempt to call the download endpoint,
Then the API returns 404.

**AC-F4 — Student cannot download another student's certificate**
Given Student A and Student B,
When Student A calls `GET /me/certificates/:id/download` using Student B's certificate ID,
Then the API returns 404.

**AC-F5 — Revoked certificate download returns revoked status**
Given a certificate with `status = 'revoked'`,
When the student calls the download endpoint,
Then the API returns 410 (Gone) with error code `CERTIFICATE_REVOKED`. The PDF file is
NOT accessible (StorageProvider signed URL is not minted for revoked certificates).

### AC-G: Certificates — Revoke and Reissue

**AC-G1 — Ops revokes a certificate**
Given a certificate in `status = 'valid'`,
When an ops user calls `PATCH /certificates/:id/revoke` with `{ reason: "..." }`,
Then `certificate.status` becomes `revoked`, `revoked_reason`, `revoked_by`, and
`revoked_at` are set, and an audit log entry is written.

**AC-G2 — Revocation is instant**
Given that a certificate was revoked (as in AC-G1),
When the public verify endpoint is called immediately after with the same `cert_uid`,
Then the response contains `valid: "revoked"`. There is no cache window during which
`valid: true` is returned for a revoked certificate.

**AC-G3 — Ops reissues a revoked certificate**
Given a certificate in `status = 'revoked'`,
When an ops user calls `POST /certificates/:enrollmentId/reissue`,
Then a new `Certificate` row is created (the old row is soft-deleted), `status = 'valid'`,
a new `cert_uid` is generated (the old `cert_uid` no longer resolves to valid), and an
audit log entry is written.

**AC-G4 — Old cert_uid invalid after reissue**
Given a reissued certificate (AC-G3),
When the public verify endpoint is called with the OLD `cert_uid`,
Then the response is 404 (not found / invalid) because the old row is soft-deleted.

### AC-H: Public Certificate Verification

**AC-H1 — Valid certificate resolves correctly**
Given a certificate with `status = 'valid'` and `cert_uid = X`,
When an unauthenticated request is made to `GET /verify/X`,
Then the response is 200 with body `{ valid: true, program: "<program name>",
issuedAt: "<ISO8601>", holderName: "<full name>" }`. No other fields are present.

**AC-H2 — Revoked certificate resolves as revoked**
Given a certificate with `status = 'revoked'` and `cert_uid = X`,
When an unauthenticated request is made to `GET /verify/X`,
Then the response is 200 with body `{ valid: "revoked", program: "<program name>",
issuedAt: "<ISO8601>", holderName: "<full name>" }`.

**AC-H3 — Fabricated cert_uid is rejected**
Given a `cert_uid` that was not generated by the server (e.g., a random UUID or a
manipulated value),
When an unauthenticated request is made to `GET /verify/<fabricated>`,
Then the response is 404. The signature verification step rejects it before any DB
fields are returned. No server internals, enrollment IDs, student IDs, or error details
are exposed.

**AC-H4 — Tampered cert_uid is rejected**
Given a real `cert_uid` from a valid certificate where the attacker flips one character,
When an unauthenticated request is made to `GET /verify/<tampered>`,
Then the response is 404. The HMAC/signature check fails before the DB is queried.

**AC-H5 — Nonexistent cert_uid returns 404**
Given a well-formed signed `cert_uid` that passed signature verification but no
corresponding row exists in the `certificates` table,
When an unauthenticated request is made,
Then the response is 404.

**AC-H6 — Rate limiting on public verify**
Given an IP address making more than the configured threshold of verify requests per minute,
When the next request arrives,
Then the API returns 429 with `Retry-After` header. The threshold is configured via
environment variable, not hard-coded.

**AC-H7 — No PII beyond holder name in verify response**
Given any certificate verification response (valid or revoked),
The response body MUST NOT contain: email address, phone number, enrollment ID, student
ID, payment information, batch name, faculty name, or any data not in the explicit
`VerifyResult` DTO (`{ valid, program, issuedAt, holderName }`). This is asserted by
an integration test that checks all keys present in the response.

**AC-H8 — Public verify requires no authentication**
Given an unauthenticated HTTP client (no cookies, no Authorization header),
When they call `GET /verify/:certUid`,
Then the server processes the request normally (no 401 returned for missing auth).

### AC-I: StorageProvider — Signed Upload/Download

**AC-I1 — Signed upload URL is scoped and short-lived**
Given a student requesting an upload URL for a submission,
When they call `POST /storage/upload-url` with `{ contentType, fileName }`,
Then the response contains a signed PUT URL with:
- Key scoped to `submissions/{tenantId}/{enrollmentId}/...`
- TTL ≤ 15 minutes
- Content-type constraint matching the requested type
- Max-size constraint as configured

**AC-I2 — Raw bucket URL is never returned**
Given any API endpoint that deals with stored files (submission files, certificate PDFs,
resources, invoices),
When the API responds with a download reference,
Then the response contains a short-lived signed URL, NEVER a raw `https://<bucket>.s3.amazonaws.com/...`
or `https://<account>.r2.cloudflarestorage.com/...` URL.

**AC-I3 — StorageProvider fails closed when unconfigured**
Given `STORAGE_PROVIDER` env var is not set or set to `noop`,
When code attempts a real upload or download via the StorageProvider,
Then the NoopStorageProvider returns deterministic fake signed URLs (for tests/local) and
the real S3 adapter is not instantiated. No upload attempt is made to a real bucket.

### AC-J: Security and RBAC Boundaries

**AC-J1 — Student cannot access another student's submission**
Given Student A's submission ID,
When Student B calls `GET /submissions/:id`,
Then the API returns 404.

**AC-J2 — Student cannot submit to a program they are not enrolled in**
As described in AC-A3.

**AC-J3 — Faculty cannot grade outside assigned batches**
As described in AC-B2.

**AC-J4 — Cross-tenant isolation on submissions**
Given Tenant A student with submission ID X and Tenant B user,
When Tenant B user calls `GET /submissions/X` (even with admin scope for Tenant B),
Then the API returns 404 (tenant_id filter is applied at query level before RBAC check).

**AC-J5 — Cross-tenant isolation on attempts**
Same as AC-J4, applied to `attempts` table.

**AC-J6 — Cross-tenant isolation on certificates**
Same as AC-J4, applied to `certificates` table.

**AC-J7 — Student cannot self-grade**
Given a student,
When they call any grade or mark-passed endpoint,
Then the API returns 403 regardless of the payload.

**AC-J8 — DOMPurify is applied to student-submitted content**
Given a submission with `text` containing `<script>alert(1)</script>`,
When the CRM grading view or the LMS feedback view renders this text,
Then the rendered HTML does NOT execute the script. The raw `<script>` tag is stripped
or escaped by DOMPurify before rendering.

**AC-J9 — Answer key never appears in any HTTP response to a student**
Given a student with an active session,
When they call any endpoint related to assessments or attempts,
Then scanning the full HTTP response body for the strings `answerKey`, `answer_key`,
`isCorrect`, `is_correct`, `correctOption`, `correct_option` returns zero matches.
This is verified by the integration test suite on the raw response JSON, not just TS types.

---

## Part 5 — Edge Cases and Error States

### Assignments

| Scenario | Expected behavior |
|----------|-------------------|
| Submit after due date | 422 `ASSIGNMENT_OVERDUE` |
| Submit with no enrollment | 404 |
| Submit file with disallowed content-type | 422 `INVALID_CONTENT_TYPE` (server validates against the StorageProvider upload policy, not just client-side) |
| Resubmit when `allow_resubmit = false` | 409 `RESUBMIT_NOT_ALLOWED` |
| Resubmit when `allow_resubmit = true` but previous submission is `status = 'submitted'` (not yet graded) | 409 `PREVIOUS_SUBMISSION_PENDING` — student must wait for grading before resubmitting, to avoid grading the wrong version |
| Grade a soft-deleted submission | 404 |
| Faculty views submissions for a batch after being unassigned | 0 results (scope query updated) |
| Assignment has no submissions | Empty list with `meta.total = 0`, not an error |

### Assessments / Attempts

| Scenario | Expected behavior |
|----------|-------------------|
| Submit after `time_expires_at` | 422 `ATTEMPT_EXPIRED` |
| Start attempt when `attempts_allowed` exhausted | 422 `ATTEMPTS_EXHAUSTED` |
| Start attempt when previous attempt is still in-progress (not submitted, not expired) | 422 `ATTEMPT_IN_PROGRESS` — only one active attempt at a time |
| Submit with partial answers (some questions unanswered) | Accepted; unanswered MCQ questions score 0; unanswered descriptive questions are stored as empty |
| Replay the same PUT to submit answers | 200 with cached result, no re-grade (idempotent) |
| Attempt time expires while student is mid-answer | Server accepts no further submissions after expiry; the student's in-progress attempt is marked expired on next server interaction; client-side timer is advisory only |
| Assessment deleted after attempt started | Attempt remains; submission completes against snapshot; 404 on new attempt start |
| All descriptive questions, no MCQ | `score = 0`, `passed = null` until manual grade; no auto-grade runs |
| Assessment with `time_limit_s = null` | No expiry enforced; `time_expires_at = null`; attempt never auto-expires |
| Faculty tries to manually grade an MCQ-only attempt | 422 `MANUAL_GRADE_NOT_APPLICABLE` — MCQ is auto-graded and not re-gradeable manually |

### Certificates / Verification

| Scenario | Expected behavior |
|----------|-------------------|
| Issue for ineligible student | 422 `NOT_ELIGIBLE` with `reasons` object |
| Issue when certificate already exists and is valid | 409 `CERTIFICATE_ALREADY_EXISTS` |
| Issue when certificate exists but is revoked | Ops must use the reissue endpoint instead; 409 if issue endpoint is used |
| Revoke a certificate that is already revoked | 409 `ALREADY_REVOKED` |
| Download a revoked certificate | 410 `CERTIFICATE_REVOKED` |
| Download a certificate that does not exist (no row) | 404 |
| Student downloads certificate before eligibility is reached | 404 (no row) |
| Public verify with fabricated `cert_uid` | 404 (signature mismatch) |
| Public verify with revoked `cert_uid` | 200 `{ valid: "revoked", ... }` |
| Public verify with nonexistent but validly-signed `cert_uid` | 404 |
| Public verify called 100+ times/min from same IP | 429 `RATE_LIMIT_EXCEEDED` |
| Eligibility re-evaluated after cert issued (progress dropped due to future course change) | Certificate remains valid; eligibility is checked only at issuance time, not retroactively. Revoke is a manual ops action. |
| `allRequiredAssessmentsPassed` with zero required assessments | Returns `true` (vacuously) |
| `finalProjectApproved` with no final project defined | Returns `true` (vacuously) |
| Enrollment has `progress_pct = 90` (exactly at threshold) | Eligible (threshold is inclusive: `>= 90`) |

### StorageProvider

| Scenario | Expected behavior |
|----------|-------------------|
| Upload URL requested but StorageProvider unconfigured | NoopStorageProvider returns deterministic fake URL; no real upload occurs |
| Upload URL TTL expires before student uploads | Student must request a new URL; server does not re-use the expired URL |
| Malicious file upload (e.g., executable disguised as PDF) | Server enforces content-type constraint on signed URL; cloud provider rejects mismatched content-type on PUT. AV scanning is tracked as a follow-up item. |
| Storage key path traversal attempt (e.g., `../../certs/`) | Server rejects keys not matching `submissions/{tenantId}/{enrollmentId}/...` pattern |

---

## Part 6 — Out of Scope (Explicitly Excluded from P4)

The following are confirmed out of scope for P4 and are tracked in
`docs/phase-4-followups.md`:

1. **Webcam/screen proctoring, lockdown browser, plagiarism detection** — deferred to
   hardening phase.
2. **Code-execution questions** (requires sandboxed runner) — deferred.
3. **AI auto-grading of descriptive answers** — deferred to P8.
4. **Certificate template designer UI** (WYSIWYG drag-drop) — deferred to P7.
5. **Bulk/auto queue-driven certificate issuance at scale** — BullMQ `certificate-gen`
   worker deferred (seam present in P4).
6. **LinkedIn "add to profile" deep API integration** — shareable URL only.
7. **Forensic watermarks burned into certificate PDF** — not in P4.
8. **Grade/certificate-ready notifications via email, WhatsApp, in-app** — deferred to P6.
9. **Assessment question analytics / topic-based weakness analysis** — deferred to P7.
10. **Peer grading or co-review** — not in scope.
11. **Assignment versioning** (multiple versions of the same assignment) — not in scope.
12. **Certificate sharing to social platforms beyond a URL** — share = URL only.
13. **AV scanning on uploaded files** — tracked as a follow-up security item.
14. **Any other `web` marketing pages** — P4 adds ONLY `web/app/verify/[certId]/page.tsx`.
15. **Live classes / `LiveClassProvider`** — still deferred.

---

## Part 7 — Data and Permissions Impact

### New Tables

| Table | `tenant_id` | Soft-delete | Audit-logged mutations |
|-------|-------------|-------------|----------------------|
| `assignments` | yes | yes | create, edit |
| `assignment_milestones` | yes | yes | create, edit |
| `submissions` | yes | yes | submit, grade (before/after), return |
| `assessments` | yes | yes | create, edit |
| `assessment_questions` | yes | yes | create, edit |
| `attempts` | yes | yes | start, submit, manual-grade |
| `certificates` | yes | yes (reissue soft-deletes old) | issue, revoke, reissue |
| `certificate_templates` | yes | yes | create, edit |

### New Columns on Existing Tables

- `assignments.is_final` (boolean, default false) — marks the certificate-gate project.
- `assessments.is_required` (boolean, default false) — marks assessment as eligibility gate.

Both columns have a documented seeding convention: `is_required` and `is_final` default to
`false` and must be explicitly set. This ensures backward compatibility if migrated into a
program with no eligibility gates.

### RBAC Permissions (new entries in `role_permissions`)

| Permission | Student | Faculty | Branch Mgr | Admin/Owner | Finance | Support |
|------------|:-------:|:-------:|:----------:|:-----------:|:-------:|:-------:|
| `assignments.view` | own | assigned | branch | all | — | — |
| `assignments.create` | — | assigned | branch | all | — | — |
| `assignments.edit` | — | assigned | branch | all | — | — |
| `submissions.view` | own | assigned | branch | all | — | — |
| `submissions.create` | own | — | — | — | — | — |
| `submissions.grade` | — | assigned | — | all | — | — |
| `projects.review` | — | assigned | branch | all | — | — |
| `assessments.view` | own | assigned | branch | all | — | — |
| `assessments.create` | — | assigned | branch | all | — | — |
| `assessments.edit` | — | assigned | branch | all | — | — |
| `attempts.take` | own | — | — | — | — | — |
| `attempts.view` | own | assigned | branch | all | — | — |
| `attempts.grade` | — | assigned | — | all | — | — |
| `certificates.recommend` | — | assigned | — | — | — | — |
| `certificates.issue` | — | — | branch | all | — | — |
| `certificates.revoke` | — | — | — | all | — | — |
| `certificates.view` | own | assigned | branch | all | — | — |
| `certificates.verify` | public | public | public | public | public | public |

### Faculty `assigned` Scope Resolution (resolves ADR-0009 deferral)

Faculty `assigned` scope for grading is resolved by: `submission → enrollment → batch →
batch.faculty_id = currentUser.id`. A faculty member may grade a submission if and only if
the submission's enrollment's batch has `faculty_id` matching the authenticated faculty
user. This is implemented in the `ScopeInterceptor`/scope-resolver helper and tested
explicitly in the integration suite.

### Data Scope Expectations

- Students call `GET /me/...` routes — the `enrollment_id` is resolved from the
  authenticated user's session and cannot be overridden by a query parameter.
- Faculty and ops call resource-level routes — the `ScopeInterceptor` injects
  `tenant_id` + scope filter before the repository layer.
- The public verify endpoint (`GET /verify/:certUid`) is unauthenticated. `tenant_id`
  is resolved from the `cert_uid` signature payload (the tenant is embedded in the
  signed hash). No tenant header is trusted from the client.

---

## Part 8 — Dependencies (Agents and Modules)

| Dependency | Source | Consumed by |
|------------|--------|-------------|
| `enrollment.progress_pct` | P3 LMS module (`enrollments` table, P3-computed) | Backend #8 eligibility engine |
| `StorageProvider` interface | Integrations task #3 | Backend #6 (submissions), #8 (certificates), #10 (LMS download), #9 (CRM grading) |
| `CertificatePdfPort` + `cert_uid` signing | Integrations task #4 | Backend #8 |
| `@repo/types` DTOs | API designer task #2 | All backend + frontend |
| `@repo/ui` primitives (FileUpload, RubricGrader, QuizRunner, CertificateCard, CountdownTimer) | Design system task #5 | Frontend #9, #10 |
| `PermissionsGuard` + `ScopeInterceptor` + `@RequirePermission` | P0/P1 auth/RBAC module | All backend tasks #6, #7, #8 |
| Audit Prisma extension | P0/P1 | All new tables |
| Soft-delete Prisma extension | P0 | All new tables |
| `assessments.is_required` column | db-architect task #1 | Backend #7 (author), #8 (eligibility) |
| `assignments.is_final` column | db-architect task #1 | Backend #6 (author), #8 (eligibility) |
| P4 permission matrix seed | db-architect task #1 | All RBAC guards |

---

## PRD Conflict Log

| Conflict ID | PRD section | PRD says | P4 gate decision | Resolution |
|-------------|-------------|----------|-----------------|------------|
| CONFLICT-1 | `docs/02 §7.9` | "MCQ, code, descriptive" question types | Code questions OUT of P4 | Code requires sandbox; deferred. `QuestionType` enum extensible. Tracked in followups. |
| CONFLICT-2 | `docs/03 §7.7` | "Certificate templates (designer)" | Seeded templates only; no designer UI | Designer is P7 scope. Seeded templates unblock issuance. Tracked in followups. |
| CONFLICT-3 | `docs/03 §7.7` | "bulk + auto issuance" | Sync single/small-batch only | BullMQ worker seam present; bulk is a configuration change. Tracked in followups. |
| CONFLICT-4 | `docs/02 §7.15` | Grade + certificate-ready notifications | Notifications fan-out deferred to P6 | Domain events + audit rows written; fan-out is P6. Tracked in followups. |

---

*Spec authored by `product-manager` for Phase 4, Task #0. Effective date: 2026-07-02.*
