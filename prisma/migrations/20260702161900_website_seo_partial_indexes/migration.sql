-- Partial indexes for the Phase-5 Marketing Website schema additions
-- (docs/plans/phase-5.md task #1, docs/05 §4). Prisma's declarative @@index / @@unique
-- cannot express partial indexes, so these are added via raw SQL in a dedicated
-- forward-only migration, matching the established pattern:
--   20260626204500_core_partial_indexes
--   20260627073500_crm_core_partial_indexes
--   20260627203400_commerce_leads_partial_indexes
--   20260702002000_lms_core_partial_indexes
--   20260702065800_learning_depth_partial_indexes
-- These complement (do not replace) the full-column indexes created in
-- 20260702161846_website_seo_marketing.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ── programs: SEO slug partial-unique ─────────────────────────────────────────────────
--
-- PURPOSE: Enforce (tenant_id, slug) uniqueness only on non-deleted programs.
--   A slug can be reused after a program is soft-deleted (deleted_at IS NOT NULL),
--   which is the correct behaviour for content that may be re-published under the same
--   URL. The full @@unique(slug) on the Prisma model serves as a global unique for
--   Prisma migration hygiene; the real uniqueness enforcement for public-facing SEO URLs
--   is this per-tenant partial-unique.
--
-- docs-writer note: docs/05 §4 listed "(slug) uniq" as a global single-column unique.
-- P5 decision: (tenant_id, slug) unique-per-tenant WHERE deleted_at IS NULL.
-- docs/05 §4 should be updated to reflect this partial-unique.

CREATE UNIQUE INDEX IF NOT EXISTS "programs_active_tenant_slug_key"
  ON "programs" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL;

-- ── programs: public catalog hot path ─────────────────────────────────────────────────
--
-- Optimised read for GET /public/programs: filters on is_public=true AND status='published'
-- within a tenant. Matches the (tenant_id, is_public, status) composite index already
-- added via Prisma @@index in the main migration, but the partial form avoids scanning
-- non-public / non-published rows on the hot public catalog endpoint.

CREATE INDEX IF NOT EXISTS "programs_public_published_idx"
  ON "programs" ("tenant_id", "slug")
  WHERE "deleted_at" IS NULL
    AND "is_public" = true
    AND "status" = 'published';

-- ── leads: attribution + consent hot paths ────────────────────────────────────────────
--
-- Index for attribution analysis: look up leads by gclid (Google Ads reconciliation).
-- Partial (deleted_at IS NULL) because soft-deleted leads are excluded from live reports.

CREATE INDEX IF NOT EXISTS "leads_active_gclid_idx"
  ON "leads" ("tenant_id", "gclid")
  WHERE "deleted_at" IS NULL
    AND "gclid" IS NOT NULL;

-- Index for attribution analysis: look up leads by fbclid (Meta Ads reconciliation).

CREATE INDEX IF NOT EXISTS "leads_active_fbclid_idx"
  ON "leads" ("tenant_id", "fbclid")
  WHERE "deleted_at" IS NULL
    AND "fbclid" IS NOT NULL;
