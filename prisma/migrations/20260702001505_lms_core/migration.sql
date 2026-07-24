-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('processing', 'ready', 'errored');

-- CreateEnum
CREATE TYPE "LessonProgressStatus" AS ENUM ('not_started', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('live', 'recorded');

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'noop',
    "provider_asset_id" TEXT,
    "duration_s" INTEGER,
    "status" "VideoStatus" NOT NULL DEFAULT 'processing',
    "captions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'not_started',
    "last_position_s" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "live_class_id" UUID,
    "lesson_id" UUID,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'present',
    "source" "AttendanceSource" NOT NULL DEFAULT 'recorded',
    "marked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "videos_lesson_id_key" ON "videos"("lesson_id");

-- CreateIndex
CREATE INDEX "videos_tenant_id_status_idx" ON "videos"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "videos_tenant_id_deleted_at_idx" ON "videos"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "lesson_progress_tenant_id_enrollment_id_idx" ON "lesson_progress"("tenant_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "lesson_progress_tenant_id_deleted_at_idx" ON "lesson_progress"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_enrollment_id_lesson_id_key" ON "lesson_progress"("enrollment_id", "lesson_id");

-- CreateIndex
CREATE INDEX "attendance_enrollment_id_live_class_id_idx" ON "attendance"("enrollment_id", "live_class_id");

-- CreateIndex
CREATE INDEX "attendance_enrollment_id_lesson_id_idx" ON "attendance"("enrollment_id", "lesson_id");

-- CreateIndex
CREATE INDEX "attendance_tenant_id_deleted_at_idx" ON "attendance"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "resources_lesson_id_idx" ON "resources"("lesson_id");

-- CreateIndex
CREATE INDEX "resources_tenant_id_deleted_at_idx" ON "resources"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
