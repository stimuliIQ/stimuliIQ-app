-- Partial-unique indexes for Phase-9 Completion Wave 1 (docs/plans/phase-9-completion.md
-- T6-T12). Prisma's declarative @@unique cannot express a WHERE clause, so these live in
-- a dedicated raw-SQL migration, matching the established pattern:
--   20260626204500_core_partial_indexes
--   20260627073500_crm_core_partial_indexes
--   20260627203400_commerce_leads_partial_indexes
--   20260702002000_lms_core_partial_indexes
--   20260702065800_learning_depth_partial_indexes
--   20260702161900_website_seo_partial_indexes
--   20260703065700_engagement_partial_indexes
--   20260704060100_analytics_hot_path_indexes
--   20260708080100_mentors_partial_indexes
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).
--
-- NOTE (db-architect): `prisma migrate dev`'s diff engine also proposed
-- `ALTER TABLE "analytics_mv_refresh_log" ALTER COLUMN "last_success_at"/"last_attempt_at"
-- SET DATA TYPE TIMESTAMP(3)` again here (same pre-existing Phase-7 TIMESTAMPTZ-vs-
-- TIMESTAMP(3) drift already called out in migration `20260709024433_phase9_completion_
-- core`). Deliberately DROPPED — out of scope for this Phase-9 schema task; flagged as a
-- follow-up, not applied.

-- ── kb_articles: per-tenant slug uniqueness only among active (non-deleted) rows ─────
CREATE UNIQUE INDEX IF NOT EXISTS "kb_articles_active_tenant_slug_key"
  ON "kb_articles" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- ── blog_categories: per-tenant slug uniqueness only among active rows ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS "blog_categories_active_tenant_slug_key"
  ON "blog_categories" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- ── blog_posts: per-tenant slug uniqueness only among active rows ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_active_tenant_slug_key"
  ON "blog_posts" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- ── content_pages: per-tenant slug uniqueness only among active rows ─────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "content_pages_active_tenant_slug_key"
  ON "content_pages" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- ── newsletter_subscriptions: per-tenant email uniqueness only among active
--    (non-unsubscribed/non-soft-deleted) rows — a re-subscribe after unsubscribe
--    (soft-delete) is allowed to create a fresh active row. ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_subscriptions_active_tenant_email_key"
  ON "newsletter_subscriptions" ("tenant_id", "email")
  WHERE "deleted_at" IS NULL;

-- ── feature_flags: per-tenant key uniqueness only among active rows ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_active_tenant_key_key"
  ON "feature_flags" ("tenant_id", "key")
  WHERE "deleted_at" IS NULL;

-- ── settings: per-tenant (scope, key) uniqueness only among active rows ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS "settings_active_tenant_scope_key_key"
  ON "settings" ("tenant_id", "scope", "key")
  WHERE "deleted_at" IS NULL;

-- ── bookmarks: at most one active bookmark per (user, ref_type, ref_id) ──────────────
CREATE UNIQUE INDEX IF NOT EXISTS "bookmarks_active_user_ref_key"
  ON "bookmarks" ("user_id", "ref_type", "ref_id")
  WHERE "deleted_at" IS NULL;

-- ── referrals: per-tenant referral code uniqueness only among active rows ────────────
CREATE UNIQUE INDEX IF NOT EXISTS "referrals_active_tenant_code_key"
  ON "referrals" ("tenant_id", "code")
  WHERE "deleted_at" IS NULL;

-- ── emi_plans: at most one ACTIVE EMI plan per order (reissue after cancellation
--    soft-deletes the old row, matching the certificates_active_enrollment_id_key
--    "reissue" pattern). ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "emi_plans_active_order_id_key"
  ON "emi_plans" ("order_id")
  WHERE "deleted_at" IS NULL;

-- ── emi_installments: at most one active row per (emi_plan_id, installment_no) ───────
CREATE UNIQUE INDEX IF NOT EXISTS "emi_installments_active_plan_installment_key"
  ON "emi_installments" ("emi_plan_id", "installment_no")
  WHERE "deleted_at" IS NULL;

-- ── landing_pages: per-tenant (slug, variant) uniqueness only among active rows ──────
CREATE UNIQUE INDEX IF NOT EXISTS "landing_pages_active_tenant_slug_variant_key"
  ON "landing_pages" ("tenant_id", "slug", "variant")
  WHERE "deleted_at" IS NULL;

-- ── lead_forms: per-tenant key uniqueness only among active rows ─────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "lead_forms_active_tenant_key_key"
  ON "lead_forms" ("tenant_id", "key")
  WHERE "deleted_at" IS NULL;
