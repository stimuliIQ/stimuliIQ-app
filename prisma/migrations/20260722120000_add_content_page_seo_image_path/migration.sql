-- Phase-11 locked page templates (docs/plans/phase-11-locked-templates.md): a per-page
-- social/OG image, closing the "OG image is sitewide-only today" gap (SiteSetting's
-- seo.defaults.defaultOgImagePath JSON field remains the fallback when a page has none).
-- Nullable, additive on both the live table and its immutable version-snapshot history
-- table -- every existing row is unaffected (null until a super_admin sets one via the
-- CRM template-form editor's SEO disclosure).
ALTER TABLE "content_pages" ADD COLUMN "seo_image_path" TEXT;
ALTER TABLE "content_page_versions" ADD COLUMN "seo_image_path" TEXT;
