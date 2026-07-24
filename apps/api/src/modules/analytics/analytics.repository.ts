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

export interface AttendanceBatchRow {
  batchId: string;
  presentCount: bigint;
  totalCount: bigint;
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

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── MV refresh (Wave 2 task #11 — AnalyticsMvRefreshScheduler) ─────────────

  /**
   * Invokes the `refresh_analytics_views()` Postgres procedure (migration
   * `20260704060200_analytics_read_model` / `20260704060400_analytics_refresh_log`),
   * which `REFRESH MATERIALIZED VIEW CONCURRENTLY`s each of the 8 Phase-7 MVs and updates
   * `analytics_mv_refresh_log` per-MV (see that migration's header — each MV's refresh is
   * isolated in its own exception block, so one MV failing never blocks the others). No
   * parameters — a fixed tagged-template call, never string-built (no injection surface).
   * Callers (the scheduler) are responsible for catching/logging any error this throws —
   * this method itself does not swallow failures, since `getFreshness()` is what actually
   * exposes staleness to dashboard responses regardless of whether this call succeeds.
   */
  async refreshMaterializedViews(): Promise<void> {
    await this.prisma.client.$executeRaw`CALL refresh_analytics_views()`;
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
   * mv_attendance_daily rows grouped by batch, tenant-scoped, optionally batch-restricted
   * and date-restricted. `from`/`to` are optional (AttendanceReportQuerySchema — all-time
   * aggregate when omitted).
   */
  async queryAttendanceByBatch(
    tenantId: string,
    batchIds: string[] | null,
    from: string | null,
    to: string | null,
  ): Promise<AttendanceBatchRow[]> {
    if (batchIds !== null && batchIds.length === 0) return [];
    const batchFilter =
      batchIds !== null
        ? Prisma.sql`AND batch_id = ANY(ARRAY[${Prisma.join(batchIds.map((id) => Prisma.sql`${id}::uuid`))}]::uuid[])`
        : Prisma.empty;
    const fromFilter = from !== null ? Prisma.sql`AND day >= ${from}::date` : Prisma.empty;
    const toFilter = to !== null ? Prisma.sql`AND day <= ${to}::date` : Prisma.empty;
    return this.prisma.client.$queryRaw<AttendanceBatchRow[]>`
      SELECT batch_id AS "batchId",
             SUM(present_count)::bigint AS "presentCount",
             SUM(total_count)::bigint AS "totalCount"
      FROM mv_attendance_daily
      WHERE tenant_id = ${tenantId}::uuid
        ${batchFilter}
        ${fromFilter}
        ${toFilter}
      GROUP BY batch_id
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
}
