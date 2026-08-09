-- "Your project was sent back for changes" — a new NotificationType.
--
-- Reviewers can now RETURN a submission (POST /crm/submissions/:id/return) instead of only
-- grading it. `SubmissionStatus.returned` has existed since Phase 4 but nothing ever wrote
-- it, so there was no event to notify on; now there is, and it needs its own type. Reusing
-- `grade_ready` would tell a student their grade is ready when in fact they have to redo
-- the work — the opposite of the required action.
--
-- Forward-only and additive: ADD VALUE never rewrites existing rows, and no code reads the
-- enum exhaustively at the database level.
--
-- NOTE FOR DEPLOY: Postgres runs ALTER TYPE ... ADD VALUE outside a transaction block on
-- older versions. `prisma migrate deploy` applies each migration file in its own
-- transaction; PG 12+ (this project targets PG 16) permits ADD VALUE inside a transaction
-- as long as the new value is not used in the SAME transaction — which it is not here.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'submission_returned';
