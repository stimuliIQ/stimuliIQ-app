-- Phase 7, Wave 2, task #11 (backend-builder: scheduled MV-refresh + recurring report
-- scheduling, docs/plans/phase-7.md, docs/specs/phase-7-analytics-hardening.md AC-37/38/39).
--
-- Adds `report_schedules` — recurring report-email definitions. Offered ONLY for the 8
-- report-backed export types (never raw entity-list exports). Deliberately carries NO
-- scope/branch/assigned snapshot: AC-37 requires the creator's CURRENT permission scope
-- to be re-evaluated at SEND time by the dispatch cron (never a value cached on this row).
--
-- Column types/defaults follow the exact `export_jobs` (20260704060300) precedent:
-- Prisma generates `id` client-side (@default(uuid()), no DB default), `TIMESTAMP(3)`
-- for created/updated/deleted at, `updated_at` has no DB default (Prisma's @updatedAt
-- sets it on every write). Forward-only; never edit a shipped migration (CLAUDE.md §3.8).

-- CreateEnum
CREATE TYPE "ReportScheduleFrequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "ReportScheduleRunStatus" AS ENUM ('succeeded', 'failed', 'skipped_suppressed', 'sent_no_data');

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "recipient_email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "last_status" "ReportScheduleRunStatus",
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — dispatch cron's due-schedule scan (`WHERE tenant_id = ? AND active = true
-- AND next_run_at <= now() AND deleted_at IS NULL`) hits this index.
CREATE INDEX "report_schedules_tenant_id_active_next_run_at_idx" ON "report_schedules"("tenant_id", "active", "next_run_at");

-- CreateIndex — GET /crm/reports/schedules (own-scope list: "schedules I created").
CREATE INDEX "report_schedules_tenant_id_created_by_idx" ON "report_schedules"("tenant_id", "created_by");

-- CreateIndex — soft-delete filtering, matching every other P0-P7 table's convention.
CREATE INDEX "report_schedules_tenant_id_deleted_at_idx" ON "report_schedules"("tenant_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial index (WHERE deleted_at IS NULL) for the hot "due schedules" scan, matching the
-- export_jobs_active_* partial-index convention.
CREATE INDEX "report_schedules_active_due_idx"
  ON "report_schedules" ("active", "next_run_at")
  WHERE "deleted_at" IS NULL;
