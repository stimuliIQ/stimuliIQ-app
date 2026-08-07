-- Student onboarding form (onboarding.stimuliiq.com) — the in-product replacement for
-- the Google Form students filled after paying.
--
-- Two tables rather than one JSON blob per submission, because the two halves change on
-- completely different clocks: the QUESTION SET is edited by staff from the CRM (rename a
-- label, add a field, reorder), while a SUBMISSION is immutable evidence of what one
-- student answered on one day. Keeping the questions in their own table is what makes
-- "add a new field" a row insert instead of a deploy.
--
-- Why `answers` is a self-describing snapshot and not a join table:
--   Fields are editable and deletable. If answers referenced live field rows, renaming
--   "College Name" to "Institution" would retroactively relabel every answer ever given,
--   and deleting a field would orphan its answers outright. Storing
--   [{field_id, key, label, type, value, storage_key}] freezes the question exactly as it
--   was asked. The CRM detail view renders straight from that array, so a submission from
--   before a field edit still reads correctly next to one from after it.
--
-- Why full_name/email/phone/program_id are duplicated out of `answers`:
--   Purely a read projection for the CRM list — columns, search, and sort must not have to
--   crack open a JSONB blob per row. They are populated at submit time from whichever
--   fields carry the matching identity_role (and the `program`-typed field). `answers`
--   stays the source of truth; these are derived and may be NULL if staff removed the
--   corresponding question.

CREATE TYPE "OnboardingFieldType" AS ENUM (
  'text', 'textarea', 'email', 'phone', 'number', 'date',
  'select', 'radio', 'checkbox', 'file', 'program'
);

-- Marks a field as the source of a denormalised CRM list column. Deliberately NOT a DB
-- constraint on "one field per role" — staff swapping which question feeds the Name column
-- is a routine two-step edit that a unique index would make impossible to perform without
-- a transaction dance. The service enforces it.
CREATE TYPE "OnboardingIdentityRole" AS ENUM ('none', 'name', 'email', 'phone');

CREATE TYPE "OnboardingSubmissionStatus" AS ENUM ('new', 'in_review', 'verified', 'rejected');

CREATE TABLE "onboarding_fields" (
  "id"            UUID NOT NULL,
  "tenant_id"     UUID NOT NULL,
  "key"           TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "help_text"     TEXT,
  "placeholder"   TEXT,
  "type"          "OnboardingFieldType" NOT NULL DEFAULT 'text',
  "required"      BOOLEAN NOT NULL DEFAULT false,
  "options"       JSONB,
  "allow_other"   BOOLEAN NOT NULL DEFAULT false,
  "identity_role" "OnboardingIdentityRole" NOT NULL DEFAULT 'none',
  "sort_order"    INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "onboarding_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "onboarding_submissions" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "full_name"      TEXT,
  "email"          TEXT,
  "phone"          TEXT,
  "program_id"     UUID,
  "answers"        JSONB NOT NULL,
  "status"         "OnboardingSubmissionStatus" NOT NULL DEFAULT 'new',
  "review_notes"   TEXT,
  "reviewed_by_id" UUID,
  "reviewed_at"    TIMESTAMP(3),
  "ip_hash"        TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  "deleted_at"     TIMESTAMP(3),
  CONSTRAINT "onboarding_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboarding_fields_tenant_id_active_sort_order_idx" ON "onboarding_fields" ("tenant_id", "active", "sort_order");
CREATE INDEX "onboarding_fields_tenant_id_deleted_at_idx" ON "onboarding_fields" ("tenant_id", "deleted_at");

-- Partial unique: a soft-deleted field must not block re-creating the same key later
-- (same reason lead_forms.key and two_factor_credentials.user_id use partial uniques).
-- Prisma cannot express this, so it lives only here — see docs/phase-11-followups.md's
-- note that some UNIQUE constraints exist in migration SQL and not in schema.prisma.
CREATE UNIQUE INDEX "onboarding_fields_tenant_id_key_active_uq"
  ON "onboarding_fields" ("tenant_id", "key") WHERE "deleted_at" IS NULL;

CREATE INDEX "onboarding_submissions_tenant_id_status_created_at_idx" ON "onboarding_submissions" ("tenant_id", "status", "created_at");
CREATE INDEX "onboarding_submissions_tenant_id_program_id_idx" ON "onboarding_submissions" ("tenant_id", "program_id");
CREATE INDEX "onboarding_submissions_tenant_id_email_idx" ON "onboarding_submissions" ("tenant_id", "email");
CREATE INDEX "onboarding_submissions_tenant_id_deleted_at_idx" ON "onboarding_submissions" ("tenant_id", "deleted_at");

ALTER TABLE "onboarding_fields"
  ADD CONSTRAINT "onboarding_fields_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "onboarding_submissions"
  ADD CONSTRAINT "onboarding_submissions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ON DELETE SET NULL on both optional references: a submission is a permanent record of
-- what a student sent. Archiving the program they picked, or offboarding the staff member
-- who reviewed it, must never cascade that record away.
ALTER TABLE "onboarding_submissions"
  ADD CONSTRAINT "onboarding_submissions_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "onboarding_submissions"
  ADD CONSTRAINT "onboarding_submissions_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
