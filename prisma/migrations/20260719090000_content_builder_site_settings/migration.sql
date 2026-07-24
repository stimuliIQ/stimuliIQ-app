-- Content Builder + Site Settings (CRM page builder, super_admin-only).
--
-- NEW TABLES:
--   content_page_versions — immutable snapshot history for ContentPage (see the doc
--     comment on the `ContentPageVersion` model in schema.prisma). `version` is
--     app-assigned/monotonic per content_page_id (not a DB sequence).
--   site_settings — keyed sitewide marketing primitives (nav/footer/SEO/contact/stats),
--     deliberately a NEW model rather than a reuse of the existing `settings` table — see
--     the doc comment on the `SiteSetting` model in schema.prisma for the RBAC-isolation
--     rationale (site_settings.* permissions are super_admin-only; the existing
--     settings.view/edit permissions are already granted more broadly).
--
-- Generated via `prisma migrate diff --from-url <live dev DB> --to-schema-datamodel
-- prisma/schema.prisma --script`, hand-filtered down to ONLY the statements for these two
-- new tables. Filtered OUT (deliberately, same "flag, don't apply" precedent as the
-- db-architect note in migration `20260709024522_phase9_completion_partial_indexes`):
--   - DROP INDEX on lessons/resources/forum_threads.search_vector and the matching
--     ALTER TABLE ... DROP COLUMN "search_vector" — these are the raw-SQL-only generated
--     tsvector/GIN columns from migration `20260709090000_search_tsvector_index`
--     (ADR-0060). They are NOT represented in schema.prisma by design (no Prisma field),
--     so a schema-diff run against schema.prisma always proposes dropping them. Out of
--     scope for this migration; not applied.
--   - ALTER TABLE analytics_mv_refresh_log ... SET DATA TYPE TIMESTAMP(3) — the
--     pre-existing TIMESTAMPTZ-vs-TIMESTAMP(3) drift already called out (and deliberately
--     not applied) in migrations `20260709024433_phase9_completion_core` and
--     `20260709024522_phase9_completion_partial_indexes`. Still out of scope here.
--
-- `migrate dev`'s normal shadow-database diff/apply flow could not be used to generate
-- this file directly: the dev DB's `_prisma_migrations` checksum for a prior,
-- already-applied migration (`20260715090000_certificate_serial`) no longer matches the
-- on-disk file bytes (pre-existing local checkout drift, not introduced by this change —
-- `git diff` on that file is clean), which forces `migrate dev` to demand a full
-- `migrate reset` (destructive, drops all local dev data) before it will proceed. Rather
-- than reset, this file was generated via `prisma migrate diff` (which reads live schema
-- state directly, bypassing the `_prisma_migrations` checksum check) and is applied via
-- `prisma db execute` + registered with `prisma migrate resolve --applied`. Forward-only;
-- never edit this file after it ships (CLAUDE.md §3.8).

-- ── content_page_versions ─────────────────────────────────────────────────────────────
CREATE TABLE "content_page_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "content_page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "content_page_versions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_page_versions_content_page_id_created_at_idx" ON "content_page_versions"("content_page_id", "created_at");

CREATE INDEX "content_page_versions_tenant_id_deleted_at_idx" ON "content_page_versions"("tenant_id", "deleted_at");

-- Hard unique (not partial) — version snapshots are append-only history, no
-- reissue-after-soft-delete scenario. `version DESC` makes this index directly usable
-- for the CRM history-list query without a second index.
CREATE UNIQUE INDEX "content_page_versions_content_page_id_version_key" ON "content_page_versions"("content_page_id", "version" DESC);

ALTER TABLE "content_page_versions" ADD CONSTRAINT "content_page_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "content_page_versions" ADD CONSTRAINT "content_page_versions_content_page_id_fkey" FOREIGN KEY ("content_page_id") REFERENCES "content_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "content_page_versions" ADD CONSTRAINT "content_page_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── site_settings ──────────────────────────────────────────────────────────────────────
CREATE TABLE "site_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "site_settings_tenant_id_group_idx" ON "site_settings"("tenant_id", "group");

CREATE INDEX "site_settings_tenant_id_deleted_at_idx" ON "site_settings"("tenant_id", "deleted_at");

ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
