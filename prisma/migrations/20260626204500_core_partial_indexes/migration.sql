-- Partial indexes `WHERE deleted_at IS NULL` for hot soft-deleted tables (docs/05 §4).
-- Prisma's declarative `@@index` cannot express partial indexes, so these are added via
-- raw SQL in a dedicated forward-only migration, per db-architect instructions.
-- These complement (do not replace) the full-column unique/composite indexes already
-- created in 20260626204031_core_init.

-- users: fast lookup of active (non-deleted) accounts by tenant+email.
CREATE INDEX IF NOT EXISTS "users_active_tenant_email_idx"
  ON "users" ("tenant_id", "email")
  WHERE "deleted_at" IS NULL;

-- programs: catalog browse/filter on live (non-deleted) programs.
CREATE INDEX IF NOT EXISTS "programs_active_tenant_domain_status_idx"
  ON "programs" ("tenant_id", "domain", "status")
  WHERE "deleted_at" IS NULL;

-- sessions: active (non-revoked, non-deleted) session lookups by user.
CREATE INDEX IF NOT EXISTS "sessions_active_user_idx"
  ON "sessions" ("user_id")
  WHERE "deleted_at" IS NULL AND "revoked_at" IS NULL;

-- roles: active role lookups by tenant.
CREATE INDEX IF NOT EXISTS "roles_active_tenant_idx"
  ON "roles" ("tenant_id")
  WHERE "deleted_at" IS NULL;

-- user_roles: active role-assignment lookups by user.
CREATE INDEX IF NOT EXISTS "user_roles_active_user_idx"
  ON "user_roles" ("user_id")
  WHERE "deleted_at" IS NULL;

-- role_permissions: active permission-grant lookups by role.
CREATE INDEX IF NOT EXISTS "role_permissions_active_role_idx"
  ON "role_permissions" ("role_id")
  WHERE "deleted_at" IS NULL;
