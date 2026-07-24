-- Simplify the lead pipeline to a 4-stage model (2026-07 UX redesign):
--   new → follow_up → won | lost
--
-- The former 7-stage funnel (new/contacted/qualified/counselling/negotiation/won/lost)
-- collapses the four mid-funnel stages into a single `follow_up` state. Postgres cannot
-- drop enum values in place, so we swap the type: create the new 4-value enum, migrate
-- the column with a CASE mapping (backfilling existing rows), drop the old type, rename.
-- Forward-only; runs in a single transaction.

-- 0. The mv_lead_funnel_daily materialized view reads leads.stage, so it must be
--    dropped before the column type can change and recreated afterwards (its rows
--    re-derive from the backfilled column on the next refresh). Definition mirrors
--    migration 20260704060200_analytics_read_model.
DROP MATERIALIZED VIEW IF EXISTS "mv_lead_funnel_daily";

-- 1. New 4-value enum.
CREATE TYPE "LeadStage_new" AS ENUM ('new', 'follow_up', 'won', 'lost');

-- 2. Drop the column default (it references the old type).
ALTER TABLE "leads" ALTER COLUMN "stage" DROP DEFAULT;

-- 3. Convert the column, backfilling old values → the 4-stage model.
ALTER TABLE "leads"
  ALTER COLUMN "stage" TYPE "LeadStage_new"
  USING (
    CASE "stage"::text
      WHEN 'contacted'   THEN 'follow_up'
      WHEN 'qualified'   THEN 'follow_up'
      WHEN 'counselling' THEN 'follow_up'
      WHEN 'negotiation' THEN 'follow_up'
      WHEN 'won'         THEN 'won'
      WHEN 'lost'        THEN 'lost'
      ELSE 'new'
    END::"LeadStage_new"
  );

-- 4. Swap the type in place.
DROP TYPE "LeadStage";
ALTER TYPE "LeadStage_new" RENAME TO "LeadStage";

-- 5. Restore the default.
ALTER TABLE "leads" ALTER COLUMN "stage" SET DEFAULT 'new';

-- 6. Recreate the materialized view + its indexes (unchanged definition; rows
--    re-derive from the now-4-stage column). A scheduled REFRESH repopulates it.
CREATE MATERIALIZED VIEW "mv_lead_funnel_daily" AS
SELECT
  l.tenant_id                          AS tenant_id,
  date_trunc('day', l.created_at)      AS day,
  l.branch_id                          AS branch_id,
  l.owner_id                           AS owner_id,
  l.stage                              AS stage,
  COUNT(*)::bigint                     AS lead_count
FROM "leads" l
WHERE l.deleted_at IS NULL
GROUP BY l.tenant_id, date_trunc('day', l.created_at), l.branch_id, l.owner_id, l.stage
WITH DATA;

CREATE UNIQUE INDEX "mv_lead_funnel_daily_key"
  ON "mv_lead_funnel_daily" (tenant_id, day, branch_id, owner_id, stage);
CREATE INDEX "mv_lead_funnel_daily_tenant_day_idx"
  ON "mv_lead_funnel_daily" (tenant_id, day);
