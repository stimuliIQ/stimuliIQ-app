-- First-login onboarding gate (lifecycle-redesign P3).
-- Set true when an LMS account is auto-provisioned with a system-generated
-- TEMPORARY password (on enrollment). While true the LMS forces a password
-- change before any content is accessible; the change-password flow clears it.
-- Default false so every existing/staff account is unaffected.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
