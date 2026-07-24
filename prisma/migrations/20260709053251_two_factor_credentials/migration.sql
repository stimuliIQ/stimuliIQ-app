-- NOTE: prisma migrate dev's diff engine also proposed an unrelated
-- `ALTER TABLE "analytics_mv_refresh_log" ... SET DATA TYPE TIMESTAMP(3)` (the
-- pre-existing Phase-7 TIMESTAMPTZ-vs-Prisma-DateTime drift already excluded from
-- migrations 20260709024433 and 20260709024522). Deliberately DROPPED here too —
-- out of scope, forward-only, not applied.

-- CreateTable
CREATE TABLE "two_factor_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT[],
    "activated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "two_factor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_credentials_tenant_id_deleted_at_idx" ON "two_factor_credentials"("tenant_id", "deleted_at");

-- Partial-unique: at most ONE active (non-deleted) 2FA credential per user. Prisma's
-- declarative @@unique can't express the WHERE clause (same pattern as the other
-- ..._active_..._key indexes). Lets a user re-enrol after a soft-deleted disable.
CREATE UNIQUE INDEX "two_factor_credentials_active_user_key"
  ON "two_factor_credentials"("user_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "two_factor_credentials" ADD CONSTRAINT "two_factor_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_credentials" ADD CONSTRAINT "two_factor_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
