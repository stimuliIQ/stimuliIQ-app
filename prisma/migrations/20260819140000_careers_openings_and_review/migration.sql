-- Careers: CRM-managed job openings + a real review lifecycle for applications.
-- Spec: docs/specs/careers-hiring.md. Decision record: ADR-0066.
--
-- WHY
--   Openings were free text typed into the careers page's `job_openings` block, so an
--   application stored only a role STRING. Nothing could answer "how many people applied
--   for the counsellor role", renaming a role orphaned its applications, and a lapsed
--   opening kept taking applications until somebody remembered to delete the text.
--
--   Applications had no CRM screen at all and sent no email: a candidate applied into
--   silence, and every row sat at status 'new' forever because nothing ever wrote another
--   value. This migration lays the storage for the four review verbs (hold / shortlist /
--   offer / reject), each of which mails the candidate.
--
-- FORWARD-ONLY and re-runnable: every statement is IF NOT EXISTS / idempotent.

-- ── 1. job_openings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "job_openings" (
  "id"                UUID         NOT NULL,
  "tenant_id"         UUID         NOT NULL,
  "title"             TEXT         NOT NULL,
  "slug"              TEXT         NOT NULL,
  "department"        TEXT,
  "employment_type"   TEXT         NOT NULL,
  "location"          TEXT         NOT NULL,
  "work_mode"         TEXT,
  "experience_level"  TEXT,
  "summary"           TEXT         NOT NULL,
  "description"       TEXT,
  "responsibilities"  JSONB        NOT NULL DEFAULT '[]',
  "requirements"      JSONB        NOT NULL DEFAULT '[]',
  "compensation_note" TEXT,
  "status"            TEXT         NOT NULL DEFAULT 'draft',
  "order"             INTEGER      NOT NULL DEFAULT 0,
  "openings_count"    INTEGER      NOT NULL DEFAULT 1,
  "closes_on"         DATE,
  "published_at"      TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  "deleted_at"        TIMESTAMP(3),
  CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "job_openings"
  DROP CONSTRAINT IF EXISTS "job_openings_tenant_id_fkey";
ALTER TABLE "job_openings"
  ADD CONSTRAINT "job_openings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "job_openings_tenant_id_status_idx"     ON "job_openings"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "job_openings_tenant_id_deleted_at_idx" ON "job_openings"("tenant_id", "deleted_at");

-- PARTIAL unique index — the slug is the public identifier (/careers#<slug>), so it must be
-- unique among LIVE rows, but a soft-deleted opening must not squat on its slug forever.
-- Prisma cannot express a partial index, so it lives here and NOT in schema.prisma; see
-- docs/05-database-design.md and the same pattern in 20260817100100_leave_management_partial_indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "job_openings_tenant_id_slug_live_key"
  ON "job_openings"("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- ── 2. career_applications: link to the opening + the review columns ─────────────────
ALTER TABLE "career_applications"
  ADD COLUMN IF NOT EXISTS "job_opening_id"           UUID,
  ADD COLUMN IF NOT EXISTS "internal_notes"           TEXT,
  ADD COLUMN IF NOT EXISTS "next_round_name"          TEXT,
  ADD COLUMN IF NOT EXISTS "next_round_details"       TEXT,
  ADD COLUMN IF NOT EXISTS "offer_letter_storage_key" TEXT,
  ADD COLUMN IF NOT EXISTS "offer_letter_file_name"   TEXT,
  ADD COLUMN IF NOT EXISTS "acknowledged_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decided_at"               TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decided_by_user_id"       UUID;

ALTER TABLE "career_applications"
  DROP CONSTRAINT IF EXISTS "career_applications_job_opening_id_fkey";
ALTER TABLE "career_applications"
  ADD CONSTRAINT "career_applications_job_opening_id_fkey"
  FOREIGN KEY ("job_opening_id") REFERENCES "job_openings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "career_applications"
  DROP CONSTRAINT IF EXISTS "career_applications_decided_by_user_id_fkey";
ALTER TABLE "career_applications"
  ADD CONSTRAINT "career_applications_decided_by_user_id_fkey"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "career_applications_tenant_id_job_opening_id_idx"
  ON "career_applications"("tenant_id", "job_opening_id");

-- ── 3. Retire the two statuses the review verbs replace ─────────────────────────────
-- The old app-boundary enum was new|reviewing|shortlisted|rejected|hired. Nothing ever
-- WROTE anything but 'new' (there was no CRM screen), so in practice this rewrites nothing
-- — but the new enum is new|on_hold|shortlisted|selected|rejected, and a row carrying a
-- retired value would fail the read-mapping cast in CareerApplicationsService.
--   reviewing -> new       (an application being looked at has not been decided)
--   hired     -> selected  (same meaning, the name the offer verb now writes)
UPDATE "career_applications" SET "status" = 'new'      WHERE "status" = 'reviewing';
UPDATE "career_applications" SET "status" = 'selected' WHERE "status" = 'hired';

-- ── 4. Backfill: applications that predate this migration were never acknowledged ────
-- `acknowledged_at` stays NULL for them on purpose. It means "we never emailed this
-- person", which is the truth, and it is what the CRM shows the reviewer so they can send
-- the acknowledgement by hand if they want to.
