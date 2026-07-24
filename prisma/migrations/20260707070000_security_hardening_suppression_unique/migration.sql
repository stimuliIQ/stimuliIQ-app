-- Phase-7 Wave 2 security hardening batch A, item 2b (closes part of P6 M-3 / AC-60):
-- "bounce→suppression transition is strictly monotonic and idempotent under out-of-order
-- delivery." Prior to this migration, `notification_suppressions` had ONLY regular
-- (non-unique) indexes (see 20260703065700_engagement_partial_indexes) — nothing at the
-- DB layer prevented two concurrent webhook deliveries for the same recipient (both
-- reading the recipient's pre-update status before either write commits) from each
-- independently inserting a bounce-suppression row for the SAME (tenant, channel,
-- address), producing duplicate rows. Prisma's `@@unique` schema syntax cannot express a
-- partial index (`WHERE deleted_at IS NULL AND email/phone IS NOT NULL`), so — matching
-- the established pattern (see that same partial-indexes migration's header comment) —
-- this constraint is added here via raw SQL. campaigns.repository.ts#createBounceSuppression
-- catches the resulting P2002 unique-constraint violation as an idempotent no-op, mirroring
-- insertRecipient()'s existing P2002-as-no-op pattern.
--
-- TWO separate partial-uniques (one per address column), matching the
-- campaign_recipients_active_campaign_{lead,student,user}_key three-way split in the
-- same prior migration — a suppression row has exactly one of (email, phone) set.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- DE-DUPLICATE existing rows first: prior to this fix, addBounceToSuppression() relied
-- on a `.catch()` that assumed a DB-level unique constraint already existed (it did not
-- — see the header above), so concurrent/replayed bounce webhooks were able to insert
-- more than one ACTIVE row for the same (tenant_id, channel, email/phone). Soft-delete
-- every duplicate except the earliest (by created_at, tie-broken by id) so the unique
-- indexes below can be created without failing on pre-existing duplicate data. This does
-- NOT touch already-soft-deleted rows (they are outside the partial index's WHERE clause
-- and irrelevant to the constraint).
WITH ranked_email AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, channel, email
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM "notification_suppressions"
  WHERE "deleted_at" IS NULL AND "email" IS NOT NULL
)
UPDATE "notification_suppressions"
SET "deleted_at" = now()
WHERE id IN (SELECT id FROM ranked_email WHERE rn > 1);

WITH ranked_phone AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, channel, phone
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM "notification_suppressions"
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL
)
UPDATE "notification_suppressions"
SET "deleted_at" = now()
WHERE id IN (SELECT id FROM ranked_phone WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_suppressions_active_tenant_channel_email_key"
  ON "notification_suppressions" ("tenant_id", "channel", "email")
  WHERE "deleted_at" IS NULL
    AND "email" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_suppressions_active_tenant_channel_phone_key"
  ON "notification_suppressions" ("tenant_id", "channel", "phone")
  WHERE "deleted_at" IS NULL
    AND "phone" IS NOT NULL;
