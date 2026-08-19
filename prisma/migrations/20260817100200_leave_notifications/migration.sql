-- Three new NotificationType values for staff leave (docs/specs/leave-management.md).
--
--   leave_requested — fans out to every active super_admin. The approval queue has exactly
--                     one audience, and it must not depend on somebody remembering to open
--                     the CRM.
--   leave_approved  — to the applicant.
--   leave_rejected  — to the applicant, carrying the reviewer's mandatory reason.
--
-- These default to email as well as in-app, unlike `lead_assigned` (the other staff-facing
-- work-queue type, which is in-app only). Volume is a handful a month rather than one per
-- lead, and people book travel off the answer — an unread bell is not good enough.
--
-- Forward-only and additive: ADD VALUE never rewrites existing rows, and no code reads the
-- enum exhaustively at the database level. PG 12+ permits ADD VALUE inside a transaction as
-- long as the new value is not used in the same transaction, which it is not here.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'leave_requested';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'leave_approved';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'leave_rejected';
