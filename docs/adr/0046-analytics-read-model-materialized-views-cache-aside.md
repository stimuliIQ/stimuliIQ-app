# ADR 0046: Analytics read model — materialized views + Redis cache-aside; read replica deferred

## Status
Accepted

## Context
P7's KPI dashboards (revenue, enrollment, funnel, attendance, course-engagement, campaign
performance, gamification participation, forum health — WS-A) must never compute against the
live write-path connection pool at the 100k-concurrent target (**LOCK-D1**, `docs/05 §8`,
`docs/04 §8`). The phase-7 plan's Decisions 1 and 2 asked: materialized views vs. an
event-updated summary/rollup-table approach, and whether a read replica is provisioned for P7
or deferred. Every dashboard number must also reconcile exactly to source rows
(`docs/00 §10.2`) and stay tenant + RBAC-scope isolated (AC-1 through AC-27).

## Decision
**Eight Postgres materialized views** — revenue, enrollment, funnel, attendance,
course-engagement, campaign-performance, gamification, and forum-health — are created via raw
SQL migrations (`CREATE MATERIALIZED VIEW`; Prisma's schema syntax cannot express materialized
views, so they are **not modeled in `schema.prisma`** and are invisible to a schema-file-only
review, same caveat as the P6 partial-unique-index lesson). Each MV carries a unique index
(required for `REFRESH ... CONCURRENTLY`) and preserves `tenant_id` (and, where applicable,
`branch_id`/`batch_id`/owner columns) as row-level columns so the read/service layer still
applies its own RBAC/scope filter on top — the MV never bypasses tenant isolation.

A single **`refresh_analytics_views()`** stored procedure refreshes all eight views, one
`REFRESH MATERIALIZED VIEW CONCURRENTLY` statement per view, so readers are never blocked
during a refresh. A dedicated **`analytics_mv_refresh_log`** table (view name, started_at,
finished_at, status, error) records every refresh attempt, which is what powers the "data as
of HH:MM" freshness indicator and the last-known-good fallback the spec requires when a refresh
fails (`docs/plans/phase-7.md` Part 4 WS-A edge cases). The procedure is invoked on a schedule
via `@nestjs/schedule` cron (see ADR-0048), not BullMQ.

On top of the MVs, the analytics service layer adds a **Redis cache-aside** layer keyed
`endpoint:tenant:scope:actor:params` — the actor is part of the key (not just tenant+params)
because two callers with different data-scopes (e.g. a Faculty member's assigned-batch view vs.
an Admin's all-scope view) must never share a cached response.

**No read replica is provisioned in P7.** The primary serves both write-path and MV-refresh/
analytics-read traffic; provisioning a replica is deferred until the k6 load test (task #17)
produces evidence of primary contention.

## Consequences
- Every dashboard number is traceable to a direct recomputation against source tables (AC-1,
  AC-7, AC-10, AC-14, AC-17, AC-20, AC-23, AC-26) because each MV's defining query *is* that
  recomputation, materialized.
- MVs and the refresh procedure are **raw-SQL-only** — `db-architect`/reviewers must check the
  migration SQL directly; `schema.prisma` alone will not show these objects.
- Two dashboards can never numerically disagree for the same range/filter by construction —
  both the Overview widget and the dedicated Revenue dashboard, for example, read the same MV.
- Freshness is surfaced, not assumed: the UI can render "data as of HH:MM" from
  `analytics_mv_refresh_log`, and a failed refresh degrades to a visible staleness warning
  rather than a 500.
- The primary DB now carries MV-refresh load in addition to write-path load; this is the
  documented stopgap flagged as a P7 risk — the k6 load test is the intended forcing function
  for the read-replica decision, not a guess.
- Cache-aside is a secondary latency optimization on top of an already-precomputed MV, not a
  substitute for it — cache entries are short-TTL and safe to lose (a cache miss just re-reads
  the MV).

## Alternatives considered
- **Event-updated summary/rollup tables** (maintained incrementally by triggers or domain-event
  listeners). Rejected — higher ongoing engineering cost (trigger maintenance, backfill on
  schema change, drift risk between the rollup and a direct recomputation) for no benefit over
  a materialized view, which is itself always re-derivable from a single recomputation query.
- **Provision a read replica now.** Rejected for P7 — premature infra cost/complexity before
  k6 (task #17) demonstrates actual primary contention; the decision is deferred, not
  abandoned.
- **Live aggregate queries against the primary on every dashboard request.** Rejected — this is
  precisely what LOCK-D1 forbids; it risks write-path latency degradation as concurrent
  dashboard traffic grows toward the 100k target.
- **`REFRESH MATERIALIZED VIEW` (non-concurrent).** Rejected — locks the view against reads
  during refresh, which would make a dashboard 5xx or hang during every refresh window; the
  concurrent variant (requiring the unique index) avoids this entirely.

## Related
Extends the raw-SQL-partial-index pattern used for `campaign_recipients`/`points_ledger`/
`user_badges` (P6, ADR-0044) to materialized views. Refresh scheduling is detailed in
ADR-0048.
