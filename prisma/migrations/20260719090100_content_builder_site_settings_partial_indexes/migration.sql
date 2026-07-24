-- Partial-unique index for `site_settings`, matching the established pattern documented
-- in migration `20260709024522_phase9_completion_partial_indexes` (Prisma's declarative
-- @@unique cannot express a WHERE clause). Forward-only; never edit shipped migrations
-- (CLAUDE.md §3.8).

-- ── site_settings: per-tenant key uniqueness only among active rows ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "site_settings_active_tenant_key_key"
  ON "site_settings" ("tenant_id", "key")
  WHERE "deleted_at" IS NULL;
