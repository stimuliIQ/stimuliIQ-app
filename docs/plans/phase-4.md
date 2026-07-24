# Plan: Phase 4 — Learning Depth ("P4")

> Scope boundary (`CLAUDE.md §6`): **"P4 Learning depth: assignments, projects, assessments,
> certificates + verification."** This plan delivers exactly that, end-to-end (schema →
> contracts → StorageProvider → backend → CRM authoring/grading + LMS student surface →
> public verify on `web` → tests → security → docs) and **does not** plan ahead into P5
> (marketing website funnel — except the one **public certificate-verify page**, which P4
> owns because it is the terminus of the certificate journey), P6 (notifications / WhatsApp /
> email / campaigns / forum / gamification), or P7 (analytics dashboards / load test).
>
> **This completes the `docs/04 §6` critical journey `login → watch → submit → certify`.**
> P3 delivered **watch**; P4 delivers **submit** (assignments/projects/assessments) **and
> certify** (eligibility → issuance → public verification).

---

## P3 verification (done before planning — report gaps, no rework)

**P3 (LMS core) is GREEN and gates open to P4.** Confirmed from `docs/plans/phase-3.md`,
`docs/phase-3-followups.md`, and the shipped `apps/api/src/modules/lms/*`:
**391 unit + 158 integration tests** (1 skipped), 11 suites; CI runs
`install → typecheck → lint → unit → integration → build → e2e`. Wave-7 security review
returned **Conditional GO → GO** after the M-1 fix (`findLessonById` now tenant-scoped);
**no Critical/High left open**. ADRs 0021–0026 recorded.

**Gaps carried from P3 that P4 MUST honor or resolve (from `docs/phase-3-followups.md`):**
- **StorageProvider is NOT wired.** P2's invoice-gen still stubs `storageKey: null`
  (`apps/api/src/modules/commerce/invoice-gen.seam.ts`), and P3's lesson-`resources`
  download URLs are a "Coming Soon" stub. **P4 introduces the `StorageProvider` interface**
  (S3/R2, signed upload + signed download) as its own wave — it is the hard dependency for
  submission file uploads, certificate PDFs, and (opportunistically) invoice/resources PDFs.
- **No PDF-generation library is installed.** The certificate engine (`docs/04 §2.11`) needs
  HTML→PDF. **This is flagged as ASK-USER-BEFORE-INSTALL** (see "Secrets / dependencies").
- **`dangerouslySetInnerHTML` in `lesson-detail-content.tsx` (L-2)** — was acceptable for
  faculty-authored reading content. **P4 widens authored content to student-submitted
  text/links (assignment/project submissions, descriptive assessment answers).** This
  crosses the trust boundary flagged in L-2 → **sanitize (DOMPurify) on any render of
  student-submitted content** is now in scope (security-reviewer gate).
- **BullMQ still deferred behind `Sync*Adapter` ports** (ADR-0020). P4 certificate
  generation reuses the same seam: a `CertificateGenPort` bound to a `SyncCertificateGenAdapter`
  (inline generation) with the BullMQ `certificate-gen` worker deferred (`docs/04 §2.8`).
- **Cross-tenant IDOR integration test debt (S1-3)** persists (single-tenant harness). P4
  adds five fresh IDOR surfaces (submissions, attempts, certificates) — security review
  MUST exercise cross-student + cross-tenant on the new tables.
- **`assigned`-scope fail-closed for faculty (ADR-0009, no `programs.created_by`)** was
  deferred through P3 because P3 was student-side consumption. **P4 is the first faculty
  *authoring/grading* surface** (assignments, rubric grading, project review, assessment
  authoring, certificate recommend/issue). Faculty `assigned`-scope now becomes load-bearing
  (a faculty member grades only submissions in **their assigned batches**). This must be
  resolved here — see Risk #1.

None of these block the P4 GO; they are folded into the relevant P4 tasks below.

---

## 1. Scope statement + what is explicitly OUT of P4

### In scope (the P4 headline)
1. **Assignments** (`docs/02 §7.5`, `docs/03 §7.8`): faculty author assignments on a lesson
   (instructions, attachments, `max_score`, `due_at`, `allow_resubmit`); student sees status
   (assigned/submitted/graded/overdue), submits (**file upload via StorageProvider** / text /
   link), resubmits if allowed; faculty grades with a **rubric** + feedback; student views
   grade + rubric + feedback. Grade changes audited.
2. **Projects** (`docs/02 §7.6`): multi-milestone submissions (repo/link + files), mentor
   review states, feedback threads; **final project approval gates certificate eligibility**.
   Modeled as assignments with a `kind=project` discriminator + milestone rows (see schema).
3. **Assessments / quizzes** (`docs/02 §7.9`, `docs/03 §7.8`): faculty author a timed
   assessment on a module (MCQ + descriptive; **code = OUT, see below**), question bank,
   `pass_pct`, `attempts_allowed`, `time_limit_s`; student takes an attempt (timed, shuffle,
   tab-switch flag), **auto-grade objective (MCQ)** with instant score, descriptive queued
   for manual grade; pass threshold feeds certificate eligibility. **Answer key never leaves
   the server for an in-progress or objective attempt.**
4. **Certificates + verification** (`docs/02 §7.11`, `docs/03 §7.7`, `docs/04 §2.11`):
   eligibility rules engine (course completion + assessments passed + final project approved)
   → render template (**HTML→PDF**, lib TBD/ASK-USER) → assign **verifiable ID** = signed
   hash of `(student, program, issued_at, nonce)` → store PDF via **StorageProvider** → row
   in `certificates`; student one-click **download (signed URL)**; **public verify page on
   `web`** resolves `cert_uid` → `{valid|revoked}` + minimal non-PII proof; faculty
   **recommend**, ops **issue/revoke/reissue** (RBAC per `docs/03 §9`). Revocation
   invalidates instantly.
5. **StorageProvider** (`docs/04 §2.10`, `docs/05 §7`): the S3/R2 interface (signed
   PUT upload + signed GET download, both short-TTL, scoped keys `submissions/{tenant}/…`,
   `certificates/{tenant}/…`) behind a DI token + Noop, fail-closed until keys — exactly the
   VideoProvider/PaymentProvider pattern. **Wires the P2 invoice + P3 resources download
   stubs opportunistically** (cheap once the provider exists).

### Explicitly OUT of P4 (gate decisions — keep tight)
- **Proctoring / anti-cheat beyond basics.** P4 ships only `docs/02 §7.9` **basics**:
  question **shuffle**, server-enforced **time-box**, **tab-switch flag** stored on the
  attempt. Webcam/screen proctoring, lockdown browser, plagiarism/ML detection = **OUT**
  (a later hardening phase). *Default: basics only.*
- **AI / auto grading of descriptive & code answers.** Objective **MCQ auto-grading only**.
  Descriptive answers are **manually graded** by faculty (same rubric surface as
  assignments). **Code-execution questions are OUT** (no sandbox/runner in P4) — question
  types are **MCQ + descriptive** this phase. *Default: MCQ auto + descriptive manual, no code.*
- **Certificate template *designer* UI** (`docs/03 §7.7` "designer"). P4 ships a small set
  of **seeded server-side templates** (`certificate_templates.design` JSON) + issuance/revoke;
  the drag-drop WYSIWYG designer is **OUT** (P7/admin depth). *Default: seeded templates.*
- **Bulk / auto issuance at scale** (`docs/03 §7.7`). P4 ships **single + small-batch
  issuance triggered by eligibility**; queue-driven bulk issuance rides on the deferred
  BullMQ `certificate-gen` worker (seam present, worker deferred). *Default: sync single/small-batch.*
- **Forensic / burned-in certificate watermark, LinkedIn "add to profile" deep integration.**
  Share = a share URL/OG-image link; deep LinkedIn API is OUT.
- **Notifications** for grade/certificate-ready (`docs/02 §7.15`) — that is **P6**. P4 writes
  the domain events / audit rows; fan-out to email/WhatsApp/in-app is P6.
- **Marketing website at large (P5)** — P4 adds **only** the single public
  `GET /verify/:certId` page/route (certificate terminus). No other `web` pages.
- **Live classes / `LiveClassProvider`** — still deferred (P3.5/P6).

---

## 2. Preconditions (what must already exist — verified)

- **P3 GREEN** (see verification above). Auth (cookie+CSRF, rotating refresh), RBAC
  machinery (`@RequirePermission` + `PermissionsGuard` + `ScopeInterceptor`, scope
  `all|branch|assigned|own`), soft-delete + audit Prisma extensions, provider+Noop pattern
  (Payment/SMS/Video), `{data,meta,error}` + `Paginated<T>` + RFC-7807 envelope, OpenAPI→
  `@repo/api-client` — all proven across P0–P3.
- **Schema present:** identity/access, catalog (`programs`/`modules`/`lessons` — `Lesson.type`
  already includes `assignment|quiz`), profiles, `batches`, `enrollments`, commerce, leads,
  `videos`/`lesson_progress`/`attendance`/`resources`, `audit_logs`. **NOT migrated (P4 adds):**
  `assignments`, `submissions`, `assessments`, `attempts`, `certificates`,
  `certificate_templates` (+ a project-milestone table — see schema).
- **`enrollments` is the student access anchor** (`student_id`, `program_id`, `batch_id`,
  `status=active`, `progress_pct` from P3). P4 keys submission/attempt/certificate ownership
  off enrollment exactly like P3 (`resolveEnrollmentForLesson` helper, ADR-0022). **P3's
  progress rollup (`enrollment.progress_pct`) is one of the three certificate-eligibility
  inputs** — reused, not recomputed.
- **`apps/lms`** is a real PWA (dashboard, courses, lesson player, progress) — P4 adds
  Assignments / Projects / Assessments / Certificates routes into the existing shell.
- **`apps/crm`** is a Vite SPA with per-route files under `apps/crm/src/routes/` and an
  Academics IA slot (`docs/03 §10`: Academics ▸ Assignments | Projects | Assessments; Content
  ▸ Certificates). P4 adds those routes.
- **`@repo/ui`** primitives from P0–P3 present (DataTable, Drawer, StatusChip, FormField,
  Tabs, ProgressRing/Bar, EmptyState, Skeleton, Toast, ConfirmDialog, etc.). **Missing (P4
  adds):** a **FileUpload** (signed-URL direct-to-storage), **RubricGrader**, **QuizRunner /
  QuestionCard** (MCQ/descriptive, timer, shuffle), **CertificateCard**, and a
  **CountdownTimer**.
- **StorageProvider does NOT exist** (confirmed: no interface/token in the repo; invoice-gen
  stubs `storageKey: null`; resources download is a UI stub). **P4 builds it.**
- **No PDF library installed** (confirmed). **ASK-USER before installing.**

---

## 3. New DB tables / columns + new provider interfaces (the db + integrations surface)

All from `docs/05 §3` "Live & learning work" + "Certificates" (currently spec-only per
`docs/05 §10`). Every table: `id` uuid PK, `created_at`/`updated_at`/`deleted_at`, `tenant_id`,
wired into the soft-delete + audit Prisma extensions, with the `docs/05 §4` indexes.
**Forward-only migration** — never edit shipped P0–P3 migrations.

### Tables to ADD

| Table | Columns (`docs/05 §3`) | Notes |
|-------|------------------------|-------|
| `assignments` | `tenant_id`, `lesson_id` (FK lessons), `kind` enum `AssignmentKind` (`assignment\|project`), `title`, `instructions`, `max_score` Int, `due_at` DateTime?, `allow_resubmit` Bool | `LESSON ||--o{ ASSIGNMENT`. `kind=project` unlocks milestones. Authoring is faculty/CRM (`assigned` scope). |
| `assignment_milestones` *(project support, `docs/02 §7.6`)* | `tenant_id`, `assignment_id` (FK), `title`, `order` Int, `due_at` DateTime? | Only for `kind=project`. Multi-milestone submissions. Small table; keep tight. |
| `submissions` | `tenant_id`, `assignment_id` (FK), `milestone_id` (FK, nullable), `enrollment_id` (FK enrollments), `files` Json (StorageProvider keys — **never raw URLs**), `text`, `link`, `attempt_no` Int default 1, `status` enum `SubmissionStatus` (`submitted\|graded\|returned`), `score` Int?, `rubric` Json?, `feedback`, `graded_by` (FK users, nullable), `graded_at` DateTime? | Indexes: `(assignment_id, enrollment_id)` (+partial-unique per `attempt_no` when `allow_resubmit=false`), `(tenant_id, status)`. Files stored as `storage_key` refs; download URLs minted on demand. |
| `assessments` | `tenant_id`, `module_id` (FK modules), `title`, `type` enum `AssessmentType` (`quiz\|test`), `time_limit_s` Int?, `pass_pct` Int, `attempts_allowed` Int default 1, `shuffle` Bool default true | `MODULE ||--o{ ASSESSMENT`. Authored in CRM. Questions in child table (see below) — **not** inline JSON (answer-key isolation). |
| `assessment_questions` | `tenant_id`, `assessment_id` (FK), `type` enum `QuestionType` (`mcq\|descriptive`), `prompt`, `options` Json? (MCQ choices, **no `is_correct` leaked to student DTO**), `answer_key` Json? (**server-only**: correct option id(s) / rubric — NEVER serialized to a student-facing DTO), `points` Int, `order` Int | Split from `assessments.questions` JSON so the **answer key lives in a column the student projection never selects**. Security-critical. |
| `attempts` | `tenant_id`, `assessment_id` (FK), `enrollment_id` (FK enrollments), `answers` Json (student responses), `score` Int?, `passed` Bool?, `started_at` DateTime, `submitted_at` DateTime?, `time_expires_at` DateTime (**server-computed** from `started_at`+`time_limit_s`), `flags` Json (tab-switch count etc.), `attempt_no` Int | Indexes: `(assessment_id, enrollment_id)`, `(tenant_id, enrollment_id)`. Server enforces `attempts_allowed` + time-box; auto-grade objective at submit; descriptive → manual. |
| `certificates` | `tenant_id`, `enrollment_id` (FK, uniq — one cert per enrollment), `student_id` (FK), `program_id` (FK), `cert_uid` (uniq, **signed hash**), `template_id` (FK certificate_templates), `storage_key` (PDF via StorageProvider), `issued_at` DateTime, `issued_by` (FK users), `status` enum `CertificateStatus` (`valid\|revoked`), `revoked_reason`, `revoked_by`, `revoked_at` | Indexes: `(cert_uid)` uniq, `(enrollment_id)` uniq. `cert_uid` = signed hash of `(student, program, issued_at, nonce)` (`docs/04 §2.11`) — **verify recomputes/validates the signature**, not just a DB lookup, so a fabricated row without a valid signature fails verification. |
| `certificate_templates` | `tenant_id`, `name`, `design` Json, `fields` Json, `status` | Seeded set (no designer UI in P4). |

### New enums
`AssignmentKind` (`assignment|project`), `SubmissionStatus` (`submitted|graded|returned`),
`AssessmentType` (`quiz|test`), `QuestionType` (`mcq|descriptive`),
`CertificateStatus` (`valid|revoked`). (Attempt uses booleans `passed` + timestamps — no enum.)

### Relations to wire (reverse relations on existing models)
- `Lesson`: add `assignments Assignment[]`.
- `Module`: add `assessments Assessment[]`.
- `Enrollment`: add `submissions Submission[]`, `attempts Attempt[]`, `certificate Certificate?`.
- `User`: add graded/issued/revoked back-relations where FKs added (`graded_by`, `issued_by`, etc.).

### New provider interfaces (behind DI token + Noop, fail-closed — `CLAUDE.md §1 rule 7`)
- **`StorageProvider`** / `STORAGE_PROVIDER` token — `getSignedUploadUrl({ key, contentType, maxBytes, ttl })`,
  `getSignedDownloadUrl({ key, ttl })`, `delete({ key })`, optional `head({ key })`. Adapter:
  **S3/R2 (AWS SDK v3 / S3-compatible)**; **NoopStorageProvider** (deterministic fake signed
  URLs for tests/local, mirrors NoopVideoProvider). **No raw bucket URL ever to client.**
  Bound via `useFactory` (ADR-0023) to avoid the DI default-param crash (DEFECT-1 lesson).
- **PDF generation** is **not** a swappable vendor provider but an internal
  `CertificatePdfPort` seam (so the lib choice is isolated + testable with a Noop). The
  **library requires user approval** (see Secrets). Bound to a `SyncCertificateGenAdapter`
  (inline) with the BullMQ `certificate-gen` worker deferred (ADR-0020 pattern).

### Seed expansion (`prisma/seed.ts`)
- **Permission matrix** (`docs/03 §9`, `docs/02 §9`): `assignments.view/create/edit/grade`,
  `submissions.view/create/grade`, `projects.review`, `assessments.view/create/edit`,
  `attempts.take/view`, `certificates.recommend/issue/revoke/view`, `certificates.verify`
  (public). Student gets `own`-scoped take/submit/view; Faculty gets `assigned`-scoped
  author/grade/recommend; Admin/Owner `all`; Finance/Support per matrix. Public verify needs
  **no auth**.
- **Sample content** on the existing sample program so both surfaces render real data: one
  assignment (with rubric), one project (2 milestones), one assessment (2 MCQ + 1 descriptive,
  with server-only answer key), one submission + one graded attempt for the sample student,
  one seeded `certificate_template`, and — for a *second* fully-completed sample enrollment —
  an **issued certificate** so the LMS certificate view + the public verify page render out of
  the box.

---

## 4. Task graph

| # | Task | Owner agent | Depends on | Wave | DoD (refs `CLAUDE.md §4` + docs) |
|---|------|-------------|------------|------|------|
| 0 | **PM gate — scope confirmation.** Confirm the OUT-of-scope gate decisions (§1) against `docs/02 §7.5–7.11` / `docs/03 §7.7–7.8` acceptance criteria (`docs/02 §21`, `docs/03 §20`): proctoring=basics only, no code questions, MCQ auto + descriptive/project manual, seeded cert templates (no designer), sync single/small-batch issuance. Produce the crisp acceptance-criteria checklist the QA + security waves assert against, and the eligibility-rule definition (completion% threshold + all required assessments passed + final project approved). | product-manager | — | **W1** (‖ #1) | §4: matches PRD acceptance criteria. `docs/02 §21`, `docs/03 §20`. Acceptance checklist + eligibility rule signed off; gate decisions recorded. |
| 1 | **Schema + migration + seed.** Add the 8 tables + 5 enums + reverse relations per §3 (uuid PK, `tenant_id`, soft-delete + audit wired, `docs/05 §4` indexes incl. `certificates.cert_uid` uniq + `(enrollment_id)` uniq, submission resubmit partial-unique, `assessment_questions.answer_key` as a **server-only column**). Forward-only migration applies clean. Expand `seed.ts`: P4 permission matrix + sample assignment/project/assessment/submission/attempt/template/issued-certificate. Integration test: soft-delete filter + audit-row-on-mutation for each new table; `certificates (enrollment_id)` uniq holds; **a student projection query for `assessment_questions` does NOT select `answer_key`** (repo-level test). Run the full `AppModule` boot smoke test early (DEFECT-1 lesson). | db-architect | 0 | **W1** | §4: every table tenant_id + soft-delete + audit; migration forward-only. `docs/05 §3/§4/§10`. Migration + seed run clean; extension + uniq + answer-key-isolation tests green. |
| 2 | **Shared contracts + client.** In `@repo/types`: zod DTOs + types for — **Assignments** (author DTO CRM; student ListItem/Detail with status), **Submissions** (`SubmitDto` {files:[storageKey], text?, link?} + `GradeDto` {score, rubric, feedback}), **Projects** (milestones + review states + feedback thread), **Assessments** (author DTO; **student `AssessmentQuestionPublic` DTO that OMITS `answer_key`/`is_correct`**), **Attempts** (`StartAttempt`, `SubmitAttempt` {answers}, result), **Certificates** (student ListItem/Detail, CRM issue/revoke DTO, **public `VerifyResult` = {valid, program, issuedAt, holderName?} — minimal, no PII beyond holder name**), **Upload** (`GetUploadUrlDto`/`SignedUpload`). Reuse `{data,meta,error}` + `Paginated<T>` + RFC-7807. Register in OpenAPI; regenerate `@repo/api-client`. **The student-facing assessment/attempt DTOs must make it structurally impossible to serialize the answer key.** | api-designer | 1 | **W2** | §4: zod DTOs in `@repo/types` imported FE+BE; validation at every boundary; **answer-key never in a student DTO**; verify DTO minimal. `docs/04 §2.5/§2.14`. Client compiles; SDK methods exist for all endpoints; type-level assertion that `AssessmentQuestionPublic` has no `answerKey`. |
| 3 | **`StorageProvider` interface + S3/R2 adapter + Noop.** Following the payment/video provider pattern (interface + DI `Symbol` token + Noop + real adapter via `useFactory`, env zod-validated at boot): `getSignedUploadUrl`/`getSignedDownloadUrl`/`delete`/`head`, short-TTL, scoped keys (`submissions/{tenant}/{enrollment}/…`, `certificates/{tenant}/…`). Implement **S3/R2 adapter** (fail-closed until creds) + **NoopStorageProvider** (deterministic fake signed URLs). Provider does NO business logic — only vendor calls + signing. Unit tests: signed-URL shape + TTL + key scoping, content-type/size constraint plumbing, Noop determinism (no live network). **Opportunistically wire the P2 invoice-gen `storageKey` + P3 resources download** now that the provider exists (behind the same seam; do not expand scope beyond minting). **Env keys user-provided; Noop until then.** | integrations | 1, 2 | **W3** | §4 + `CLAUDE.md §1 rule 7`: vendor SDK only behind interface; env-validated; secrets via env; **no raw bucket URL returned**. `docs/04 §2.10`, `docs/05 §7`. Adapter injected by token; Noop deterministic; signed-URL/TTL/scoping unit tests green; **fail-closed when unconfigured**. |
| 4 | **`CertificatePdfPort` seam + signed-uid engine.** The certificate engine internals (`docs/04 §2.11`): a `CertificatePdfPort` (render template `design`+`fields` → PDF bytes) bound to a `SyncCertificateGenAdapter` (inline) — **PDF lib is behind this port so the lib choice is ASK-USER + swappable**; a `NoopCertificatePdfAdapter` (deterministic stub bytes) for tests/local so the whole flow runs offline. Plus the **`cert_uid` signing utility**: `sign((student, program, issued_at, nonce))` → verifiable id, and `verify(cert_uid)` → boolean over the stored signature (HMAC/RS over a server secret — **verification recomputes the signature, not a bare DB lookup**, so a fabricated `certificates` row without a valid signature fails). Unit tests: sign/verify round-trip, tamper → invalid, Noop determinism. BullMQ `certificate-gen` worker deferred behind the seam (ADR-0020). | integrations | 1, 2, 3 | **W3** (‖ #3, shared cert concern) | §4 + `docs/04 §2.8/§2.11`: PDF lib behind a port (ASK-USER); signed-uid tamper-evident; sync-with-seam. Sign/verify + tamper + Noop unit tests green; no real PDF lib assumed until approved. |
| 5 | **LMS design-system primitives.** Add to `@repo/ui` ONLY what P4 needs and P0–P3 lacks, per `docs/07` + `docs/02 §12/§15` + `docs/03 §11/§15`: **FileUpload** (drag/drop → **signed-URL direct-to-storage** PUT with progress, size/type client-hint mirroring server limits, a11y, error/retry), **RubricGrader** (criteria × scores + feedback, keyboard-navigable, CRM-side), **QuizRunner / QuestionCard** (MCQ single/multi + descriptive, **CountdownTimer**, shuffle-aware, no-answer-key-in-DOM, focus mgmt, reduced-motion), **CertificateCard** (thumb, download CTA, verify link, status chip). All keyboard-first, focus-managed, AA, with loading/empty/error; unit + a11y test each. | design-system | — | **W2** (‖ #2) | §4: a11y pass (keyboard + SR labels); loading/empty/error; no color-only status; timer respects reduced-motion. `docs/07`, `docs/02 §15`, `docs/03 §15`. Each primitive unit+a11y tested; QuizRunner tested with mock questions (no answer key present client-side). |
| 6 | **Backend A — Assignments + Submissions + Projects module.** NestJS `learning` (or `assignments`) module, controller→service→repository. **CRM/faculty (assigned-scope):** author assignment/project + milestones (`assignments.create/edit`), list submissions for **assigned batches only**, **grade** (`submissions.grade`: score+rubric+feedback → `status=graded`, `graded_by`/`graded_at`, **audited grade change with before/after**), project review states + feedback. **LMS/student (own-scope):** list assignments/projects for **own enrollments**, `POST /assignments/:id/submit` (files as **StorageProvider keys via signed upload** — server validates the enrollment owns the assignment's program, enforces `allow_resubmit`/`attempt_no`), view own grade+rubric+feedback, `GET` a **signed download URL** for own submission files. **Enrollment-scope + RBAC via `@RequirePermission` + `ScopeInterceptor`; IDOR→404** (ADR-0022). **Resolve faculty `assigned` scope** (Risk #1 — add `programs`/`assignment` → batch → faculty resolution; if `programs.created_by` is still absent, scope grading by `batch.faculty_id` on the enrollment). | backend-builder | 1, 2, 3 | **W4** | §4: server RBAC + own-scope (student) / assigned-scope (faculty); audit **grade change before/after**; soft-delete; **submission files are storage keys, download URL signed on demand**; IDOR→404. `docs/02 §7.5/§7.6/§9`, `docs/03 §7.8`. Student submits/views own only; faculty grades assigned-batch only; grade change audited. |
| 7 | **Backend B — Assessments + Attempts module.** NestJS module, controller→service→repository. **CRM/faculty (assigned-scope):** author assessment + questions (`assessments.create/edit`; `answer_key` stored server-side), grade **descriptive** answers (manual). **LMS/student (own-scope):** `GET /assessments/:id` (**`AssessmentQuestionPublic` — no answer key**), `POST /assessments/:id/attempts` (start — server sets `started_at`+`time_expires_at`, enforces `attempts_allowed`), `PUT /attempts/:id` (submit answers — **server-side time-box check**, **auto-grade MCQ against server-only `answer_key`**, descriptive→pending, compute `score`/`passed`, store `flags` incl. tab-switch count from client). Instant objective score. **Answer key never in any response for an in-progress/objective attempt** (only revealed post-submit per policy, and even then only correctness, per PM decision). Enrollment-scope + RBAC; IDOR→404; every mutation audited; idempotent submit (re-submit of the same attempt does not double-grade). | backend-builder | 1, 2 | **W4** (‖ #6, shared `learning` module) | §4: server RBAC + own-scope; **answer-key server-only** (`docs/02 §17`); time-box server-enforced; audit on mutation; idempotent grade. `docs/02 §7.9/§9/§21`, `docs/03 §7.8`. Student cannot read answer key or exceed attempts/time; MCQ auto-graded; cross-student attempt blocked. |
| 8 | **Backend C — Certificates + eligibility + public verify module.** NestJS module, controller→service→repository, depending on `CertificatePdfPort` (#4) + `StorageProvider` (#3). **Eligibility engine:** `isEligible(enrollment)` = program completion (P3 `enrollment.progress_pct` ≥ threshold) **AND** all required assessments passed **AND** final project approved (rule from #0). **Issuance (CRM, `certificates.issue`, ops):** compute eligibility → generate `cert_uid` (signed) → render PDF (port) → store via StorageProvider → insert `certificates` row (audited); **faculty `certificates.recommend`** (assigned-scope) flags eligibility without issuing; **revoke/reissue** (`certificates.revoke`) flips status (audited, instant). **LMS (student, own):** `GET /me/certificates`, `GET /me/certificates/:id/download` (signed URL, **blocked until eligible/issued** per `docs/02 §21`). **PUBLIC (no auth):** `GET /verify/:certUid` → recompute/verify signature + DB status → `{valid|revoked, program, issuedAt, holderName}` (minimal, no PII beyond holder name; **rate-limited**; a revoked cert returns `revoked` instantly). Enrollment-scope + RBAC on student/CRM paths; public path is unauthenticated but signature-gated + rate-limited. | backend-builder | 1, 2, 3, 4 | **W4** (‖ #6/#7 — same phase, separate module) | §4: server RBAC + own/assigned/all per matrix; **download blocked until eligible**; **public verify signature-recomputed + rate-limited, minimal payload**; issuance/revoke audited. `docs/02 §7.11/§21`, `docs/03 §7.7/§20`, `docs/04 §2.11`. Eligibility gates issuance; verify resolves valid/revoked; revoke instant; no PII leak on public endpoint. |
| 9 | **CRM frontend — authoring + grading + issuance.** In `apps/crm` (Vite SPA, per-route files under `src/routes/`, TanStack Query over `@repo/api-client`, RHF+zod): **Academics ▸ Assignments** (author + submissions list + **RubricGrader** drawer, assigned-batch scoped), **▸ Projects** (milestone review pipeline + feedback thread), **▸ Assessments** (author assessment + question bank, descriptive-grade queue), **Content ▸ Certificates** (eligibility list, **issue / bulk-small / revoke / reissue**, verify-link). RBAC-aware rendering (hide what API forbids — faculty sees only assigned batches; issue/revoke only for `certificates.issue/revoke` roles). loading/empty/error everywhere; a11y AA (keyboard tables/drawers, SR labels, no color-only status); optimistic grade with confirm on destructive (revoke). | frontend-builder | 6, 7, 8, 5 | **W5** | §4: loading/empty/error on every async UI; a11y; RBAC-aware (assigned/role-scoped); no business logic in components (hooks). `docs/03 §7.7/§7.8/§10/§11/§15`. Faculty grades assigned-batch only; ops issues/revokes; revoke confirmed + reflected. |
| 10 | **LMS frontend — student submit/take/certify.** In `apps/lms` (Next.js PWA, extend existing shell nav): **Assignments** (list by course + status chips, detail, **FileUpload/text/link submit**, resubmit if allowed, view grade+rubric+feedback), **Projects** (milestone submissions + feedback thread + review states), **Assessments** (list, **QuizRunner** with CountdownTimer + shuffle + MCQ/descriptive, instant objective score, attempts-remaining), **Certificates** (list + **download signed PDF** when eligible, share link). **Sanitize any rendered student-submitted text/feedback with DOMPurify** (resolves P3 L-2 trust-boundary widening). RBAC/enrollment-aware (own only). loading/empty/error; a11y (keyboard quiz, focus mgmt, timer reduced-motion); optimistic submit. | frontend-builder | 6, 7, 8, 5 | **W5** (‖ #9) | §4: loading/empty/error; a11y (keyboard quiz + timer); own-scope only; **DOMPurify on student-submitted content render**; no raw storage URL in DOM. `docs/02 §7.5/§7.6/§7.9/§7.11/§14/§15/§21`. Student submits/takes/downloads own only; timer server-authoritative; no answer key in bundle. |
| 11 | **Public verify page (`web`).** In `apps/web` (Next.js App Router — the ONE P5-adjacent page P4 owns): `app/verify/[certId]/page.tsx` calling the public `GET /verify/:certUid`, rendering `{valid|revoked}` + minimal proof (program, issued date, holder name) with a clear valid/revoked visual state, SEO/OG for shareability, **no PII beyond holder name**, loading/empty/error (invalid id → clean "not found / invalid"), a11y AA. No auth. | frontend-builder | 8 | **W5** (‖ #9/#10) | §4: loading/empty/error; a11y; minimal payload (no PII leak); public/unauthenticated. `docs/02 §7.11/§21`, `docs/03 §7.7`. Valid cert resolves; revoked shows revoked; invalid id clean-fails; no PII beyond holder name. |
| 12 | **Tests.** Unit (services: eligibility engine — pass/fail each gate; MCQ auto-grade; attempt time-box + attempts-allowed; submission resubmit policy; `cert_uid` sign/verify + tamper; assigned-scope resolver for faculty grading; Noop storage/pdf determinism; DTO answer-key-omission type assertion). Integration (testcontainers PG/Redis + Noop storage/pdf): **the P4 IDOR/authz headline** — student CANNOT read/submit/grade another student's submission, take another's attempt, read the **answer key**, exceed attempts/time, or download an unearned/others' certificate (**IDOR→404**); faculty grades **only assigned batches**; **eligibility gates issuance** (issue blocked until completion+assessments+project); **public verify** resolves valid, flips to revoked instantly, **rejects a fabricated cert_uid** (bad signature), is rate-limited, leaks no PII; **grade change audited before/after**; idempotent attempt submit; **cross-tenant** isolation on submissions/attempts/certificates (pay down S1-3 debt). e2e Playwright: the full **login → submit assignment → take assessment → (ops issues) → download cert → public verify** journey (`docs/04 §6`). a11y (axe) on new primitives + screens. Wire into CI. | qa-engineer | 6, 7, 8, 9, 10, 11 | **W6** | §4: unit + integration + e2e + a11y green; tests gate merge. `docs/02 §21`, `docs/03 §20`, `docs/04 §6`. Full journey e2e green; IDOR/answer-key/eligibility/verify/audit/idempotency proven; cross-tenant added. |
| 13 | **Security review.** **Certificate forgery (crux):** can a fabricated/edited `certificates` row or a guessed `cert_uid` pass public verify? (must fail — verify **recomputes the signature**, not a bare lookup); is the signing secret never leaked? revoke instant? **Public verify endpoint:** unauthenticated but **rate-limited**, enumeration-resistant, **no PII beyond holder name**, no internal ids leaked. **Answer-key exposure:** `answer_key` NEVER in any student-facing DTO/response/bundle (verify the `AssessmentQuestionPublic` projection + the in-progress attempt response); server-side time-box + attempts enforcement cannot be bypassed by client. **Submission file upload:** signed-URL scoped + size/content-type constrained; no path traversal in storage keys; no raw bucket URL; download only for owner/authorized grader; malicious-file surface noted (AV scanning = tracked follow-up if not in scope). **Grade tampering:** grade/score mutable only by `submissions.grade` in assigned scope, audited before/after; student cannot self-grade. **IDOR on submissions/attempts/certificates:** cross-student + cross-tenant blocked server-side, IDOR→404 (ADR-0022). **Student-submitted content XSS:** DOMPurify on render (P3 L-2 widened). Report high/crit as fix tasks; re-verify. | security-reviewer | 12 | **W7** | §4 + `docs/04 §7` gate: server RBAC + scope; signed media; no secret leakage; audit. `docs/02 §17/§21`, `docs/03 §17`. No high/crit open; forgery/verify/answer-key/upload/grade-tamper/IDOR/XSS verified. |
| 14 | **Docs sync.** Update `README.md` (new modules + how to run/seed/verify P4; **StorageProvider Noop-by-default + how to set S3/R2 keys**; **which PDF lib was approved + how the cert engine runs**; how to exercise public verify). ADRs for P4 decisions (StorageProvider interface + Noop-until-keys + `useFactory`; certificate `cert_uid` signed-hash + verify-recomputes-signature model; CertificatePdfPort sync-with-seam + PDF lib choice; answer-key column-isolation model; faculty `assigned`-scope grading resolution (resolves ADR-0009 deferral); assessment time-box + basics-only anti-cheat scope; project-as-assignment-kind + milestones). Update `docs/05 §10` implementation status (the 8 tables → Implemented P4). Create `docs/phase-4-followups.md` (bulk/auto issuance + BullMQ `certificate-gen` worker, cert template designer, code-question sandbox, proctoring, AV scanning on uploads, LinkedIn deep integration, notifications for grade/cert-ready → P6, carried S1-x + P1/P2/P3 items). | docs-writer | 13 | **W7** | §4: short summary of what changed + how to verify. P4 closeout; `docs/05 §10` + ADRs + `docs/phase-4-followups.md` synced. |

---

## 5. Execution order (waves)

- **Wave 1:** #0 (product-manager — scope/eligibility gate) ‖ #1 (db-architect — schema +
  migration + seed; #1 consumes #0's eligibility rule for the seed but can start structural
  work immediately). Everything downstream depends on #1.
- **Wave 2 (parallel):** #2 (api-designer — contracts/SDK, needs #1) ‖ #5 (design-system —
  FileUpload/RubricGrader/QuizRunner/CountdownTimer/CertificateCard, needs nothing).
- **Wave 3 (parallel):** #3 (integrations — StorageProvider + Noop, needs #1+#2) ‖ #4
  (integrations — CertificatePdfPort + cert_uid sign/verify, needs #1+#2, shares the cert
  concern with #3). Hard dependencies for the certificate + submission backends.
- **Wave 4 (parallel, shared `learning` domain, separate modules):** #6 (backend —
  assignments/submissions/projects; needs #1+#2+#3) ‖ #7 (backend — assessments/attempts;
  needs #1+#2) ‖ #8 (backend — certificates/eligibility/public-verify; needs #1+#2+#3+#4).
  #8 consumes P3's `enrollment.progress_pct` + #7's assessment-pass + #6's project-approval
  as eligibility inputs — land the eligibility-input reads after #6/#7 expose them (same wave,
  coordinate the shared eligibility helper).
- **Wave 5 (parallel):** #9 (frontend — CRM authoring/grading/issuance; needs #6+#7+#8+#5) ‖
  #10 (frontend — LMS submit/take/certify; needs #6+#7+#8+#5) ‖ #11 (frontend — `web` public
  verify page; needs #8).
- **Wave 6:** #12 (qa-engineer) — needs all backend + frontend landed.
- **Wave 7:** #13 (security-reviewer) → #14 (docs-writer).

---

## 6. Risks & open questions

1. **Faculty `assigned`-scope grading (resolves the ADR-0009 deferral — high risk).** P4 is
   the first faculty *authoring/grading* surface, so `assigned` scope becomes load-bearing: a
   faculty member must grade/review **only submissions in batches they teach**. `programs`
   still has no `created_by`. **Decision:** scope faculty grading by `batch.faculty_id` on the
   enrollment behind the submission/attempt (submission → enrollment → batch → faculty). Add
   the resolution to the scope helper; QA (#12) + security (#13) assert a faculty cannot grade
   an unassigned batch. Recorded as an ADR that supersedes the ADR-0009 deferral.
2. **Certificate forgery / public verify (the security crux).** `cert_uid` = **signed hash**;
   **verification recomputes the signature over `(student, program, issued_at, nonce)` and
   checks DB status**, so a fabricated row or guessed uid without a valid signature fails.
   The signing secret is env-only, never leaked. Public verify is **rate-limited + minimal
   payload (no PII beyond holder name)**. Recorded as an ADR. QA/security exercise
   valid/revoked/fabricated/enumeration.
3. **Answer-key exposure (security crux #2).** MCQ auto-grading needs the correct answers
   server-side. **Decision:** questions live in `assessment_questions` with `answer_key` a
   **column the student projection never selects**; the `AssessmentQuestionPublic` DTO makes
   it structurally impossible to serialize; grading happens server-side only. QA adds a
   type-level + integration assertion. This is why questions are a child table, not
   `assessments.questions` inline JSON (diverges from `docs/05 §3` "questions(json/ref)" — the
   **ref** form; recorded as an ADR + a `docs/05` note).
4. **PDF library is unchosen and unapproved (blocking for real PDFs).** `docs/04 §2.11` says
   "headless or PDF lib" — no lib is installed. **Decision:** the `CertificatePdfPort` isolates
   the choice; `NoopCertificatePdfAdapter` produces deterministic stub bytes so the entire
   flow (eligibility → uid → store → verify) is testable offline **without any PDF lib**. The
   real lib is **ASK-USER before install** (see §7). P4 can be fully green on Noop; real PDFs
   land the moment the lib + storage keys are approved.
5. **StorageProvider is the shared hard dependency (new provider surface).** Submissions,
   certificates, and the carried P2-invoice / P3-resources stubs all need it. **Decision:**
   build it once in W3 with a Noop (fail-closed real adapter until creds), wire the carried
   stubs opportunistically. Signed **upload** URLs must be scoped + size/content-type limited
   (upload is a fresh attack surface vs. P3's download-only). Recorded as an ADR.
6. **Assessment time-box + attempts integrity.** Client timers are advisory; the **server**
   sets `time_expires_at` from `started_at`+`time_limit_s` and rejects late/over-limit
   submits, and enforces `attempts_allowed`. Tab-switch is a **flag** stored on the attempt,
   not a hard block (basics only, §1 OUT). QA asserts the server rejects a manipulated client
   clock / extra attempt.
7. **Idempotent grading + attempt submit.** Re-submitting the same attempt or re-grading must
   not double-count or corrupt score/pass/eligibility. **Decision:** attempt submit is
   idempotent on `(attempt_id, submitted_at is null)`; re-grade overwrites with an audited
   before/after. QA asserts replay safety.
8. **Eligibility depends on three subsystems landing in the same wave.** Completion (P3),
   assessment-pass (#7), project-approval (#6) all feed #8. **Decision:** #8 reads them through
   a small `EligibilityInputs` helper; #6/#7 expose the read first, #8 composes — coordinated
   within W4, no cross-wave stall.
9. **P3 L-2 XSS trust boundary widens.** Student-submitted text/links/descriptive answers are
   now rendered (in LMS + CRM grading views). **Decision:** DOMPurify on every render of
   student-submitted content; security review verifies. Recorded as closing L-2.
10. **Cross-tenant IDOR test debt (S1-3).** Still single-tenant harness; P4 adds three fresh
    IDOR surfaces. Security (#13) MUST add the cross-tenant isolation test on
    submissions/attempts/certificates now.
11. **`web` app touched for the first time since P0 shell.** P4 adds ONLY the public verify
    route — no broader P5 marketing work. Kept deliberately minimal so P5 owns the funnel.

---

## 7. Secrets / dependencies the user must supply or approve

**Dependencies requiring explicit approval before install (standing rule — do NOT `pnpm add`
without a yes):**
- **PDF-generation library — ASK USER, no default assumed.** The cert engine needs HTML→PDF.
  Candidates to present for the user to pick: a headless-Chromium renderer (e.g.
  `puppeteer`/`playwright` — heavy, high-fidelity) **or** a pure-JS PDF lib (e.g.
  `pdfkit`/`@react-pdf/renderer`/`pdf-lib` — lighter, less CSS fidelity). **Until approved,
  `NoopCertificatePdfAdapter` (stub bytes) keeps P4 green.** Which lib + why is an ADR.
- **AWS SDK v3 / S3-compatible client** for the StorageProvider adapter (e.g.
  `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) — **ASK USER before install.** Noop
  keeps P4 green until then.
- **DOMPurify** (+ a server-safe DOM if sanitizing server-side, or client-only) for
  student-submitted content — **ASK USER before install.**
- **`hls.js`** is still the P3-deferred approval (unrelated to P4 features but tracked).

**Provider credentials — user-supplied (provider is Noop / fail-closed until set):**
- **StorageProvider (S3/R2):** `STORAGE_PROVIDER` (`s3`|`r2`|`noop`), `STORAGE_BUCKET`,
  `STORAGE_REGION`, `STORAGE_ENDPOINT` (for R2/S3-compatible), `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`, and the signed-URL TTL constant. Added to `.env.example` + the
  zod env schema. **Until provided:** `NoopStorageProvider` (deterministic fake signed URLs);
  the real adapter is **fail-closed** (upload/download → 503, never a raw URL).
- **Certificate signing secret:** `CERT_SIGNING_SECRET` (HMAC) or an RS keypair
  (`CERT_SIGNING_PRIVATE_KEY`/`CERT_SIGNING_PUBLIC_KEY`) for `cert_uid`. Env-only, zod-validated,
  never leaked. A dev default may be generated for local/test; **production requires a real
  secret** (call out in `.env.example` + README).

**NOT needed in P4 (no new surface):** no new payment/SMS/email/WhatsApp keys (P2/P6); no
`LiveClassProvider` (deferred); the **VideoProvider** keys remain the P3-blocked item
(unrelated to P4 features). The two exposed `cfat_` Cloudflare tokens from the P3 activation
attempt **still need rotating** (carried from `docs/phase-3-followups.md`).

**Product decisions (defaults chosen if no answer — confirmed in task #0):**
1. **Q1 (proctoring):** basics only (shuffle + server time-box + tab-switch flag). *Default: basics.*
2. **Q2 (grading of descriptive/code):** MCQ auto-graded; descriptive manual; **code questions OUT**. *Default: MCQ auto + descriptive manual, no code.*
3. **Q3 (cert templates):** small seeded set, no designer UI. *Default: seeded.*
4. **Q4 (issuance mode):** sync single/small-batch on eligibility; bulk/auto → deferred BullMQ. *Default: sync.*
5. **Q5 (eligibility rule):** completion% ≥ threshold **AND** all required assessments passed **AND** final project approved. *Default: that (threshold confirmed in #0).*
6. **Q6 (verify payload):** `{valid|revoked, program, issuedAt, holderName}` — no other PII. *Default: minimal.*
7. **Q7 (project model):** projects = `assignments.kind=project` + `assignment_milestones`, not a separate top-level table. *Default: that.*

---

## 8. Definition of Done for the whole phase (gate to P5)

- [ ] Migration adds `assignments`, `assignment_milestones`, `submissions`, `assessments`,
      `assessment_questions`, `attempts`, `certificates`, `certificate_templates` + the 5 enums
      + reverse relations (uuid PK, tenant_id, soft-delete, `docs/05 §4` indexes incl.
      `certificates.cert_uid` uniq + `(enrollment_id)` uniq + resubmit partial-unique +
      **`answer_key` server-only column**), wired to soft-delete + audit; seed creates the P4
      permission matrix + sample assignment/project/assessment/submission/attempt/template/
      issued-certificate on the sample program.
- [ ] zod DTOs for assignments/submissions/projects/assessments/attempts/certificates/upload/
      **public-verify** in `@repo/types`, imported FE+BE; `@repo/api-client` regenerated; the
      **student assessment/attempt DTOs structurally omit the answer key**; the verify DTO is
      minimal (no PII beyond holder name).
- [ ] `StorageProvider` behind the interface + DI token (`useFactory`); `NoopStorageProvider`
      for tests/local; real S3/R2 adapter **fail-closed** until keys; signed upload+download
      short-TTL + scoped keys; env zod-validated; **no raw bucket URL to client**. P2 invoice +
      P3 resources download stubs wired opportunistically.
- [ ] `CertificatePdfPort` + `SyncCertificateGenAdapter` + `NoopCertificatePdfAdapter` (real
      PDF lib **only after user approval**); `cert_uid` **signed** and **verification
      recomputes the signature** (fabricated row/guessed uid fails); BullMQ `certificate-gen`
      deferred behind the seam.
- [ ] Backend: assignments/submissions/projects (author+grade+submit, faculty **assigned**-scope
      grading, student **own**-scope submit, audited grade before/after, signed file up/download);
      assessments/attempts (author, student take with **server time-box + attempts limit**,
      **MCQ auto-grade against server-only answer key**, descriptive manual, idempotent submit);
      certificates (**eligibility engine**, issue/recommend/revoke/reissue, download **blocked
      until eligible**, **public `GET /verify/:certUid`** signature-recomputed + rate-limited +
      minimal payload) — all `@RequirePermission` + scope, **IDOR→404**, every mutation audited.
- [ ] `apps/crm`: Academics ▸ Assignments/Projects/Assessments (author + RubricGrader +
      descriptive-grade queue, assigned-scoped) + Content ▸ Certificates (issue/revoke/reissue),
      RBAC-aware, loading/empty/error, a11y AA. `apps/lms`: Assignments/Projects/Assessments/
      Certificates (submit/take/download own only, QuizRunner + CountdownTimer, DOMPurify on
      student content), loading/empty/error, a11y AA. `apps/web`: public `verify/[certId]` page.
- [ ] **`docs/04 §6` critical journey proven by e2e:** login → submit assignment → take
      assessment → (ops issues certificate) → download signed PDF → **public verify resolves
      valid, and a revoke flips it to revoked instantly**.
- [ ] **P4 IDOR/authz proven by integration test:** a student cannot read/submit/grade another
      student's submission, take another's attempt, **read the answer key**, exceed
      attempts/time, or download an unearned/others' certificate (IDOR→404); faculty grades only
      **assigned** batches; **eligibility gates issuance**; **public verify rejects a fabricated
      cert_uid**, is rate-limited, and leaks no PII; **cross-tenant** isolation on
      submissions/attempts/certificates (S1-3 debt paid down).
- [ ] **Idempotency proven:** replayed attempt submit / re-grade does not double-count or
      corrupt score/pass/eligibility.
- [ ] Every create/update on submissions(grade)/attempts/certificates(issue/revoke) writes an
      audit-log row with actor + before/after + timestamp.
- [ ] Unit + integration + e2e (the full journey) + a11y green; `turbo run build lint test` +
      `test:integration` green.
- [ ] a11y AA pass on new `@repo/ui` primitives (FileUpload/RubricGrader/QuizRunner/
      CountdownTimer/CertificateCard) and the new CRM/LMS/web screens (keyboard quiz, focus mgmt,
      SR labels, timer reduced-motion, no color-only status).
- [ ] security-reviewer sign-off: no high/critical open on certificate forgery / public verify
      / answer-key exposure / submission upload / grade tampering / IDOR / student-content XSS.
- [ ] README + ADRs + `docs/phase-4-followups.md` synced; `docs/05 §10` reflects the 8 P4 tables
      as Implemented (P4); bulk/auto issuance + BullMQ cert worker + template designer + code
      questions + proctoring + AV scanning + grade/cert notifications tracked as follow-ups.
