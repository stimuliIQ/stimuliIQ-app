-- Phase 8 follow-up: MENTOR public marketing-profile fields.
--
-- Adds the fields that bind a mentor's CRM record to the public web /mentors page:
--   photo_key         — S3/R2 object key for the mentor's photo (raw key never leaves
--                       the API; minted to a public CDN URL via mintCdnUrl, exactly like
--                       faculty_bios.photo_key / blog.cover_image_key).
--   title             — short professional headline (e.g. "Senior ML Engineer, Microsoft").
--   bio               — paragraph-length professional biography (public marketing copy).
--   years_experience  — integer years of professional experience (nullable).
--   social_links      — JSON `{ linkedin?, twitter?, github?, website? }`.
--
-- All nullable + additive-only. Forward-only; never edit shipped migrations (CLAUDE.md §3.8).
-- Mirrors the faculty_bios photo_key/title/bio/social_links precedent.

ALTER TABLE "mentors"
  ADD COLUMN "photo_key"        TEXT,
  ADD COLUMN "title"            TEXT,
  ADD COLUMN "bio"              TEXT,
  ADD COLUMN "years_experience" INTEGER,
  ADD COLUMN "social_links"     JSONB;
