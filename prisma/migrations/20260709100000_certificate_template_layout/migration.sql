-- Phase-9-completion gap #5: persist the CRM certificate-template designer's
-- drag-positioned merge-field layout (docs/plans — closes the "layouts aren't
-- saved" gap flagged in apps/crm/src/components/certificates/
-- cert-template-designer-drawer.tsx). Forward-only, additive; never edit a
-- shipped migration (CLAUDE.md §3.8).
--
-- NOTE: hand-written (not `prisma migrate dev` diff output) because the live DB
-- has pre-existing, intentional drift from schema.prisma (search_vector generated
-- columns added via raw-SQL migration 20260709090000_search_tsvector_index, and a
-- pre-existing TIMESTAMPTZ-vs-TIMESTAMP(3) drift on analytics_mv_refresh_log,
-- already called out in prior migrations) — running the interactive diff engine
-- would propose dropping those columns. This migration applies ONLY the single
-- additive column this task needs, matching the established
-- "hand-written migration.sql" precedent used throughout this repo for the same
-- reason (see e.g. 20260709024522_phase9_completion_partial_indexes).

ALTER TABLE "certificate_templates" ADD COLUMN "layout" JSONB;
