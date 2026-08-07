-- Onboarding submissions: approval workflow.
--
-- Two changes, both driven by the same shift: a submission's status stopped being a passive
-- label and became a DECISION with consequences.
--
-- 1. STATUS VALUES. `new | in_review | verified | rejected` → `pending | approved | rejected
--    | hold`. Staff asked for exactly three actions (approve / reject / hold), plus a
--    system-set arrival state. `pending` is deliberately NOT staff-selectable: it means
--    "nobody has looked yet", and letting someone set it back would erase the fact that a
--    named reviewer made a call. Existing rows are mapped, not dropped:
--        new       → pending    (untouched, same meaning)
--        in_review → hold       (a human had it open but hadn't decided)
--        verified  → approved   (same decision, clearer word)
--        rejected  → rejected
--    Postgres cannot rename enum values in place while a column depends on them, so this is
--    the standard swap: new type → USING cast with an explicit CASE → drop old → rename.
--    The DEFAULT is dropped before the cast and re-added after, because a default expression
--    typed against the old enum blocks the ALTER.
--
-- 2. STUDENT LINK. `student_profile_id` records the student that approving this submission
--    created (or matched). It is what makes approval idempotent: a submission that already
--    carries a student has already been activated, so a double-click or a retried request
--    cannot enrol the same person twice or re-send their credentials.
--    ON DELETE SET NULL — deleting a student must never delete the evidence of what they
--    submitted, exactly like the program/reviewer references already on this table.

CREATE TYPE "OnboardingSubmissionStatus_new" AS ENUM ('pending', 'approved', 'rejected', 'hold');

ALTER TABLE "onboarding_submissions" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "onboarding_submissions"
  ALTER COLUMN "status" TYPE "OnboardingSubmissionStatus_new"
  USING (
    CASE "status"::text
      WHEN 'new'       THEN 'pending'
      WHEN 'in_review' THEN 'hold'
      WHEN 'verified'  THEN 'approved'
      WHEN 'rejected'  THEN 'rejected'
      -- Unreachable given the old enum, but an ELSE keeps the cast total rather than
      -- failing the whole migration on an unexpected value.
      ELSE 'pending'
    END
  )::"OnboardingSubmissionStatus_new";

DROP TYPE "OnboardingSubmissionStatus";
ALTER TYPE "OnboardingSubmissionStatus_new" RENAME TO "OnboardingSubmissionStatus";

ALTER TABLE "onboarding_submissions" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "onboarding_submissions" ADD COLUMN "student_profile_id" UUID;

CREATE INDEX "onboarding_submissions_student_profile_id_idx"
  ON "onboarding_submissions" ("student_profile_id");

ALTER TABLE "onboarding_submissions"
  ADD CONSTRAINT "onboarding_submissions_student_profile_id_fkey"
  FOREIGN KEY ("student_profile_id") REFERENCES "student_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
