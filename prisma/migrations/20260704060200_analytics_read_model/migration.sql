-- Phase 7, Wave 1, task #1 (docs/plans/phase-7.md; docs/specs/phase-7-analytics-
-- hardening.md LOCK-D1): Analytics read model — eight PostgreSQL MATERIALIZED VIEWs, one
-- per dashboard KPI area, plus a single refresh entrypoint.
--
-- Prisma cannot model materialized views, so this is raw SQL. See the "Analytics read
-- model (materialized views)" comment block in schema.prisma (near the end of the file,
-- just before the Governance section) for the canonical per-MV documentation. This file
-- is the DDL; that comment block is the design rationale — keep them in sync if either
-- changes (forward-only: a future migration, not an edit to this one).
--
-- CONVENTIONS applied to every MV below:
--   * Every MV carries `tenant_id` as a column.
--   * Every MV is grouped by a `day` column (`date_trunc('day', <event timestamp>)`).
--   * Every MV excludes soft-deleted source rows (`deleted_at IS NULL`).
--   * Every MV has a UNIQUE index on its full group-by column set — REQUIRED for
--     `REFRESH MATERIALIZED VIEW CONCURRENTLY` (readers are never blocked during
--     refresh).
--   * Every MV also gets a plain (tenant_id, day) index for the common "this tenant,
--     this date range" scan, in addition to the unique index (which may have a wider
--     column list not always leading with day usefully for a range scan).
--
-- Forward-only; never edit shipped migrations (CLAUDE.md §3.8).

-- ════════════════════════════════════════════════════════════════════════════════════
-- 1) mv_revenue_daily — revenue dashboard (AC-1)
-- ════════════════════════════════════════════════════════════════════════════════════
-- Source: payments (status='captured') LEFT JOIN orders LEFT JOIN enrollments (via
-- order_id, active only) LEFT JOIN batches (branch attribution).
-- CAVEAT (documented in schema.prisma): branch_id is only populated when the payment's
-- order has a matching active enrollment whose batch carries a branch_id.
CREATE MATERIALIZED VIEW "mv_revenue_daily" AS
SELECT
  p.tenant_id                          AS tenant_id,
  date_trunc('day', p.paid_at)         AS day,
  o.currency                           AS currency,
  o.program_id                         AS program_id,
  b.branch_id                          AS branch_id,
  SUM(p.amount_paise)::bigint          AS total_paise,
  COUNT(*)::bigint                     AS payment_count
FROM "payments" p
JOIN "orders" o ON o.id = p.order_id
LEFT JOIN "enrollments" e ON e.order_id = o.id AND e.deleted_at IS NULL
LEFT JOIN "batches" b ON b.id = e.batch_id
WHERE p.deleted_at IS NULL
  AND p.status = 'captured'
  AND p.paid_at IS NOT NULL
GROUP BY p.tenant_id, date_trunc('day', p.paid_at), o.currency, o.program_id, b.branch_id
WITH DATA;

CREATE UNIQUE INDEX "mv_revenue_daily_key"
  ON "mv_revenue_daily" (tenant_id, day, currency, program_id, branch_id);
CREATE INDEX "mv_revenue_daily_tenant_day_idx"
  ON "mv_revenue_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 2) mv_enrollment_daily — enrollment trend dashboard (AC-7)
-- ════════════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "mv_enrollment_daily" AS
SELECT
  e.tenant_id                          AS tenant_id,
  date_trunc('day', e.enrolled_at)     AS day,
  e.program_id                         AS program_id,
  e.batch_id                           AS batch_id,
  b.branch_id                          AS branch_id,
  COUNT(*)::bigint                     AS enrollment_count
FROM "enrollments" e
JOIN "batches" b ON b.id = e.batch_id
WHERE e.deleted_at IS NULL
GROUP BY e.tenant_id, date_trunc('day', e.enrolled_at), e.program_id, e.batch_id, b.branch_id
WITH DATA;

CREATE UNIQUE INDEX "mv_enrollment_daily_key"
  ON "mv_enrollment_daily" (tenant_id, day, batch_id, program_id);
CREATE INDEX "mv_enrollment_daily_tenant_day_idx"
  ON "mv_enrollment_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 3) mv_lead_funnel_daily — lead funnel/conversion dashboard (AC-10)
-- ════════════════════════════════════════════════════════════════════════════════════
-- Conversion rate (won / total) is computed by the query layer:
--   SUM(lead_count) FILTER (WHERE stage='won') / SUM(lead_count) over the filtered rows.
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

-- ════════════════════════════════════════════════════════════════════════════════════
-- 4) mv_attendance_daily — attendance dashboard (AC-14)
-- ════════════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "mv_attendance_daily" AS
SELECT
  a.tenant_id                                                AS tenant_id,
  date_trunc('day', a.marked_at)                              AS day,
  e.batch_id                                                  AS batch_id,
  b.branch_id                                                 AS branch_id,
  COUNT(*) FILTER (WHERE a.status = 'present')::bigint        AS present_count,
  COUNT(*) FILTER (WHERE a.status = 'absent')::bigint         AS absent_count,
  COUNT(*)::bigint                                            AS total_count
FROM "attendance" a
JOIN "enrollments" e ON e.id = a.enrollment_id
JOIN "batches" b ON b.id = e.batch_id
WHERE a.deleted_at IS NULL
GROUP BY a.tenant_id, date_trunc('day', a.marked_at), e.batch_id, b.branch_id
WITH DATA;

CREATE UNIQUE INDEX "mv_attendance_daily_key"
  ON "mv_attendance_daily" (tenant_id, day, batch_id);
CREATE INDEX "mv_attendance_daily_tenant_day_idx"
  ON "mv_attendance_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 5) mv_course_engagement_daily — course/video engagement dashboard (AC-17/AC-18)
-- ════════════════════════════════════════════════════════════════════════════════════
-- CAVEAT (documented in schema.prisma): bucketed by lesson_progress.updated_at
-- (last-activity day), not a dedicated completion-event ledger. Per-lesson drop-off
-- ordering and roster-size-based completion % are computed by the Wave-2 query layer
-- joining this MV with `lessons.order` and `enrollments`, outside the MV.
CREATE MATERIALIZED VIEW "mv_course_engagement_daily" AS
SELECT
  lp.tenant_id                                                    AS tenant_id,
  date_trunc('day', lp.updated_at)                                AS day,
  e.program_id                                                    AS program_id,
  m.id                                                             AS module_id,
  lp.lesson_id                                                    AS lesson_id,
  e.batch_id                                                      AS batch_id,
  COUNT(*) FILTER (WHERE lp.status = 'completed')::bigint         AS completed_count,
  COUNT(*) FILTER (WHERE lp.status = 'in_progress')::bigint       AS in_progress_count,
  COUNT(*)::bigint                                                AS total_count
FROM "lesson_progress" lp
JOIN "enrollments" e ON e.id = lp.enrollment_id
JOIN "lessons" l ON l.id = lp.lesson_id
JOIN "modules" m ON m.id = l.module_id
WHERE lp.deleted_at IS NULL
GROUP BY lp.tenant_id, date_trunc('day', lp.updated_at), e.program_id, m.id, lp.lesson_id, e.batch_id
WITH DATA;

CREATE UNIQUE INDEX "mv_course_engagement_daily_key"
  ON "mv_course_engagement_daily" (tenant_id, day, lesson_id, batch_id);
CREATE INDEX "mv_course_engagement_daily_tenant_day_idx"
  ON "mv_course_engagement_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 6) mv_campaign_performance_daily — campaign performance dashboard (AC-20)
-- ════════════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW "mv_campaign_performance_daily" AS
SELECT
  cr.tenant_id                         AS tenant_id,
  date_trunc('day', cr.created_at)     AS day,
  cr.campaign_id                       AS campaign_id,
  c.channel                            AS channel,
  cr.status                            AS status,
  COUNT(*)::bigint                     AS recipient_count
FROM "campaign_recipients" cr
JOIN "campaigns" c ON c.id = cr.campaign_id
WHERE cr.deleted_at IS NULL
GROUP BY cr.tenant_id, date_trunc('day', cr.created_at), cr.campaign_id, c.channel, cr.status
WITH DATA;

CREATE UNIQUE INDEX "mv_campaign_performance_daily_key"
  ON "mv_campaign_performance_daily" (tenant_id, day, campaign_id, status);
CREATE INDEX "mv_campaign_performance_daily_tenant_day_idx"
  ON "mv_campaign_performance_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 7) mv_gamification_daily — gamification participation dashboard (AC-23)
-- ════════════════════════════════════════════════════════════════════════════════════
-- UNION-ALL of two independently-grouped source CTEs (points_ledger, user_badges),
-- re-summed by (tenant_id, day, user_id) — avoids a FULL OUTER JOIN on nullable keys
-- (not an issue here since user_id is NOT NULL on both sources, but UNION ALL + re-sum
-- is used consistently across every multi-source MV in this file for a single
-- predictable pattern; see mv_forum_health_daily below where nullable join keys make
-- UNION ALL the ONLY safe option).
-- CAVEAT (documented in schema.prisma + the PointsLedger model comment): no batch_id
-- dimension — points_ledger/user_badges carry no batch reference. Assigned/branch scope
-- for Faculty is resolved by the query layer via a separate student-roster lookup,
-- filtering this MV's rows by `user_id IN (...)`.
CREATE MATERIALIZED VIEW "mv_gamification_daily" AS
WITH points_agg AS (
  SELECT
    tenant_id,
    date_trunc('day', created_at) AS day,
    user_id,
    SUM(delta)::bigint AS total_xp,
    COUNT(*) FILTER (WHERE delta > 0)::bigint AS earning_events,
    0::bigint AS badge_count
  FROM "points_ledger"
  WHERE deleted_at IS NULL
  GROUP BY tenant_id, date_trunc('day', created_at), user_id
),
badges_agg AS (
  SELECT
    tenant_id,
    date_trunc('day', awarded_at) AS day,
    user_id,
    0::bigint AS total_xp,
    0::bigint AS earning_events,
    COUNT(*)::bigint AS badge_count
  FROM "user_badges"
  WHERE deleted_at IS NULL
  GROUP BY tenant_id, date_trunc('day', awarded_at), user_id
),
combined AS (
  SELECT * FROM points_agg
  UNION ALL
  SELECT * FROM badges_agg
)
SELECT
  tenant_id,
  day,
  user_id,
  SUM(total_xp)::bigint AS total_xp,
  SUM(earning_events)::bigint AS earning_events,
  SUM(badge_count)::bigint AS badge_count
FROM combined
GROUP BY tenant_id, day, user_id
WITH DATA;

CREATE UNIQUE INDEX "mv_gamification_daily_key"
  ON "mv_gamification_daily" (tenant_id, day, user_id);
CREATE INDEX "mv_gamification_daily_tenant_day_idx"
  ON "mv_gamification_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- 8) mv_forum_health_daily — forum health dashboard (AC-26)
-- ════════════════════════════════════════════════════════════════════════════════════
-- UNION-ALL of two independently-grouped source CTEs (forum_threads, forum_posts via
-- thread join), re-summed by (tenant_id, day, batch_id, program_id). UNION ALL (not a
-- FULL OUTER JOIN) is REQUIRED here because batch_id/program_id are both nullable —
-- `NULL = NULL` never matches in a JOIN ON clause, which would silently duplicate rows
-- for any thread/post group with a NULL key. GROUP BY (unlike JOIN ON) treats NULLs as
-- equal, so re-summing via UNION ALL + GROUP BY is the correct, safe combination.
-- CAVEAT (documented in schema.prisma + ForumThread model comment): forum_threads has no
-- `resolved_at` timestamp, so resolved_count buckets by thread CREATION day, not
-- resolution day (a resolution that happens on a later day than the thread's creation is
-- still counted correctly in the ALL-TIME total, just attributed to the creation day's
-- bucket for trend purposes).
CREATE MATERIALIZED VIEW "mv_forum_health_daily" AS
WITH thread_agg AS (
  SELECT
    tenant_id,
    date_trunc('day', created_at) AS day,
    batch_id,
    program_id,
    COUNT(*)::bigint AS thread_count,
    COUNT(*) FILTER (WHERE status = 'resolved')::bigint AS resolved_count,
    0::bigint AS post_count
  FROM "forum_threads"
  WHERE deleted_at IS NULL
  GROUP BY tenant_id, date_trunc('day', created_at), batch_id, program_id
),
post_agg AS (
  SELECT
    ft.tenant_id AS tenant_id,
    date_trunc('day', fp.created_at) AS day,
    ft.batch_id AS batch_id,
    ft.program_id AS program_id,
    0::bigint AS thread_count,
    0::bigint AS resolved_count,
    COUNT(*)::bigint AS post_count
  FROM "forum_posts" fp
  JOIN "forum_threads" ft ON ft.id = fp.thread_id
  WHERE fp.deleted_at IS NULL
  GROUP BY ft.tenant_id, date_trunc('day', fp.created_at), ft.batch_id, ft.program_id
),
combined AS (
  SELECT * FROM thread_agg
  UNION ALL
  SELECT * FROM post_agg
)
SELECT
  tenant_id,
  day,
  batch_id,
  program_id,
  SUM(thread_count)::bigint AS thread_count,
  SUM(resolved_count)::bigint AS resolved_count,
  SUM(post_count)::bigint AS post_count
FROM combined
GROUP BY tenant_id, day, batch_id, program_id
WITH DATA;

CREATE UNIQUE INDEX "mv_forum_health_daily_key"
  ON "mv_forum_health_daily" (tenant_id, day, batch_id, program_id);
CREATE INDEX "mv_forum_health_daily_tenant_day_idx"
  ON "mv_forum_health_daily" (tenant_id, day);

-- ════════════════════════════════════════════════════════════════════════════════════
-- Refresh entrypoint — refresh_analytics_views()
-- ════════════════════════════════════════════════════════════════════════════════════
-- A PROCEDURE, not a FUNCTION: `REFRESH MATERIALIZED VIEW CONCURRENTLY` cannot run
-- inside an open transaction block, and a plain function's body always executes inside
-- the transaction of its calling statement. A PL/pgSQL PROCEDURE (PG11+) may issue
-- `COMMIT` between statements when invoked at the top level via `CALL` (i.e. NOT from
-- inside an explicit surrounding transaction) — each `REFRESH ... CONCURRENTLY` +
-- `COMMIT` pair below runs as its own transaction, so a failure refreshing one MV does
-- not roll back an already-completed refresh of another.
--
-- USAGE (Wave 2, @nestjs/schedule cron — docs/plans/phase-7.md Decision 3):
--   await prisma.$executeRawUnsafe('CALL refresh_analytics_views()');
-- Must be called at the top level (not inside `prisma.$transaction(...)`).
CREATE OR REPLACE PROCEDURE refresh_analytics_views()
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_revenue_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_enrollment_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_lead_funnel_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_attendance_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_course_engagement_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_campaign_performance_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_gamification_daily";
  COMMIT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_forum_health_daily";
  COMMIT;
END;
$$;
