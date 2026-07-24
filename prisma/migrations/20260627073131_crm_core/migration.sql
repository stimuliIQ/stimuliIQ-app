-- CreateEnum
CREATE TYPE "StudentCourseType" AS ENUM ('btech', 'degree', 'diploma', 'mca', 'mba', 'other');

-- CreateEnum
CREATE TYPE "StudentProfileStatus" AS ENUM ('lead', 'active', 'alumni');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('planned', 'active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'completed', 'dropped');

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "college" TEXT,
    "course_type" "StudentCourseType" NOT NULL,
    "year" INTEGER,
    "city" TEXT,
    "source" TEXT,
    "status" "StudentProfileStatus" NOT NULL DEFAULT 'lead',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expertise" JSONB,
    "bio" TEXT,
    "rating" DOUBLE PRECISION,
    "branch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "faculty_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "faculty_id" UUID,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL,
    "mode" "ProgramMode" NOT NULL DEFAULT 'recorded',
    "schedule" JSONB,
    "status" "BatchStatus" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE INDEX "student_profiles_tenant_id_status_idx" ON "student_profiles"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "student_profiles_tenant_id_deleted_at_idx" ON "student_profiles"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_profiles_user_id_key" ON "faculty_profiles"("user_id");

-- CreateIndex
CREATE INDEX "faculty_profiles_branch_id_idx" ON "faculty_profiles"("branch_id");

-- CreateIndex
CREATE INDEX "faculty_profiles_tenant_id_deleted_at_idx" ON "faculty_profiles"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "batches_tenant_id_program_id_idx" ON "batches"("tenant_id", "program_id");

-- CreateIndex
CREATE INDEX "batches_branch_id_idx" ON "batches"("branch_id");

-- CreateIndex
CREATE INDEX "batches_faculty_id_idx" ON "batches"("faculty_id");

-- CreateIndex
CREATE INDEX "batches_tenant_id_status_idx" ON "batches"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "batches_tenant_id_deleted_at_idx" ON "batches"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "enrollments_student_id_idx" ON "enrollments"("student_id");

-- CreateIndex
CREATE INDEX "enrollments_batch_id_idx" ON "enrollments"("batch_id");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_status_idx" ON "enrollments"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_deleted_at_idx" ON "enrollments"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_student_id_batch_id_key" ON "enrollments"("student_id", "batch_id");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
