-- Phase-10 page-builder spec follow-up (docs/specs/phase-10-page-builder.md), folded into
-- the same task as `20260719090000_content_builder_site_settings`:
--
--   1. `content_pages.is_builder_managed` (Boolean, default false) — distinguishes pages
--      authored via the CRM block-based page builder (save-is-live) from the generic CMS
--      draft->publish workflow every other content_pages row uses. See the doc comment on
--      `ContentPage.isBuilderManaged` in schema.prisma for the full justification of a
--      queryable flag over an implicit "service always writes published" convention.
--   2. `partners.focus` / `partners.established` / `partners.city` (all nullable,
--      additive) — back the homepage "partner colleges" reference block
--      (apps/web/src/components/home/partner-colleges.tsx), which hardcodes these three
--      fields per college alongside the existing name/logo/url/category columns.
--
-- Both changes are additive/nullable-or-defaulted — a no-op for every existing row.
--
-- Generated the same way as `20260719090000_content_builder_site_settings` (see that
-- file's header for why `migrate dev`'s normal flow could not be used directly: a
-- pre-existing `_prisma_migrations` checksum drift on `20260715090000_certificate_serial`,
-- unrelated to this change, forces a destructive `migrate reset`). Filtered OUT the same
-- pre-existing, out-of-scope drift noise (search_vector DROP COLUMN/DROP INDEX;
-- analytics_mv_refresh_log TIMESTAMP(3) drift) that `prisma migrate diff` always proposes
-- against this dev DB. Forward-only; never edit this file after it ships (CLAUDE.md §3.8).

-- ── content_pages.is_builder_managed ──────────────────────────────────────────────────
ALTER TABLE "content_pages" ADD COLUMN "is_builder_managed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "content_pages_tenant_id_is_builder_managed_idx" ON "content_pages"("tenant_id", "is_builder_managed");

-- ── partners.focus / established / city ───────────────────────────────────────────────
ALTER TABLE "partners"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "established" INTEGER,
  ADD COLUMN "focus" TEXT;
