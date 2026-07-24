-- Lead popup message box (marketing-site timed lead popup).
--
-- Adds one free-text field on top of the existing popup context columns
-- (course_interest / college / language, 20260711090000_lead_marketing_context):
--   message — the visitor's free-text question/note typed into the popup.
--             Surfaced read-only in the CRM lead detail drawer.
--
-- Nullable + additive-only: existing leads are unaffected. Forward-only;
-- never edit shipped migrations (CLAUDE.md §3.8).

ALTER TABLE "leads"
  ADD COLUMN "message" TEXT;
