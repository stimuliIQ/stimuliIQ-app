-- Two certificates per enrollment: TRAINING (batch finished) + INTERNSHIP (project verified).
--
-- Until now `certificates` held at most ONE active row per enrollment, enforced by the
-- partial-unique index `certificates_active_enrollment_id_key`. The product now issues two
-- distinct certificates for the same enrollment, so `kind` becomes part of that key.
--
-- FORWARD-ONLY and NON-DESTRUCTIVE (CLAUDE.md §3.8):
--   * adds an enum and a NOT NULL column WITH a default — no row is rewritten by hand;
--   * WIDENS the uniqueness rule (one row per enrollment -> one per enrollment+kind), so
--     every row that was legal before is still legal. Nothing can start conflicting.
--
-- BACKFILL: existing rows become `training`. That is the correct reading of the product
-- rule — a training certificate is "issued when the batch is done", which is what every
-- certificate issued before this split represented. Any student who also earns an
-- internship certificate can now be issued one on top, because the key allows one of each.

-- 1. The kind enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CertificateKind') THEN
    CREATE TYPE "CertificateKind" AS ENUM ('training', 'internship');
  END IF;
END
$$;

-- 2. The column. DEFAULT 'training' backfills every existing row in place, so this stays a
--    metadata-only change on most Postgres versions rather than a full table rewrite.
ALTER TABLE "certificates"
  ADD COLUMN IF NOT EXISTS "kind" "CertificateKind" NOT NULL DEFAULT 'training';

-- 3. Swap the uniqueness rule.
--    Old: one active certificate per enrollment.
--    New: one active certificate per (enrollment, kind).
--
--    Dropped FIRST so the new index can be created without the old one rejecting the
--    second (internship) row. Both are partial on `deleted_at IS NULL`, matching the
--    reissue contract: revoking soft-deletes the old row, freeing the slot for a new one.
DROP INDEX IF EXISTS "certificates_active_enrollment_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "certificates_active_enrollment_kind_key"
  ON "certificates" ("enrollment_id", "kind")
  WHERE "deleted_at" IS NULL;

-- 4. Lookups filter by kind constantly (issue-if-absent checks, the CRM list's kind tab),
--    and the unique index above only helps when enrollment_id leads.
CREATE INDEX IF NOT EXISTS "certificates_tenant_kind_idx"
  ON "certificates" ("tenant_id", "kind")
  WHERE "deleted_at" IS NULL;
