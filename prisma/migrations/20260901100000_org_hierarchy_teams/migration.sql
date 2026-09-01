-- Org hierarchy: teams, managers, team leads (docs/specs/org-teams.md, ADR-0069).
--
-- ADDITIVE ONLY. One new table, one new nullable column on `users`, three new indexes and
-- two partial-unique indexes. Nothing existing is altered or dropped, so this is safe to
-- `migrate deploy` against a live database.
--
-- WHY THIS EXISTS: the product had no employee hierarchy of any kind. The only
-- org-partitioning column was `user_roles.branch_id` — a flat per-assignment tag — so leave
-- approval was hardcoded to "every active super_admin" and one person signed off every
-- absence in the company.
--
-- SHAPE: Manager -> Team Lead -> Members, held as two nullable pointers ON THE TEAM rather
-- than a recursive `users.reports_to_id`. A recursive parent pointer needs cycle detection on
-- every write and an unbounded walk on every approval; two pointers give a fixed-depth chain
-- (member -> lead -> manager -> super_admin) that cannot form a cycle by construction.
--
-- `users.team_id` is a plain nullable FK rather than a team_members join table BECAUSE
-- membership is exactly one team per person: one column makes the wrong state
-- unrepresentable, where a join needs a partial-unique index to say the same thing and can
-- drift. NULL is the normal state for anyone not yet on the org chart.

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manager_user_id" UUID,
    "lead_user_id" UUID,
    "branch_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_tenant_id_active_idx" ON "teams"("tenant_id", "active");
CREATE INDEX "teams_tenant_id_deleted_at_idx" ON "teams"("tenant_id", "deleted_at");
CREATE INDEX "teams_manager_user_id_idx" ON "teams"("manager_user_id");
CREATE INDEX "teams_lead_user_id_idx" ON "teams"("lead_user_id");

-- Partial unique: two live teams may not share a name inside one tenant, but a soft-deleted
-- team must not block the name being reused. Prisma cannot express a partial unique, so it
-- lives here in raw SQL — the same pattern as course_types.key and onboarding_fields.key.
CREATE UNIQUE INDEX "teams_tenant_id_name_live_key"
    ON "teams"("tenant_id", "name")
    WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_user_id_fkey"
    FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_user_id_fkey"
    FOREIGN KEY ("lead_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: one nullable column. Every existing user gets NULL, which is the honest
-- "not placed on the org chart yet" state and routes their leave to the HR/super-admin
-- fallback — i.e. exactly today's behaviour, with no backfill.
ALTER TABLE "users" ADD COLUMN "team_id" UUID;

-- CreateIndex: team roster reads ("everyone on this team") and the team-scoped filters.
CREATE INDEX "users_tenant_id_team_id_idx" ON "users"("tenant_id", "team_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
