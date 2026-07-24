-- CreateEnum
CREATE TYPE "AssignmentKind" AS ENUM ('assignment', 'project');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'graded', 'returned');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('quiz', 'test');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('mcq', 'descriptive');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('valid', 'revoked');

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "kind" "AssignmentKind" NOT NULL DEFAULT 'assignment',
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "max_score" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3),
    "allow_resubmit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_milestones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assignment_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "milestone_id" UUID,
    "enrollment_id" UUID NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "text" TEXT,
    "link" TEXT,
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'submitted',
    "score" INTEGER,
    "rubric" JSONB,
    "feedback" TEXT,
    "graded_by" UUID,
    "graded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL DEFAULT 'quiz',
    "time_limit_s" INTEGER,
    "pass_pct" INTEGER NOT NULL,
    "attempts_allowed" INTEGER NOT NULL DEFAULT 1,
    "shuffle" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'mcq',
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "answer_key" JSONB,
    "points" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "passed" BOOLEAN,
    "started_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "time_expires_at" TIMESTAMP(3),
    "flags" JSONB NOT NULL DEFAULT '{}',
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "design" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "cert_uid" TEXT NOT NULL,
    "template_id" UUID NOT NULL,
    "storage_key" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "issued_by" UUID NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'valid',
    "revoked_reason" TEXT,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_lesson_id_idx" ON "assignments"("lesson_id");

-- CreateIndex
CREATE INDEX "assignments_tenant_id_deleted_at_idx" ON "assignments"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "assignment_milestones_assignment_id_order_idx" ON "assignment_milestones"("assignment_id", "order");

-- CreateIndex
CREATE INDEX "assignment_milestones_tenant_id_deleted_at_idx" ON "assignment_milestones"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "submissions_assignment_id_enrollment_id_idx" ON "submissions"("assignment_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "submissions_tenant_id_status_idx" ON "submissions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "submissions_tenant_id_deleted_at_idx" ON "submissions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "assessments_module_id_idx" ON "assessments"("module_id");

-- CreateIndex
CREATE INDEX "assessments_tenant_id_deleted_at_idx" ON "assessments"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "assessment_questions_assessment_id_order_idx" ON "assessment_questions"("assessment_id", "order");

-- CreateIndex
CREATE INDEX "assessment_questions_tenant_id_deleted_at_idx" ON "assessment_questions"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "attempts_assessment_id_enrollment_id_idx" ON "attempts"("assessment_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "attempts_tenant_id_enrollment_id_idx" ON "attempts"("tenant_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "attempts_tenant_id_deleted_at_idx" ON "attempts"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "certificate_templates_tenant_id_status_idx" ON "certificate_templates"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "certificate_templates_tenant_id_deleted_at_idx" ON "certificate_templates"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_enrollment_id_key" ON "certificates"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_cert_uid_key" ON "certificates"("cert_uid");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_status_idx" ON "certificates"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_student_id_idx" ON "certificates"("tenant_id", "student_id");

-- CreateIndex
CREATE INDEX "certificates_tenant_id_deleted_at_idx" ON "certificates"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_milestones" ADD CONSTRAINT "assignment_milestones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_milestones" ADD CONSTRAINT "assignment_milestones_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "assignment_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "certificate_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
