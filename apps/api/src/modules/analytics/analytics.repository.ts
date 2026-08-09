// apps/api/src/modules/analytics/analytics.repository.ts
//
// Prisma / raw-SQL data access ONLY for the Phase-7 KPI dashboards (docs/plans/phase-7.md
// task #7, docs/specs/phase-7-analytics-hardening.md WS-A). CLAUDE.md §3.3: "repository —
// Prisma data access only ... No business logic."
//
// LOCK-D1 (docs/specs/phase-7-analytics-hardening.md): every heavy dashboard aggregate
// reads the eight materialized views created in migration `20260704060200_analytics_read_model`
// (see prisma/schema.prisma "Analytics read model" comment block for the canonical per-MV
// column documentation) — NEVER the live write-path tables. Prisma cannot model a
// PostgreSQL MATERIALIZED VIEW, so every MV read here is a parameterized `$queryRaw`
// tagged-template query (never string interpolation — no SQL injection surface). The one
// documented exception is the campaign-performance dashboard, which AnalyticsService reads
// via the existing `CampaignsService.getCampaignMetrics()` (a live, already-tenant-scoped
// lookup of the authoritative `campaigns.metrics` cache) instead of
// `mv_campaign_performance_daily`, specifically so it can never drift from that field
// (AC-20 "no drift" requirement) — see analytics.service.ts for that call site.
//
// SCOPE HELPERS mirror the established per-module convention (leads.repository.ts
// `listCallerBranchIds`, assessments.repository.ts `findFacultyProfileId`/
// `findAssignedBatchIds`) rather than introducing a new cross-module abstraction — every
// scope-bearing repository in this codebase resolves its own branch/assigned id sets the
// same way; duplicating the (cheap, indexed) lookup here keeps this repository
// self-contained.
//
// Every query is ALWAYS tenant-scoped. `deleted_at IS NULL` is already baked into every MV
// (see the MV DDL) so repository queries here do not need to repeat it for MV reads.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

// ─────────────────────────────────────────────────────────────────────────────
// Freshness (LOCK-D1 — every dashboard response carries asOf/stale)
// ─────────────────────────────────────────────────────────────────────────────

export interface MvFreshness {
  asOf: Date;
  stale: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes returned by each MV query (raw SQL result contracts)
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueDayRow {
  day: Date;
  currency: string;
  programId: string | null;
  totalPaise: bigint;
}

export interface EnrollmentDayRow {
  day: Date;
  count: bigint;
}

export interface FunnelStageRow {
  stage: string;
  count: bigint;
}

export interface EngagementLessonRow {
  lessonId: string;
  completedCount: bigint;
}

export interface GamificationUserRow {
  userId: string;
  totalXp: bigint;
  earningEvents: bigint;
  badgeCount: bigint;
}

export interface ForumHealthAggRow {
  threadCount: bigint;
  resolvedCount: bigint;
  postCount: bigint;
}

/**
 * The 8 Phase-7 analytics MVs (migration `20260704060200_analytics_read_model`), in the
 * same refresh order as the original `refresh_analytics_views()` procedure. Must stay in
 * lock-step with the `analytics_mv_refresh_log` seed rows.
 */
const ANALYTICS_MATERIALIZED_VIEWS = [
  "mv_revenue_daily",
  "mv_enrollment_daily",
  "mv_lead_funnel_daily",
  // Retired with the attendance feature; the view still EXISTS in the DB (tables were
  // kept), and this list mirrors `analytics_mv_refresh_log`, so it stays listed here.
  "mv_attendance_daily",
  "mv_course_engagement_daily",
  "mv_campaign_performance_daily",
  "mv_gamification_daily",
  "mv_forum_health_daily",
] as const;

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── MV refresh (Wave 2 task #11 — AnalyticsMvRefreshScheduler) ─────────────

  /**
   * Refreshes the 8 Phase-7 materialized views, maintaining `analytics_mv_refresh_log`
   * exactly as the `refresh_analytics_views()` procedure (migration
   * `20260704060400_analytics_refresh_log`) did.
   *
   * WHY NOT `CALL refresh_analytics_views()` anymore (2026-07-26 prod incident): the
   * procedure `COMMIT`s between MVs, and production's runtime DATABASE_URL goes through
   * the Supabase pgbouncer pooler in TRANSACTION mode — transaction control inside a
   * procedure is illegal in that context, so every scheduled run failed with SQLSTATE
   * 2D000 ("invalid transaction termination") and the MVs silently went stale. Issuing
   * each REFRESH as its own single autocommit statement is pooler-safe and preserves the
   * procedure's isolation semantics: one MV's failure is recorded in `last_error` and
   * never blocks the remaining MVs. The procedure itself is left in place (forward-only
   * migrations) — it simply is no longer the path the app takes.
   *
   * MV names come from the fixed const list below — `$executeRawUnsafe` interpolates
   * only those known identifiers (REFRESH cannot be parameterized); error text is bound
   * as a real parameter via the tagged template.
   */
  async refreshMaterializedViews(): Promise<void> {
    // Upserts, not UPDATEs: production's log table was found EMPTY (2026-07-26 — the
    // migration's seed rows are gone, likely from a pre-launch data reset), and a
    // missing row reads as maximally stale in getFreshness() forever. Upserting heals
    // the bookkeeping rows on the next refresh tick instead of silently no-op'ing.
    for (const mv of ANALYTICS_MATERIALIZED_VIEWS) {
      await this.prisma.client.$executeRaw`
        INSERT INTO "analytics_mv_refresh_log" (mv_name, last_attempt_at)
        VALUES (${mv}, now())
        ON CONFLICT (mv_name) DO UPDATE SET last_attempt_at = now()`;
      try {
        await this.prisma.client.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${mv}"`);
        await this.prisma.client.$executeRaw`
          INSERT INTO "analytics_mv_refresh_log" (mv_name, last_success_at, last_attempt_at)
          VALUES (${mv}, now(), now())
          ON CONFLICT (mv_name) DO UPDATE SET last_success_at = now(), last_error = NULL`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.client.$executeRaw`
          INSERT INTO "analytics_mv_refresh_log" (mv_name, last_attempt_at, last_error)
          VALUES (${mv}, now(), ${message})
          ON CONFLICT (mv_name) DO UPDATE SET last_error = ${message}`;
      }
    }
  }

  // ─── Freshness ──────────────────────────────────────────────────────────────

  /**
   * Reads the freshness bookkeeping row maintained by `refresh_analytics_views()`
   * (migration `20260704060400_analytics_refresh_log`). Never throws / never 500s on a
   * missing or never-refreshed row (Part 4 edge case: "refresh job fails -> falls back to
   * last-known-good + visible staleness warning, never 500") — a missing row (should only
   * happen if a future MV is added without a matching seed row) surfaces as maximally
   * stale (epoch `asOf`), never as "fresh".
   */
  async getFreshness(mvName: string): Promise<MvFreshness> {
    const row = await this.prisma.client.analyticsRefreshLog.findUnique({ where: { mvName } });
    if (!row || !row.lastSuccessAt) {
      return { asOf: new Date(0), stale: true };
    }
    return { asOf: row.lastSuccessAt, stale: row.lastError !== null };
  }

  // ─── Scope resolution helpers ────────────────────────────────────────────────

  /** Faculty profile id for a user, or null if the user has none (tenant-scoped). */
  async findFacultyProfileId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** Batch ids taught by a faculty member (`batches.faculty_id`). */
  async findAssignedBatchIds(tenantId: string, facultyProfileId: string): Promise<string[]> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, facultyId: facultyProfileId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Branch ids granted to the caller via `user_roles.branch_id` (mirrors leads.repository.ts). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((r) => r.branchId).filter((id): id is string => id !== null);
  }

  /** Batch ids belonging to any of the given branches (branch-scope's batch restriction). */
  async listBatchIdsForBranches(tenantId: string, branchIds: string[]): Promise<string[]> {
    if (branchIds.length === 0) return [];
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, branchId: { in: branchIds }, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Distinct active/completed student User ids enrolled across the given batches. */
  async resolveUserIdsForBatches(tenantId: string, batchIds: string[]): Promise<string[]> {
    if (batchIds.length === 0) return [];
    const rows = await this.prisma.client.enrollment.findMany({
      where: {
        tenantId,
        deletedAt: null,
        batchId: { in: batchIds },
        status: { in: ["active", "completed"] },
      },
      select: { student: { select: { userId: true } } },
      distinct: ["studentId"],
    });
    return rows.map((r) => r.student.userId);
  }

  /** Total active/completed enrollment count for a program, optionally restricted to batches. */
  async countEnrollments(tenantId: string, programId: string, batchIds: string[] | null): Promise<number> {
    if (batchIds !== null && batchIds.length === 0) return 0;
    return this.prisma.client.enrollment.count({
      where: {
        tenantId,
        programId,
        deletedAt: null,
        status: { in: ["active", "completed"] },
        ...(batchIds !== null ? { batchId: { in: batchIds } } : {}),
      },
    });
  }

  // ─── Lookup helpers (names/titles for MV rows, which carry only ids) ────────

  async listProgramTitles(programIds: string[]): Promise<Map<string, string>> {
    if (programIds.length === 0) return new Map();
    const rows = await this.prisma.client.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true, title: true },
    });
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  async listBatchNames(batchIds: string[]): Promise<Map<string, string>> {
    if (batchIds.length === 0) return new Map();
    const rows = await this.prisma.client.batch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** True iff the program exists and belongs to the given tenant (H-1: engagement IDOR guard). */
  async isProgramInTenant(tenantId: string, programId: string): Promise<boolean> {
    const count = await this.prisma.client.program.count({
      where: { id: programId, tenantId, deletedAt: null },
    });
    return count > 0;
  }

  /** Ordered lessons for a program (module.order, then lesson.order) — curriculum order (AC-18). */
  async listLessonsForProgram(
    tenantId: string,
    programId: string,
  ): Promise<Array<{ lessonId: string; moduleId: string; title: string; order: number }>> {
    const modules = await this.prisma.client.module.findMany({
      // H-1: constrain to the caller's tenant via the program relation, so this can never
      // return another tenant's curriculum structure even if called without a prior check.
      where: { programId, deletedAt: null, program: { tenantId, deletedAt: null } },
      orderBy: { order: "asc" },
      select: {
        id: true,
        lessons: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: { id: true, title: true, order: true },
        },
      },
    });
    const rows: Array<{ lessonId: string; moduleId: string; title: string; order: number }> = [];
    for (const mod of modules) {
      for (const lesson of mod.lessons) {
        rows.push({ lessonId: lesson.id, moduleId: mod.id, title: lesson.title, order: lesson.order });
      }
    }
    return rows;
  }

  async listUserContacts(userIds: string[]): Promise<Map<string, { name: string; email: string | null }>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.client.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    return new Map(rows.map((r) => [r.id, { name: r.name, email: r.email }]));
  }

  // ─── MV queries (parameterized raw SQL — no string interpolation) ───────────

  /**
   * mv_revenue_daily rows in [from, to] (inclusive), tenant-scoped, optionally restricted
   * to a set of branch ids. `branchIds === null` means no restriction (all-scope).
   */
  async queryRevenue(
    tenantId: string,
    from: string,
    to: string,
    branchIds: string[] | null,
  ): Promise<RevenueDayRow[]> {
    if (branchIds !== null && branchIds.length === 0) return [];
    const branchFilter =
      branchIds !== null
        ? Prisma.sql`AND branch_id = ANY(ARRAY[${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    return this.prisma.client.$queryRaw<RevenueDayRow[]>`
      SELECT day, currency, program_id AS "programId", SUM(total_paise)::bigint AS "totalPaise"
      FROM mv_revenue_daily
      WHERE tenant_id = ${tenantId}::uuid
        AND day >= ${from}::date
        AND day <= ${to}::date
        ${branchFilter}
      GROUP BY day, currency, program_id
    `;
  }

  /** mv_enrollment_daily rows in [from, to], tenant-scoped, optionally batch- or branch-restricted. */
  async queryEnrollmentDaily(
    tenantId: string,
    from: string,
    to: string,
    batchIds: string[] | null,
    branchIds: string[] | null,
  ): Promise<EnrollmentDayRow[]> {
    if ((batchIds !== null && batchIds.length === 0) || (branchIds !== null && branchIds.length === 0)) return [];
    const batchFilter =
      batchIds !== null
        ? Prisma.sql`AND batch_id = ANY(ARRAY[${Prisma.join(batchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    const branchFilter =
      branchIds !== null
        ? Prisma.sql`AND branch_id = ANY(ARRAY[${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    return this.prisma.client.$queryRaw<EnrollmentDayRow[]>`
      SELECT day, SUM(enrollment_count)::bigint AS count
      FROM mv_enrollment_daily
      WHERE tenant_id = ${tenantId}::uuid
        AND day >= ${from}::date
        AND day <= ${to}::date
        ${batchFilter}
        ${branchFilter}
      GROUP BY day
    `;
  }

  /** mv_lead_funnel_daily rows in [from, to], grouped by stage, tenant-scoped + scope-restricted. */
  async queryFunnel(
    tenantId: string,
    from: string,
    to: string,
    ownerId: string | null,
    branchIds: string[] | null,
  ): Promise<FunnelStageRow[]> {
    if (branchIds !== null && branchIds.length === 0) return [];
    const ownerFilter = ownerId !== null ? Prisma.sql`AND owner_id = ${ownerId}::uuid` : Prisma.empty;
    const branchFilter =
      branchIds !== null
        ? Prisma.sql`AND branch_id = ANY(ARRAY[${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    return this.prisma.client.$queryRaw<FunnelStageRow[]>`
      SELECT stage, SUM(lead_count)::bigint AS count
      FROM mv_lead_funnel_daily
      WHERE tenant_id = ${tenantId}::uuid
        AND day >= ${from}::date
        AND day <= ${to}::date
        ${ownerFilter}
        ${branchFilter}
      GROUP BY stage
    `;
  }


  /**
   * mv_course_engagement_daily rows grouped by lesson, tenant + program scoped, optionally
   * batch-restricted.
   */
  async queryEngagementByLesson(
    tenantId: string,
    programId: string,
    batchIds: string[] | null,
  ): Promise<EngagementLessonRow[]> {
    if (batchIds !== null && batchIds.length === 0) return [];
    const batchFilter =
      batchIds !== null
        ? Prisma.sql`AND batch_id = ANY(ARRAY[${Prisma.join(batchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    return this.prisma.client.$queryRaw<EngagementLessonRow[]>`
      SELECT lesson_id AS "lessonId", SUM(completed_count)::bigint AS "completedCount"
      FROM mv_course_engagement_daily
      WHERE tenant_id = ${tenantId}::uuid
        AND program_id = ${programId}::uuid
        ${batchFilter}
      GROUP BY lesson_id
    `;
  }

  /**
   * mv_gamification_daily rows grouped by user, tenant-scoped, optionally restricted to a
   * set of user ids (assigned/batch-narrowed scope). No date range (all-time aggregate —
   * GamificationParticipationQuerySchema carries no from/to).
   */
  async queryGamificationByUser(tenantId: string, userIds: string[] | null): Promise<GamificationUserRow[]> {
    if (userIds !== null && userIds.length === 0) return [];
    const userFilter =
      userIds !== null
        ? Prisma.sql`AND user_id = ANY(ARRAY[${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    return this.prisma.client.$queryRaw<GamificationUserRow[]>`
      SELECT user_id AS "userId",
             SUM(total_xp)::bigint AS "totalXp",
             SUM(earning_events)::bigint AS "earningEvents",
             SUM(badge_count)::bigint AS "badgeCount"
      FROM mv_gamification_daily
      WHERE tenant_id = ${tenantId}::uuid
        ${userFilter}
      GROUP BY user_id
    `;
  }

  /**
   * mv_forum_health_daily aggregate (single row), tenant-scoped, optionally
   * batch-restricted. No date range (ForumHealthReportQuerySchema carries no from/to).
   */
  async queryForumHealth(tenantId: string, batchIds: string[] | null): Promise<ForumHealthAggRow> {
    const zero: ForumHealthAggRow = { threadCount: 0n, resolvedCount: 0n, postCount: 0n };
    if (batchIds !== null && batchIds.length === 0) return zero;
    const batchFilter =
      batchIds !== null
        ? Prisma.sql`AND batch_id = ANY(ARRAY[${Prisma.join(batchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    const rows = await this.prisma.client.$queryRaw<ForumHealthAggRow[]>`
      SELECT COALESCE(SUM(thread_count), 0)::bigint AS "threadCount",
             COALESCE(SUM(resolved_count), 0)::bigint AS "resolvedCount",
             COALESCE(SUM(post_count), 0)::bigint AS "postCount"
      FROM mv_forum_health_daily
      WHERE tenant_id = ${tenantId}::uuid
        ${batchFilter}
    `;
    return rows[0] ?? zero;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lead performance by rep — the ONE report in this repository that reads LIVE
  // TABLES rather than a materialized view.
  //
  // LOCK-D1 says dashboards read MVs, never the write path. That rule exists so a
  // heavy multi-month aggregate cannot contend with transactional traffic. It is
  // deliberately not applied here, because the question this report answers — "has
  // this rep called anyone today?" — is worthless at MV-refresh latency: a manager
  // acting on a stale answer pulls up a rep for work they have already done.
  //
  // The cost is bounded and known: each query below is a single `groupBy` over an
  // index built for exactly this access path (leads_tenant_id_created_by_id_created_at_idx,
  // leads_tenant_id_owner_id_assigned_at_idx, activities(user_id, due_at)), restricted
  // to a staff-sized id list. This is not a full-table scan wearing a report's clothes.
  //
  // BRANCH SCOPE CAVEAT (documented, not a bug): `leads` carries branch_id, `activities`
  // does not. For a branch-scoped caller the LEAD metrics are branch-filtered, while the
  // ACTIVITY metrics count everything the branch's staff logged — including work on a
  // lead outside their branch. Filtering activities through their parent lead's branch
  // would silently drop every student-attached activity, which understates real work by
  // more than the current over-count. Surfaced in the report's UI copy.
  // ───────────────────────────────────────────────────────────────────────────

  /** Active staff in this tenant holding a lead-owning role, optionally narrowed to branches/one user. */
  async listLeadOwningStaff(
    tenantId: string,
    roleKeys: readonly string[],
    branchIds: string[] | null,
    userId?: string,
  ): Promise<Array<{ id: string; name: string; roleKeys: string[] }>> {
    if (branchIds !== null && branchIds.length === 0) return [];

    const rows = await this.prisma.client.userRole.findMany({
      where: {
        role: { tenantId, key: { in: [...roleKeys] }, deletedAt: null },
        user: { tenantId, deletedAt: null, status: "active", ...(userId ? { id: userId } : {}) },
        // A branch-scoped manager sees the reps posted to their branch(es). A user_role
        // row with a NULL branchId is tenant-wide staff and is excluded from a branch
        // view — they are not that manager's team.
        ...(branchIds !== null ? { branchId: { in: branchIds } } : {}),
      },
      select: { userId: true, user: { select: { name: true } }, role: { select: { key: true } } },
    });

    const byUser = new Map<string, { name: string; roleKeys: Set<string> }>();
    for (const row of rows) {
      const existing = byUser.get(row.userId);
      if (existing) {
        existing.roleKeys.add(row.role.key);
        continue;
      }
      byUser.set(row.userId, { name: row.user.name, roleKeys: new Set([row.role.key]) });
    }
    return [...byUser.entries()]
      .map(([id, u]) => ({ id, name: u.name, roleKeys: [...u.roleKeys].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Leads keyed in by each staff user within [from, to]. */
  async countLeadsCreatedByUser(
    tenantId: string,
    userIds: string[],
    from: Date,
    to: Date,
    branchIds: string[] | null,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.client.lead.groupBy({
      by: ["createdById"],
      where: {
        tenantId,
        deletedAt: null,
        createdById: { in: userIds },
        createdAt: { gte: from, lte: to },
        ...(branchIds !== null ? { branchId: { in: branchIds } } : {}),
      },
      _count: { _all: true },
    });
    return toCountMap(rows.map((r) => ({ key: r.createdById, count: r._count._all })));
  }

  /**
   * Leads that BECAME each user's within [from, to], plus how many of those have ever
   * been contacted and how many converted. One groupBy per fact rather than three passes
   * over a fetched row set — the counts never need the rows themselves.
   */
  async countLeadsAssignedByOwner(
    tenantId: string,
    userIds: string[],
    from: Date,
    to: Date,
    branchIds: string[] | null,
  ): Promise<{ assigned: Map<string, number>; contacted: Map<string, number>; converted: Map<string, number> }> {
    if (userIds.length === 0) return { assigned: new Map(), contacted: new Map(), converted: new Map() };

    const baseWhere = {
      tenantId,
      deletedAt: null,
      ownerId: { in: userIds },
      assignedAt: { gte: from, lte: to },
      ...(branchIds !== null ? { branchId: { in: branchIds } } : {}),
    };

    const [assigned, contacted, converted] = await Promise.all([
      this.prisma.client.lead.groupBy({ by: ["ownerId"], where: baseWhere, _count: { _all: true } }),
      this.prisma.client.lead.groupBy({
        by: ["ownerId"],
        where: { ...baseWhere, firstContactedAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.client.lead.groupBy({
        by: ["ownerId"],
        where: { ...baseWhere, convertedStudentId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      assigned: toCountMap(assigned.map((r) => ({ key: r.ownerId, count: r._count._all }))),
      contacted: toCountMap(contacted.map((r) => ({ key: r.ownerId, count: r._count._all }))),
      converted: toCountMap(converted.map((r) => ({ key: r.ownerId, count: r._count._all }))),
    };
  }

  /**
   * Mean minutes from assignment to first contact, per owner, over leads assigned in the
   * window that HAVE been contacted.
   *
   * Raw SQL because this is an average of a timestamp DIFFERENCE — Prisma's `_avg` only
   * aggregates a stored numeric column, and there is no stored "response minutes" column
   * to average (adding one would mean maintaining a derived value on every write, which
   * is a worse trade than one parameterised query here).
   */
  async avgFirstResponseMinutesByOwner(
    tenantId: string,
    userIds: string[],
    from: Date,
    to: Date,
    branchIds: string[] | null,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    if (branchIds !== null && branchIds.length === 0) return new Map();

    const branchFilter =
      branchIds !== null
        ? Prisma.sql`AND branch_id = ANY(ARRAY[${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;

    const rows = await this.prisma.client.$queryRaw<Array<{ ownerId: string; avgMinutes: number }>>`
      SELECT owner_id AS "ownerId",
             AVG(EXTRACT(EPOCH FROM (first_contacted_at - assigned_at)) / 60.0)::float8 AS "avgMinutes"
      FROM leads
      WHERE tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND owner_id = ANY(ARRAY[${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])
        AND assigned_at BETWEEN ${from} AND ${to}
        AND first_contacted_at IS NOT NULL
        -- Guard against a lead contacted BEFORE it was (re)assigned: reassigning a lead
        -- that someone already called would otherwise contribute a negative response
        -- time and drag the new owner's average below zero.
        AND first_contacted_at >= assigned_at
        ${branchFilter}
      GROUP BY owner_id
    `;

    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.ownerId && row.avgMinutes !== null) map.set(row.ownerId, Math.round(row.avgMinutes));
    }
    return map;
  }

  /** Activity counts per user in [from, to]: total, calls only, and tasks completed. */
  async countActivitiesByUser(
    tenantId: string,
    userIds: string[],
    from: Date,
    to: Date,
  ): Promise<{ total: Map<string, number>; calls: Map<string, number>; tasksCompleted: Map<string, number> }> {
    if (userIds.length === 0) return { total: new Map(), calls: new Map(), tasksCompleted: new Map() };

    const baseWhere = { tenantId, deletedAt: null, userId: { in: userIds } };

    const [total, calls, tasksCompleted] = await Promise.all([
      this.prisma.client.activity.groupBy({
        by: ["userId"],
        where: { ...baseWhere, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.client.activity.groupBy({
        by: ["userId"],
        where: { ...baseWhere, type: "call", createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      // Windowed on doneAt, NOT createdAt: a task raised last month and finished this
      // week is this week's work.
      this.prisma.client.activity.groupBy({
        by: ["userId"],
        where: { ...baseWhere, type: "task", doneAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ]);

    return {
      total: toCountMap(total.map((r) => ({ key: r.userId, count: r._count._all }))),
      calls: toCountMap(calls.map((r) => ({ key: r.userId, count: r._count._all }))),
      tasksCompleted: toCountMap(tasksCompleted.map((r) => ({ key: r.userId, count: r._count._all }))),
    };
  }

  /** As-of-NOW desk snapshot: open owned leads and overdue pending tasks. Ignores [from,to] by design. */
  async countCurrentWorkloadByUser(
    tenantId: string,
    userIds: string[],
    now: Date,
    branchIds: string[] | null,
  ): Promise<{ openLeads: Map<string, number>; overdueFollowUps: Map<string, number> }> {
    if (userIds.length === 0) return { openLeads: new Map(), overdueFollowUps: new Map() };

    const [openLeads, overdue] = await Promise.all([
      this.prisma.client.lead.groupBy({
        by: ["ownerId"],
        where: {
          tenantId,
          deletedAt: null,
          ownerId: { in: userIds },
          stage: { notIn: ["won", "lost"] },
          ...(branchIds !== null ? { branchId: { in: branchIds } } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.client.activity.groupBy({
        by: ["userId"],
        where: {
          tenantId,
          deletedAt: null,
          userId: { in: userIds },
          type: "task",
          doneAt: null,
          dueAt: { lt: now },
        },
        _count: { _all: true },
      }),
    ]);

    return {
      openLeads: toCountMap(openLeads.map((r) => ({ key: r.ownerId, count: r._count._all }))),
      overdueFollowUps: toCountMap(overdue.map((r) => ({ key: r.userId, count: r._count._all }))),
    };
  }

  /**
   * The two totals that belong to nobody: leads with no owner at all (as of now) and
   * leads created in the window that no one has ever contacted. Counted tenant-wide
   * (scope-restricted) rather than per-rep precisely because no rep's row would carry
   * them, which is how they stay invisible today.
   */
  async countUnownedLeads(
    tenantId: string,
    from: Date,
    to: Date,
    branchIds: string[] | null,
  ): Promise<{ unassigned: number; uncontacted: number }> {
    if (branchIds !== null && branchIds.length === 0) return { unassigned: 0, uncontacted: 0 };
    const branchWhere = branchIds !== null ? { branchId: { in: branchIds } } : {};

    const [unassigned, uncontacted] = await Promise.all([
      this.prisma.client.lead.count({
        where: { tenantId, deletedAt: null, ownerId: null, stage: { notIn: ["won", "lost"] }, ...branchWhere },
      }),
      this.prisma.client.lead.count({
        where: {
          tenantId,
          deletedAt: null,
          firstContactedAt: null,
          stage: { notIn: ["won", "lost"] },
          createdAt: { gte: from, lte: to },
          ...branchWhere,
        },
      }),
    ]);

    return { unassigned, uncontacted };
  }
}

/** Collapses a groupBy result into a lookup, dropping the null-key bucket Prisma includes for nullable group columns. */
function toCountMap(rows: Array<{ key: string | null; count: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.key) map.set(row.key, row.count);
  }
  return map;
}
