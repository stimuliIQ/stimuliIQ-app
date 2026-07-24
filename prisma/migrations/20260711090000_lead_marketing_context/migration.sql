-- Marketing lead-form context for the timed/exit-intent lead popup (docs/01 §7.7).
--
-- Adds three free-text fields the marketing-site lead popup captures on top of
-- the existing name/phone/email/program_interest:
--   course_interest — free-text program the visitor typed (e.g. "Full Stack Web
--                     Development"); distinct from program_interest (FK) which
--                     requires a match against the catalog.
--   college         — the visitor's college/university (free text).
--   language        — the visitor's preferred contact language (free text).
--
-- All nullable + additive-only: existing leads (newsletter, sticky bar, API,
-- pre-migration rows) are unaffected. Forward-only; never edit shipped
-- migrations (CLAUDE.md §3.8).

ALTER TABLE "leads"
  ADD COLUMN "course_interest" TEXT,
  ADD COLUMN "college"         TEXT,
  ADD COLUMN "language"        TEXT;
