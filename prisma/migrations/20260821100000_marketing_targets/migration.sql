-- Monthly marketing targets: a number per marketing person per month, tracked automatically.
-- Spec: docs/specs/marketing-targets.md. Decision record: ADR-0067.
--
-- WHY
--   Marketing had a scoreboard (the lead-performance report) but no goal to measure it
--   against. "Did Rahul have a good March" was a judgement call every time, and nobody on
--   the marketing team could see what they were being measured on at all — the report is
--   gated on `reports.lead_performance.view` and reads as a management tool.
--
--   This adds the goal. A target row carries TWO numbers (deals closed, rupees collected)
--   because a marketing target is "close N deals worth ₹X" and the two are one decision.
--
-- WHAT IS *NOT* HERE
--   There is no `completed`, `pending` or `achieved` column. Progress is derived on read
--   from leads.converted_at and payments.paid_at. A stored counter drifts the first time a
--   lead is reassigned, a conversion is undone or a payment is refunded — and it drifts
--   silently in the direction that flatters the number. Same discipline as leave balances.
--
-- FORWARD-ONLY and re-runnable: every statement is IF NOT EXISTS / idempotent.

-- ── 1. leads.converted_at ───────────────────────────────────────────────────────────
-- WHEN a lead closed, as opposed to `converted_student_id` (WHETHER it closed).
--
-- Not derivable from the student row: converting LINKS a lead to a StudentProfile that may
-- already have existed, so students.created_at is the day the person became a student, not
-- the day this deal closed. A monthly target must count the month the deal actually closed.
--
-- Deliberately NOT backfilled. Existing converted leads keep converted_at NULL and are
-- counted in no month. A best-effort backfill from students.created_at would silently mix
-- real and inferred close dates inside a report people are measured against — the same call
-- the lead-ownership pass made for created_by_id.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "converted_at" TIMESTAMP(3);

-- Drives the per-owner monthly rollup: "leads this owner closed inside this month".
CREATE INDEX IF NOT EXISTS "leads_tenant_id_owner_id_converted_at_idx"
  ON "leads" ("tenant_id", "owner_id", "converted_at");

-- ── 2. marketing_targets ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "marketing_targets" (
  "id"                   UUID         NOT NULL,
  "tenant_id"            UUID         NOT NULL,
  "user_id"              UUID         NOT NULL,
  -- First day of the target month, UTC midnight. A DATE rather than a (year, month) pair:
  -- one column, one index, and "this month" is a plain equality check.
  "period_month"         DATE         NOT NULL,
  -- Either number may be 0, meaning "not measured on this" — an explicit choice that hides
  -- that card, as opposed to a missing row which means "no target set at all".
  "conversions_target"   INTEGER      NOT NULL DEFAULT 0,
  -- Integer minor units (paise), never a float. CLAUDE.md §3.6.
  "revenue_target_paise" INTEGER      NOT NULL DEFAULT 0,
  "note"                 TEXT,
  "created_by_id"        UUID,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  "deleted_at"           TIMESTAMP(3),
  CONSTRAINT "marketing_targets_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "marketing_targets"
    ADD CONSTRAINT "marketing_targets_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "marketing_targets"
    ADD CONSTRAINT "marketing_targets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "marketing_targets"
    ADD CONSTRAINT "marketing_targets_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Both numbers are counts of real things and cannot be negative. A negative target would
-- make "pending" larger than the target and the progress bar run backwards.
DO $$
BEGIN
  ALTER TABLE "marketing_targets"
    ADD CONSTRAINT "marketing_targets_non_negative_ck"
    CHECK ("conversions_target" >= 0 AND "revenue_target_paise" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "marketing_targets_tenant_id_period_month_idx"
  ON "marketing_targets" ("tenant_id", "period_month");
CREATE INDEX IF NOT EXISTS "marketing_targets_tenant_id_user_id_period_month_idx"
  ON "marketing_targets" ("tenant_id", "user_id", "period_month");
CREATE INDEX IF NOT EXISTS "marketing_targets_tenant_id_deleted_at_idx"
  ON "marketing_targets" ("tenant_id", "deleted_at");

-- ONE LIVE TARGET PER PERSON PER MONTH.
--
-- Partial (`WHERE deleted_at IS NULL`) so deleting a target and setting a new one for the
-- same month works — a plain UNIQUE would have the tombstone block the replacement forever.
-- Prisma cannot express a partial unique index, so this constraint exists ONLY here, in
-- migration SQL. It is invisible in schema.prisma; see docs/05-database-design.md.
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_targets_tenant_user_month_live_key"
  ON "marketing_targets" ("tenant_id", "user_id", "period_month")
  WHERE "deleted_at" IS NULL;
