-- Phase 7, Wave 1, task #4 (docs/plans/phase-7.md; docs/specs/phase-7-analytics-
-- hardening.md AC-33): durable export/report jobs table for scheduled + large/background
-- exports. See the `ExportJob` model doc comment in schema.prisma for the full rationale.
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "ExportJobStatus" NOT NULL DEFAULT 'queued',
    "storage_key" TEXT,
    "error" TEXT,
    "row_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_jobs_tenant_id_status_idx" ON "export_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "export_jobs_tenant_id_requested_by_idx" ON "export_jobs"("tenant_id", "requested_by");

-- CreateIndex
CREATE INDEX "export_jobs_tenant_id_deleted_at_idx" ON "export_jobs"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial index (WHERE deleted_at IS NULL) for the hot "active export jobs" list
-- (CRM export-history view — matches the established partial-index convention).
CREATE INDEX "export_jobs_active_tenant_status_idx"
  ON "export_jobs" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "export_jobs_active_tenant_requested_by_idx"
  ON "export_jobs" ("tenant_id", "requested_by")
  WHERE "deleted_at" IS NULL;
