-- Partial indexes `WHERE deleted_at IS NULL` for the Phase-4 Learning-Depth hot tables
-- (docs/05 §4 + docs/plans/phase-4.md task #1). Prisma's declarative `@@index` cannot
-- express partial indexes, so these are added via raw SQL in a dedicated forward-only
-- migration, matching the pattern established in:
--   20260626204500_core_partial_indexes
--   20260627073500_crm_core_partial_indexes
--   20260627203400_commerce_leads_partial_indexes
--   20260702002000_lms_core_partial_indexes
-- These complement (do not replace) the full-column indexes already created in
-- 20260702065749_learning_depth.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ── assignments: partial indexes ──────────────────────────────────────────────────────

-- Active assignment listing by lesson (LMS lesson page + CRM authoring view).
CREATE INDEX IF NOT EXISTS "assignments_active_lesson_idx"
  ON "assignments" ("lesson_id")
  WHERE "deleted_at" IS NULL;

-- Active assignments by tenant (CRM list all assignments, admin scope).
CREATE INDEX IF NOT EXISTS "assignments_active_tenant_idx"
  ON "assignments" ("tenant_id")
  WHERE "deleted_at" IS NULL;

-- ── assignment_milestones: partial indexes ─────────────────────────────────────────────

-- Active milestones by assignment (project milestone timeline view).
CREATE INDEX IF NOT EXISTS "assignment_milestones_active_assignment_idx"
  ON "assignment_milestones" ("assignment_id", "order")
  WHERE "deleted_at" IS NULL;

-- ── submissions: partial indexes ──────────────────────────────────────────────────────

-- Active submissions for a student's assignment (grading + history view).
-- This is the hot path for both student (my submissions) and faculty (grade queue).
CREATE INDEX IF NOT EXISTS "submissions_active_assignment_enrollment_idx"
  ON "submissions" ("assignment_id", "enrollment_id")
  WHERE "deleted_at" IS NULL;

-- Active submissions in grading-queue status (CRM faculty grading dashboard).
CREATE INDEX IF NOT EXISTS "submissions_active_tenant_status_idx"
  ON "submissions" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- ── Submissions resubmit partial-unique (docs/plans/phase-4.md task #1, plan §3):
--
-- PURPOSE: Block a 2nd active submission when the linked assignment does NOT allow
--          resubmission. Per plan §3: "partial-unique on (assignment_id, enrollment_id)
--          when the assignment does not allow resubmit (model as a partial unique index
--          in the migration SQL; document the approach)".
--
-- DESIGN APPROACH (documented as required by plan §3):
--   Postgres partial indexes can only reference columns on the indexed table. The
--   `allow_resubmit` flag lives on the `assignments` table (not `submissions`), so
--   a pure SQL partial index on submissions cannot reference it directly. The chosen
--   approach uses two complementary enforcement layers:
--
--   LAYER 1 — DB: A partial-unique index on (assignment_id, enrollment_id) WHERE
--     deleted_at IS NULL AND attempt_no = 1. This blocks any row with attempt_no=1
--     being inserted twice for the same (assignment, enrollment) pair, which covers
--     the no-resubmit case: when allow_resubmit=false, the service ONLY ever creates
--     attempt_no=1, so this index blocks the duplicate.
--
--   LAYER 2 — Service layer: Before inserting a new submission the backend checks
--     assignment.allow_resubmit. If false, it returns 409 Conflict before the DB
--     insert. If true, it increments attempt_no (2, 3…) — those rows are NOT covered
--     by the attempt_no=1 partial-unique, so resubmits flow through freely.
--
--   NET EFFECT: When allow_resubmit=false, the DB index provides a hard backstop
--   (defense in depth) even if the service-layer check is bypassed. When
--   allow_resubmit=true, the index doesn't interfere (attempt_no > 1). The
--   integration test validates: 2nd submission blocked when allow_resubmit=false
--   (index violation); allowed with attempt_no=2 when allow_resubmit=true.
--
--   This is recorded as an ADR note: docs-writer should update docs/05 §4 indexes
--   table to include this submissions partial-unique and the two-layer approach.

CREATE UNIQUE INDEX IF NOT EXISTS "submissions_active_no_resubmit_unique"
  ON "submissions" ("assignment_id", "enrollment_id")
  WHERE "deleted_at" IS NULL
    AND "attempt_no" = 1;

-- ── assessments: partial indexes ──────────────────────────────────────────────────────

-- Active assessments by module (LMS assessment list page + CRM authoring view).
CREATE INDEX IF NOT EXISTS "assessments_active_module_idx"
  ON "assessments" ("module_id")
  WHERE "deleted_at" IS NULL;

-- ── assessment_questions: partial indexes ─────────────────────────────────────────────

-- Active questions by assessment (question bank display for CRM authoring).
-- Ordered by assessment_id + order to serve the ordered question list.
CREATE INDEX IF NOT EXISTS "assessment_questions_active_assessment_idx"
  ON "assessment_questions" ("assessment_id", "order")
  WHERE "deleted_at" IS NULL;

-- ── attempts: partial indexes ─────────────────────────────────────────────────────────

-- Active attempts by (assessment, enrollment) — check attempts_allowed before starting.
CREATE INDEX IF NOT EXISTS "attempts_active_assessment_enrollment_idx"
  ON "attempts" ("assessment_id", "enrollment_id")
  WHERE "deleted_at" IS NULL;

-- Active in-progress attempts (submitted_at IS NULL = not yet submitted).
-- Used by the server to check for an already-started unsubmitted attempt before
-- allowing a new start (idempotency: one active in-progress attempt at a time).
CREATE INDEX IF NOT EXISTS "attempts_active_in_progress_idx"
  ON "attempts" ("enrollment_id", "assessment_id")
  WHERE "deleted_at" IS NULL
    AND "submitted_at" IS NULL;

-- ── certificate_templates: partial indexes ────────────────────────────────────────────

-- Active templates by tenant (template selector on certificate issuance form).
CREATE INDEX IF NOT EXISTS "certificate_templates_active_tenant_idx"
  ON "certificate_templates" ("tenant_id")
  WHERE "deleted_at" IS NULL
    AND "status" = 'active';

-- ── certificates: partial indexes ────────────────────────────────────────────────────

-- Active valid certificates by tenant+student (student cert list in LMS).
CREATE INDEX IF NOT EXISTS "certificates_active_valid_student_idx"
  ON "certificates" ("tenant_id", "student_id")
  WHERE "deleted_at" IS NULL
    AND "status" = 'valid';

-- Active certificate lookup by cert_uid (public verify — hot path, tamper-evident).
-- The Prisma @@unique already creates a full unique index; this partial-unique is the
-- performance-optimised variant that the public verify endpoint hits (skips deleted rows).
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_active_cert_uid_key"
  ON "certificates" ("cert_uid")
  WHERE "deleted_at" IS NULL;

-- Active enrollment→certificate lookup (one-cert-per-enrollment enforcement on active rows).
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_active_enrollment_id_key"
  ON "certificates" ("enrollment_id")
  WHERE "deleted_at" IS NULL;
