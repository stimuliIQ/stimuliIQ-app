-- Partial indexes `WHERE deleted_at IS NULL` for the Phase-1 CRM-core hot tables
-- (docs/05 §4 + docs/plans/phase-1.md task #1). Prisma's declarative `@@index` cannot
-- express partial indexes, so these are added via raw SQL in a dedicated forward-only
-- migration, matching the pattern established in 20260626204500_core_partial_indexes.
-- These complement (do not replace) the full-column composite indexes already created
-- in 20260627073131_crm_core.

-- student_profiles: directory listing filtered to active (non-deleted) rows by status.
CREATE INDEX IF NOT EXISTS "student_profiles_active_tenant_status_idx"
  ON "student_profiles" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- faculty_profiles: active faculty lookups by branch (branch-scope authorization checks).
CREATE INDEX IF NOT EXISTS "faculty_profiles_active_branch_idx"
  ON "faculty_profiles" ("branch_id")
  WHERE "deleted_at" IS NULL;

-- batches: active batch listing/roster lookups by program and by status within a tenant.
CREATE INDEX IF NOT EXISTS "batches_active_tenant_program_idx"
  ON "batches" ("tenant_id", "program_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "batches_active_tenant_status_idx"
  ON "batches" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- batches: active faculty-assigned roster/scope lookups.
CREATE INDEX IF NOT EXISTS "batches_active_faculty_idx"
  ON "batches" ("faculty_id")
  WHERE "deleted_at" IS NULL;

-- enrollments: active roster/dashboard lookups by student, by batch, and by status.
CREATE INDEX IF NOT EXISTS "enrollments_active_student_idx"
  ON "enrollments" ("student_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "enrollments_active_batch_idx"
  ON "enrollments" ("batch_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "enrollments_active_tenant_status_idx"
  ON "enrollments" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- enrollments: enforce the (student_id, batch_id) uniqueness only among non-soft-deleted
-- rows, so a withdrawn/soft-deleted enrollment does not block re-enrolling the same
-- student into the same batch later. This SUPERSEDES the full-column unique index from
-- 20260627073131_crm_core for the purpose of new-row uniqueness checks; the full-column
-- unique constraint is left in place (harmless, slightly stricter) since dropping a
-- constraint created in an already-shipped migration would require editing that
-- migration, which is forbidden (CLAUDE.md §3.8). New write paths should rely on this
-- partial index's semantics being checked at the application layer if soft-deleted
-- enrollments need to be re-creatable; revisit if conflicts are observed in practice.
CREATE UNIQUE INDEX IF NOT EXISTS "enrollments_active_student_batch_key"
  ON "enrollments" ("student_id", "batch_id")
  WHERE "deleted_at" IS NULL;
