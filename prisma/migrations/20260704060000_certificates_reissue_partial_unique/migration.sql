-- Phase 7, Wave 1, task #3 (docs/plans/phase-7.md; pays down docs/phase-4-followups.md
-- M-2 "carried debt: cert-reissue partial-unique").
--
-- PROBLEM: `certificates.enrollment_id` carried a HARD unique constraint
-- (`certificates_enrollment_id_key`, created in migration `20260702065749_learning_depth`)
-- IN ADDITION TO the partial-unique index `certificates_active_enrollment_id_key`
-- (`UNIQUE (enrollment_id) WHERE deleted_at IS NULL`, already created in migration
-- `20260702065800_learning_depth_partial_indexes`). The hard unique applies to ALL rows
-- (including soft-deleted ones), so a soft-deleted (revoked/superseded) certificate row
-- still held the "enrollment_id" slot and blocked inserting a reissued certificate for
-- the same enrollment. The P4 workaround was a raw physical DELETE on reissue
-- (apps/api/src/modules/certificates/certificates.repository.ts `softDeleteCertificate`),
-- which lost the revoked row from the `certificates` table entirely (only the AuditLog
-- JSON snapshot survived) — violating the soft-delete convention (CLAUDE.md §3.4,
-- docs/05 §5).
--
-- FIX: drop the hard unique constraint. The partial-unique index
-- `certificates_active_enrollment_id_key` (already present) becomes the sole uniqueness
-- guarantee: at most one ACTIVE (deleted_at IS NULL) certificate per enrollment, while
-- any number of soft-deleted historical certificate rows may coexist for that same
-- enrollment. Replace it with a plain (non-unique) index so enrollment_id lookups
-- (including soft-deleted history, e.g. an admin "certificate history" view) stay
-- indexed.
--
-- Corresponding schema.prisma change: `Certificate.enrollmentId` no longer carries
-- `@unique`; `Enrollment.certificates` is now `Certificate[]` (was `Certificate?`).
-- Corresponding application change: `CertificatesRepository.softDeleteCertificate` now
-- performs a genuine soft-delete (`deleteMany` through the soft-delete Prisma extension)
-- instead of a raw `DELETE FROM certificates`.
--
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

DROP INDEX IF EXISTS "certificates_enrollment_id_key";

CREATE INDEX IF NOT EXISTS "certificates_enrollment_id_idx"
  ON "certificates" ("enrollment_id");
