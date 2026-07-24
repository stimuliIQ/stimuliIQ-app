-- Phase 8 (corrected direction): human MENTOR feature — a real subject-matter expert
-- HIRED FROM AN EXTERNAL INSTITUTE who leads a batch of students through the
-- internship program. Distinct from `faculty_profiles` (internal hire).
--
-- NOTE: an earlier "AI mentor" concept was planned in docs/plans/phase-8.md /
-- docs/specs/phase-8-ai-mentor.md but was NEVER implemented in the schema (confirmed:
-- no ai_conversations/ai_messages/etc. tables exist in any prior migration) — so there
-- is nothing to remove here. docs-writer should mark those two files superseded.
--
-- New tables: mentors, batch_mentors (mentor <-> batch assignment join).
-- Minimal completion-tracking addition: batches.completed_at / completed_by_user_id
-- (nullable). Completion % itself is a ROLLUP over existing enrollment/lesson_progress/
-- assignment/assessment/certificate data computed in the service layer (Wave-2
-- backend) — deliberately NOT a new progress table (docs/05 §3 already covers this).
--
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8). The partial-unique on
-- batch_mentors(batch_id, mentor_id) WHERE deleted_at IS NULL is NOT expressible in
-- Prisma's `@@unique` and lives in the companion migration
-- 20260708080100_mentors_partial_indexes, matching the established pattern (see
-- submissions_active_no_resubmit_unique / user_badges_active_user_badge_key).

-- CreateEnum
CREATE TYPE "MentorEngagementStatus" AS ENUM ('prospective', 'active', 'inactive');

-- AlterTable: minimal batch completion-tracking columns (nullable, additive-only).
ALTER TABLE "batches" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "completed_by_user_id" UUID;

-- CreateTable
CREATE TABLE "mentors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "external_institute" TEXT NOT NULL,
    "expertise" JSONB,
    "engagement_status" "MentorEngagementStatus" NOT NULL DEFAULT 'prospective',
    "joined_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "mentors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_mentors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "batch_mentors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mentors_user_id_key" ON "mentors"("user_id");

-- CreateIndex
CREATE INDEX "mentors_tenant_id_engagement_status_idx" ON "mentors"("tenant_id", "engagement_status");

-- CreateIndex
CREATE INDEX "mentors_tenant_id_deleted_at_idx" ON "mentors"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "batch_mentors_tenant_id_batch_id_idx" ON "batch_mentors"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "batch_mentors_tenant_id_mentor_id_idx" ON "batch_mentors"("tenant_id", "mentor_id");

-- CreateIndex
CREATE INDEX "batch_mentors_tenant_id_deleted_at_idx" ON "batch_mentors"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "mentors" ADD CONSTRAINT "mentors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentors" ADD CONSTRAINT "mentors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_mentors" ADD CONSTRAINT "batch_mentors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_mentors" ADD CONSTRAINT "batch_mentors_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_mentors" ADD CONSTRAINT "batch_mentors_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_mentors" ADD CONSTRAINT "batch_mentors_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
