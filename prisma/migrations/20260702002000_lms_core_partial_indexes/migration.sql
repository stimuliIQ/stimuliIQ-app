-- Partial indexes `WHERE deleted_at IS NULL` for the Phase-3 LMS-core hot tables
-- (docs/05 §4 + docs/plans/phase-3.md task #1). Prisma's declarative `@@index` cannot
-- express partial indexes, so these are added via raw SQL in a dedicated forward-only
-- migration, matching the pattern established in:
--   20260626204500_core_partial_indexes
--   20260627073500_crm_core_partial_indexes
--   20260627203400_commerce_leads_partial_indexes
-- These complement (do not replace) the full-column indexes already created in
-- 20260702001505_lms_core.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ── videos: partial indexes ───────────────────────────────────────────────────────────

-- Active video lookups by tenant+status (e.g. reprocess errored, surface ready videos).
CREATE INDEX IF NOT EXISTS "videos_active_tenant_status_idx"
  ON "videos" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- 1:1 lesson→video lookup for the player (enrollment-gated content fetch, hot path).
CREATE UNIQUE INDEX IF NOT EXISTS "videos_active_lesson_id_key"
  ON "videos" ("lesson_id")
  WHERE "deleted_at" IS NULL;

-- ── lesson_progress: partial indexes ─────────────────────────────────────────────────

-- Resume / completion upsert target: (enrollment_id, lesson_id) unique among active rows.
-- This is the authoritative dedup constraint for the progress upsert (the Prisma-layer
-- @@unique covers all rows including soft-deleted; this partial index covers active rows
-- only, matching the same pattern as enrollments_active_student_batch_key from
-- 20260627073500_crm_core_partial_indexes).
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_progress_active_enrollment_lesson_key"
  ON "lesson_progress" ("enrollment_id", "lesson_id")
  WHERE "deleted_at" IS NULL;

-- Active progress rows by enrollment (dashboard: per-program completion %).
CREATE INDEX IF NOT EXISTS "lesson_progress_active_enrollment_idx"
  ON "lesson_progress" ("enrollment_id")
  WHERE "deleted_at" IS NULL;

-- Active completed lessons (completion rollup: count WHERE status='completed').
CREATE INDEX IF NOT EXISTS "lesson_progress_active_enrollment_completed_idx"
  ON "lesson_progress" ("enrollment_id", "status")
  WHERE "deleted_at" IS NULL AND "status" = 'completed';

-- ── attendance: partial indexes ───────────────────────────────────────────────────────

-- Recorded-attendance idempotency partial-unique (docs/plans/phase-3.md task #1).
-- Prevents duplicate recorded-attendance rows per (enrollment, lesson):
--   source = 'recorded': dedup key is (enrollment_id, lesson_id) — one row per lesson.
--   deleted_at IS NULL: soft-deleted rows do not block re-marking after restore.
-- This constraint enforces the P3 policy (docs/plans/phase-3.md risk Q7):
--   "completing a recorded lesson marks one attendance source=recorded row per
--   (enrollment, lesson), idempotent."
-- live attendance (future) will use (enrollment_id, live_class_id) — tracked via
-- the docs/05 §4 @@index([enrollmentId, liveClassId]) in schema.prisma; the unique
-- constraint for live rows will be added when live_classes lands.
CREATE UNIQUE INDEX IF NOT EXISTS "attendance_active_recorded_enrollment_lesson_key"
  ON "attendance" ("enrollment_id", "lesson_id")
  WHERE "source" = 'recorded'
    AND "lesson_id" IS NOT NULL
    AND "deleted_at" IS NULL;

-- Active attendance rows by enrollment (attendance % calculation).
CREATE INDEX IF NOT EXISTS "attendance_active_enrollment_idx"
  ON "attendance" ("enrollment_id")
  WHERE "deleted_at" IS NULL;

-- Active attendance by enrollment+source (split live vs. recorded stats).
CREATE INDEX IF NOT EXISTS "attendance_active_enrollment_source_idx"
  ON "attendance" ("enrollment_id", "source")
  WHERE "deleted_at" IS NULL;

-- ── resources: partial indexes ────────────────────────────────────────────────────────

-- Active resource listing by lesson (LMS lesson page sidebar).
CREATE INDEX IF NOT EXISTS "resources_active_lesson_idx"
  ON "resources" ("lesson_id")
  WHERE "deleted_at" IS NULL;
