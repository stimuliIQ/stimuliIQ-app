-- Partial-unique index for the Phase-8 Mentor feature (docs/05 §4 + this task's brief).
-- Prisma's declarative @@unique cannot express a WHERE clause, so this lives in a
-- dedicated raw-SQL migration, matching the established pattern:
--   20260626204500_core_partial_indexes
--   20260627073500_crm_core_partial_indexes
--   20260627203400_commerce_leads_partial_indexes
--   20260702002000_lms_core_partial_indexes
--   20260702065800_learning_depth_partial_indexes
--   20260702161900_website_seo_partial_indexes
--   20260703065700_engagement_partial_indexes
--   20260704060100_analytics_hot_path_indexes
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ── batch_mentors: partial unique (one ACTIVE assignment per mentor per batch) ───────
--
-- PURPOSE: A mentor should be assigned to a given batch at most once among ACTIVE
--   (non-soft-deleted) assignment rows. Un-assigning (soft-delete) and re-assigning the
--   same mentor to the same batch later (re-engagement) is allowed — only one active
--   row per (batch_id, mentor_id) pair is permitted at any time.
--
-- DESIGN: partial-unique on (batch_id, mentor_id) WHERE deleted_at IS NULL, matching the
--   user_badges_active_user_badge_key / forum_post_votes_active_post_user_key pattern.
--   The service layer checks this before insert; the unique is the DB-level backstop.

CREATE UNIQUE INDEX IF NOT EXISTS "batch_mentors_active_batch_mentor_key"
  ON "batch_mentors" ("batch_id", "mentor_id")
  WHERE "deleted_at" IS NULL;
