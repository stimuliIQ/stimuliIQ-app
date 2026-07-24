-- Phase 7, Wave 2, task #7 (backend-builder: analytics query/service layer,
-- docs/plans/phase-7.md, docs/specs/phase-7-analytics-hardening.md LOCK-D1).
--
-- The eight materialized views created in `20260704060200_analytics_read_model` have no
-- built-in "last refreshed at" timestamp -- PostgreSQL does not expose one for
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` (it is not tracked in pg_stat_user_tables the
-- way autovacuum/autoanalyze timestamps are). Every KPI dashboard response carries a
-- `ReportFreshnessSchema` (asOf/stale) so the UI can show "data as of HH:MM" instead of
-- silently presenting stale numbers as current (Part 4 edge case: "Materialized-view
-- refresh job fails -> dashboard falls back to last-known-good + visible staleness
-- warning, never a 500"). This table is the source of that freshness data.
--
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8). The not-yet-built
-- report-scheduling task (docs/plans/phase-7.md task #11, `@nestjs/schedule` cron)
-- continues to call `CALL refresh_analytics_views();` exactly as documented in the prior
-- migration -- no change needed on that caller's side; this migration only replaces the
-- procedure BODY (via `CREATE OR REPLACE`, in a NEW migration, never an edit to the old
-- file) so every refresh automatically maintains this log for free.
--
-- Global table (no tenant_id): the freshness of a materialized view is a platform-wide
-- fact, not a per-tenant one (every tenant's rows live in the same MV, refreshed
-- together). No soft-delete column: this is operational bookkeeping, not a business
-- record.

CREATE TABLE "analytics_mv_refresh_log" (
  "mv_name"         TEXT PRIMARY KEY,
  "last_success_at" TIMESTAMPTZ,
  "last_attempt_at" TIMESTAMPTZ,
  "last_error"       TEXT
);

-- Seed one row per MV, marking the initial `WITH DATA` population (in the prior
-- migration) as the first successful "refresh" so a freshly-migrated environment has a
-- sane, non-null `asOf` immediately -- never a blank/absent freshness on a brand-new
-- deploy, before the Wave-2 cron has run even once.
INSERT INTO "analytics_mv_refresh_log" ("mv_name", "last_success_at", "last_attempt_at", "last_error")
VALUES
  ('mv_revenue_daily',              now(), now(), NULL),
  ('mv_enrollment_daily',           now(), now(), NULL),
  ('mv_lead_funnel_daily',          now(), now(), NULL),
  ('mv_attendance_daily',           now(), now(), NULL),
  ('mv_course_engagement_daily',    now(), now(), NULL),
  ('mv_campaign_performance_daily', now(), now(), NULL),
  ('mv_gamification_daily',         now(), now(), NULL),
  ('mv_forum_health_daily',         now(), now(), NULL);

-- Replace refresh_analytics_views() so each REFRESH is wrapped with freshness-log
-- bookkeeping. Each MV's refresh is isolated in its own EXCEPTION block: a failure
-- refreshing one MV is caught, recorded in analytics_mv_refresh_log.last_error, and does
-- NOT abort the remaining MVs' refreshes (same isolation goal as the original
-- COMMIT-per-MV design, extended to also survive a single MV's refresh error without
-- losing the others).
CREATE OR REPLACE PROCEDURE refresh_analytics_views()
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_revenue_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_revenue_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_revenue_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_revenue_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_enrollment_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_enrollment_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_enrollment_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_enrollment_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_lead_funnel_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_lead_funnel_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_lead_funnel_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_lead_funnel_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_attendance_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_attendance_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_attendance_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_attendance_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_course_engagement_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_course_engagement_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_course_engagement_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_course_engagement_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_campaign_performance_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_campaign_performance_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_campaign_performance_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_campaign_performance_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_gamification_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_gamification_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_gamification_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_gamification_daily';
  END;
  COMMIT;

  BEGIN
    UPDATE "analytics_mv_refresh_log" SET last_attempt_at = now() WHERE mv_name = 'mv_forum_health_daily';
    REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_forum_health_daily";
    UPDATE "analytics_mv_refresh_log" SET last_success_at = now(), last_error = NULL WHERE mv_name = 'mv_forum_health_daily';
  EXCEPTION WHEN OTHERS THEN
    UPDATE "analytics_mv_refresh_log" SET last_error = SQLERRM WHERE mv_name = 'mv_forum_health_daily';
  END;
  COMMIT;
END;
$$;
