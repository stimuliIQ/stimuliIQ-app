-- Partial indexes `WHERE deleted_at IS NULL` for the Phase-6 Engagement hot tables
-- (docs/05 §4 + docs/plans/phase-6.md task #1). Prisma's declarative @@index / @@unique
-- cannot express partial indexes, so these are added via raw SQL in a dedicated
-- forward-only migration, matching the established pattern:
--   20260626204500_core_partial_indexes
--   20260627073500_crm_core_partial_indexes
--   20260627203400_commerce_leads_partial_indexes
--   20260702002000_lms_core_partial_indexes
--   20260702065800_learning_depth_partial_indexes
--   20260702161900_website_seo_partial_indexes
-- These complement (do not replace) the full-column indexes already created in
-- 20260703065630_engagement_core.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ── notifications: partial indexes ────────────────────────────────────────────────────

-- Active unread notifications for a user (the hot path for the notification center badge count).
-- docs/05 §4: (user_id, read_at) index for unread counts.
CREATE INDEX IF NOT EXISTS "notifications_active_user_unread_idx"
  ON "notifications" ("user_id", "read_at")
  WHERE "deleted_at" IS NULL
    AND "read_at" IS NULL;

-- Active notifications by user (full list — notification center, includes read+unread).
CREATE INDEX IF NOT EXISTS "notifications_active_user_idx"
  ON "notifications" ("user_id")
  WHERE "deleted_at" IS NULL;

-- ── notification_prefs: partial index ─────────────────────────────────────────────────

-- Active prefs lookup by user (consulted on every fan-out).
CREATE INDEX IF NOT EXISTS "notification_prefs_active_user_idx"
  ON "notification_prefs" ("user_id")
  WHERE "deleted_at" IS NULL;

-- ── notification_suppressions: partial indexes ────────────────────────────────────────

-- Active suppressions lookup by email + channel (checked before every email send).
CREATE INDEX IF NOT EXISTS "notification_suppressions_active_email_channel_idx"
  ON "notification_suppressions" ("tenant_id", "email", "channel")
  WHERE "deleted_at" IS NULL
    AND "email" IS NOT NULL;

-- Active suppressions lookup by phone + channel (checked before every SMS/WhatsApp send).
CREATE INDEX IF NOT EXISTS "notification_suppressions_active_phone_channel_idx"
  ON "notification_suppressions" ("tenant_id", "phone", "channel")
  WHERE "deleted_at" IS NULL
    AND "phone" IS NOT NULL;

-- ── campaign_templates: partial index ────────────────────────────────────────────────

-- Active templates by tenant+channel (template selector in the CRM campaign builder).
CREATE INDEX IF NOT EXISTS "campaign_templates_active_tenant_channel_idx"
  ON "campaign_templates" ("tenant_id", "channel")
  WHERE "deleted_at" IS NULL;

-- ── campaigns: partial index ──────────────────────────────────────────────────────────

-- Active campaigns by status (scheduled, sending, paused listings in CRM Marketing).
CREATE INDEX IF NOT EXISTS "campaigns_active_tenant_status_idx"
  ON "campaigns" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

-- ── campaign_recipients: partial indexes + dedupe unique ──────────────────────────────
--
-- PURPOSE (per-recipient idempotent send — plan §2 "Idempotent send"):
--   A recipient should be targeted at most once per campaign. Replaying the campaign
--   send job (at-least-once dispatch) or a race condition must not create a double row.
--   The campaign service checks before insert; this index provides the DB-level backstop.
--
-- DESIGN (matching the submissions partial-unique pattern from learning_depth_partial_indexes):
--   Prisma cannot express partial-unique with a WHERE clause. The constraint lives here
--   in a raw-SQL migration. We provide THREE separate partial-uniques — one per recipient
--   type (lead / student / user) — because SQL COALESCE cannot be used in a
--   standard partial index predicate with nullable alternatives in a single index.
--   The service enforces: exactly one of (lead_id, student_id, user_id) is non-null per row.
--
-- LAYER 1 — DB partial-uniques (one per recipient column, guarded by IS NOT NULL):
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_active_campaign_lead_key"
  ON "campaign_recipients" ("campaign_id", "lead_id")
  WHERE "deleted_at" IS NULL
    AND "lead_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_active_campaign_student_key"
  ON "campaign_recipients" ("campaign_id", "student_id")
  WHERE "deleted_at" IS NULL
    AND "student_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_active_campaign_user_key"
  ON "campaign_recipients" ("campaign_id", "user_id")
  WHERE "deleted_at" IS NULL
    AND "user_id" IS NOT NULL;

-- Active recipients for delivery status query (the campaign send worker + metrics rollup).
CREATE INDEX IF NOT EXISTS "campaign_recipients_active_campaign_status_idx"
  ON "campaign_recipients" ("campaign_id", "status")
  WHERE "deleted_at" IS NULL;

-- Active provider_message_id lookup (webhook ingestion idempotency check).
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_active_provider_message_id_key"
  ON "campaign_recipients" ("provider_message_id")
  WHERE "deleted_at" IS NULL
    AND "provider_message_id" IS NOT NULL;

-- ── badges: partial index ────────────────────────────────────────────────────────────

-- Active badge catalog by tenant (gamification UI + award evaluation).
CREATE INDEX IF NOT EXISTS "badges_active_tenant_idx"
  ON "badges" ("tenant_id")
  WHERE "deleted_at" IS NULL
    AND "status" = 'active';

-- ── user_badges: partial unique ──────────────────────────────────────────────────────
--
-- PURPOSE: A badge is awarded at most once per user (among active awards).
--   Soft-deleting a user_badge and re-creating it is allowed (badge revocation +
--   re-award flow). Only one active (deleted_at IS NULL) row per (user_id, badge_id)
--   is permitted at any time.
--
-- DESIGN: partial-unique on (user_id, badge_id) WHERE deleted_at IS NULL.
--   The Prisma model has no @@unique on these two columns (which would block re-awards
--   after a soft-delete). The service checks this index before inserting.

CREATE UNIQUE INDEX IF NOT EXISTS "user_badges_active_user_badge_key"
  ON "user_badges" ("user_id", "badge_id")
  WHERE "deleted_at" IS NULL;

-- ── points_ledger: partial unique (idempotent append-only awards) ────────────────────
--
-- PURPOSE: Idempotent award — replaying the same domain event (at-least-once dispatch,
--   webhook retry, event-bus redelivery) for the same (user, reason, ref) must not
--   produce a double-award row. This is the anti-abuse / anti-double-count backstop.
--
-- DESIGN: partial-unique on (user_id, reason, ref) WHERE deleted_at IS NULL.
--   Reversal rows have reason='reversal' (a different reason key), so they are NOT
--   caught by this unique — reversals are additive by design.
--   Rows where ref IS NULL are excluded from the unique (system-level entries without
--   a ref cannot conflict with each other — each is intentional).
--   The service checks this index before inserting; the unique is the DB backstop.

CREATE UNIQUE INDEX IF NOT EXISTS "points_ledger_active_user_reason_ref_key"
  ON "points_ledger" ("user_id", "reason", "ref")
  WHERE "deleted_at" IS NULL
    AND "ref" IS NOT NULL;

-- ── forum_threads: partial index ──────────────────────────────────────────────────────

-- Active threads by batch (enrollment-scoped read + forum listing page).
CREATE INDEX IF NOT EXISTS "forum_threads_active_batch_status_idx"
  ON "forum_threads" ("tenant_id", "batch_id", "status")
  WHERE "deleted_at" IS NULL;

-- Active pinned threads (pinned threads surfaced at the top of the thread list).
CREATE INDEX IF NOT EXISTS "forum_threads_active_pinned_idx"
  ON "forum_threads" ("tenant_id", "batch_id", "pinned")
  WHERE "deleted_at" IS NULL
    AND "pinned" = true;

-- ── forum_posts: partial indexes ──────────────────────────────────────────────────────

-- Active visible posts in a thread (the thread reader view).
CREATE INDEX IF NOT EXISTS "forum_posts_active_thread_visible_idx"
  ON "forum_posts" ("thread_id", "status")
  WHERE "deleted_at" IS NULL
    AND "status" = 'visible';

-- Active top-level posts (parent_id IS NULL = top-level post, not a reply).
CREATE INDEX IF NOT EXISTS "forum_posts_active_thread_toplevel_idx"
  ON "forum_posts" ("thread_id")
  WHERE "deleted_at" IS NULL
    AND "parent_id" IS NULL;

-- ── forum_post_votes: partial unique (one upvote per user per post) ──────────────────
--
-- PURPOSE: Anti-abuse vote deduplication — a user can upvote each post at most once.
--   If they soft-delete their vote (un-vote) and re-vote, a new row is created; only
--   one active (deleted_at IS NULL) vote per (post_id, user_id) at a time.
--
-- DESIGN: partial-unique on (post_id, user_id) WHERE deleted_at IS NULL.
--   Matching the user_badges and submissions partial-unique patterns above.

CREATE UNIQUE INDEX IF NOT EXISTS "forum_post_votes_active_post_user_key"
  ON "forum_post_votes" ("post_id", "user_id")
  WHERE "deleted_at" IS NULL;
