// apps/api/src/modules/analytics/analytics.service.ts
//
// Business logic for the Phase-7 KPI dashboards (docs/plans/phase-7.md task #7,
// docs/specs/phase-7-analytics-hardening.md WS-A). Owns:
//   - Server-side scope resolution (all|branch|assigned|own -> concrete id-set filters),
//     via `requireScopeContext()` (FAIL-CLOSED — never falls back to "all" on a missing
//     scope context, same posture as leads.service.ts/assessments.service.ts).
//   - The 422 INVALID_DATE_RANGE guard (from<=to) — deliberately done HERE, not in the
//     zod pipe, per the api-designer's note in @repo/types
//     `ReportDateRangeQuerySchema` doc comment (a zod shape failure maps to 400 via the
//     global pipe; AC-4 requires 422 specifically for a business-rule violation).
//   - Freshness (asOf/stale) assembly from `AnalyticsRepository.getFreshness()`.
//   - Redis cache-aside on every dashboard read (short TTL; key = endpoint + tenant +
//     scope + actor + query params) — never caches across tenants/scopes/actors.
//   - IDOR->404 (never 403) for an out-of-scope branchId/batchId/campaignId, matching the
//     platform-wide convention (leads/assessments/forum modules).
//
// No Prisma access here — delegates all data reads to AnalyticsRepository (MVs) and
// CampaignsService (the one deliberate LOCK-D1 exception — see repository file header).

import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  RevenueReportQuery,
  RevenueReportDto,
  EnrollmentTrendQuery,
  EnrollmentTrendDto,
  FunnelReportQuery,
  FunnelReportDto,
  EngagementReportQuery,
  EngagementReportDto,
  CampaignPerformanceQuery,
  CampaignPerformanceDto,
  GamificationParticipationQuery,
  GamificationParticipationDto,
  ForumHealthReportQuery,
  ForumHealthReportDto,
  ReportGranularity,
  LeadStage,
  LeadPerformanceReportQuery,
  LeadPerformanceReportDto,
} from "@repo/types";
import { teamRevenueReconciles } from "@repo/types";
import type { TeamRevenueReportDto, TeamRevenueReportQuery } from "@repo/types";
import { OrgService } from "../org/org.service";
import { AnalyticsRepository } from "./analytics.repository";
// A VALUE import, unlike everything above — safe here because it comes from a sibling
// API module compiled by the same tsconfig, not from the pure-ESM @repo/types package
// (see the LeadStage note below for why that distinction matters to the unit suite).
import { LEAD_OWNER_ROLE_KEYS } from "../leads/leads.repository";
import { CampaignsService } from "../campaigns/campaigns.service";
import { RedisService } from "../../redis/redis.service";
import { requireScopeContext, type ScopeContext } from "../auth/lib/scope-context";

const CACHE_TTL_SECONDS = 60; // short TTL cache-aside on hot dashboard reads.
const CACHE_PREFIX = "analytics:v1";

/**
 * Every `LeadStage` value, in the same order as `LeadStageSchema.options`
 * (@repo/types crm/leads.schemas.ts) / the Prisma `LeadStage` enum (prisma/schema.prisma).
 * Hardcoded here (rather than importing `LeadStageSchema` as a runtime value) because
 * `@repo/types` builds as pure ESM, which this project's FAST unit jest.config.js does
 * not map back to source (unlike jest.integration.config.js) — a real (non-type) value
 * import from `@repo/types` inside a SERVICE would break the whole fast unit suite's
 * module resolution for every spec that imports this file. `LeadStage` itself is still
 * imported as a `type` above (erased at compile time, so it never hits this constraint).
 * AC-10 requires every stage present (even with count=0), so this list must stay in sync
 * with `LeadStageSchema` — a drift here would silently drop a stage from the funnel
 * dashboard, not fail loudly, so keep it aligned whenever a stage is added/removed.
 */
const ALL_LEAD_STAGES: readonly LeadStage[] = ["new", "follow_up", "won", "lost"] as const;

/** Per-lesson drop-off threshold (AC-18): a lesson crossing this ratio vs. its immediate
 * predecessor's completed count is flagged as the drop-off point. Configurable constant,
 * not a magic number scattered through the drop-off loop below. */
const DROP_OFF_RATIO = 0.7;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly campaignsService: CampaignsService,
    private readonly redis: RedisService,
    // The org chart narrows the lead-performance report to a manager's own people (P17-4).
    // Analytics depends on Org, never the reverse.
    private readonly org: OrgService,
  ) {}

  /**
   * Single currency per tenant (CLAUDE.md §1, India-first). The revenue dashboard documents
   * the same assumption where it sums paise across rows regardless of label; a future
   * multi-currency tenant needs a per-currency breakdown rather than a silent mis-sum.
   */
  private static readonly TENANT_REPORT_CURRENCY = "INR";

  private readonly reportLogger = new Logger(AnalyticsService.name);

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  /** AC-4: `from > to` -> 422 INVALID_DATE_RANGE, before any query runs. */
  private assertValidDateRange(from: string, to: string): void {
    if (from > to) {
      throw new UnprocessableEntityException({
        code: "INVALID_DATE_RANGE",
        title: "Invalid date range",
        detail: "`from` must be less than or equal to `to`.",
      });
    }
  }

  /**
   * Resolves an id-set filter for a scope + an optional caller-supplied narrowing id
   * (branchId/batchId). `scopeIds === null` means no restriction (all-scope). When the
   * caller supplies an explicit id outside the resolved scope set, this throws 404
   * (IDOR-safe — never 403, never leaks existence, matching leads/assessments/forum).
   */
  private resolveIdFilter(scopeIds: string[] | null, requestedId?: string): string[] | null {
    if (requestedId) {
      if (scopeIds !== null && !scopeIds.includes(requestedId)) {
        throw new NotFoundException({ code: "reports.not_found", title: "Not found" });
      }
      return [requestedId];
    }
    return scopeIds;
  }

  /** Branch-id set for a "branch" scope, or an assigned-batch set for "assigned" — the
   * two id-set-based scopes shared by most WS-A dashboards. `all` -> null (no filter). */
  private async resolveBranchIds(scope: ScopeContext): Promise<string[] | null> {
    if (scope.scope === "all") return null;
    if (scope.scope === "branch") return this.repo.listCallerBranchIds(scope.actorId);
    throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
  }

  private async resolveAssignedBatchIds(tenantId: string, scope: ScopeContext): Promise<string[] | null> {
    if (scope.scope === "all") return null;
    if (scope.scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, scope.actorId);
      if (!facultyProfileId) return [];
      return this.repo.findAssignedBatchIds(tenantId, facultyProfileId);
    }
    if (scope.scope === "branch") {
      // Attendance/engagement grant branch scope too (docs/specs Part 8) — branch-scoped
      // callers see every batch in their branch(es), not just a single faculty roster.
      const branchIds = await this.repo.listCallerBranchIds(scope.actorId);
      if (branchIds.length === 0) return [];
      return this.repo.listBatchIdsForBranches(tenantId, branchIds);
    }
    throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
  }

  private cacheKey(endpoint: string, scope: ScopeContext, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}=${JSON.stringify(params[k])}`)
      .join("&");
    return `${CACHE_PREFIX}:${endpoint}:${scope.tenantId}:${scope.scope}:${scope.actorId}:${sortedParams}`;
  }

  private async withCache<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = await this.redis.client.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    const result = await compute();
    // Fire-and-forget-safe: cache-aside write failures must never fail the read.
    await this.redis.client.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
    return result;
  }

  /** Enumerates every ISO date (YYYY-MM-DD) in [from, to] inclusive. */
  private enumerateDays(from: string, to: string): string[] {
    const days: string[] = [];
    const cursor = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  // ─── WS-A1: Revenue ─────────────────────────────────────────────────────────

  async getRevenue(tenantId: string, query: RevenueReportQuery): Promise<RevenueReportDto> {
    this.assertValidDateRange(query.from, query.to);
    const scope = requireScopeContext();
    const branchScopeIds = await this.resolveBranchIds(scope);
    const branchIds = this.resolveIdFilter(branchScopeIds, query.branchId);

    const key = this.cacheKey("revenue", scope, { from: query.from, to: query.to, branchId: query.branchId ?? null });
    return this.withCache(key, async () => {
      const rows = await this.repo.queryRevenue(tenantId, query.from, query.to, branchIds);
      const freshness = await this.repo.getFreshness("mv_revenue_daily");

      // Single-currency-per-tenant assumption (India-first primary market, CLAUDE.md §1):
      // sum every row's paise regardless of currency label into one total, defaulting the
      // reported currency to INR when no rows exist. A future multi-currency tenant would
      // need a per-currency breakdown; documented here, not silently mis-summed.
      let totalPaise = 0;
      let currency = "INR";
      const byDay = new Map<string, number>();
      const byProgram = new Map<string, number>();
      for (const row of rows) {
        const paise = Number(row.totalPaise);
        totalPaise += paise;
        currency = row.currency;
        const dayKey = row.day.toISOString().slice(0, 10);
        byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + paise);
        if (row.programId) {
          byProgram.set(row.programId, (byProgram.get(row.programId) ?? 0) + paise);
        }
      }

      const series = this.enumerateDays(query.from, query.to).map((day) => ({
        periodStart: day,
        amountPaise: byDay.get(day) ?? 0,
      }));

      const programTitles = await this.repo.listProgramTitles([...byProgram.keys()]);
      const byProgramRows = [...byProgram.entries()].map(([programId, amountPaise]) => ({
        programId,
        programTitle: programTitles.get(programId) ?? "Unknown Program",
        amountPaise,
      }));

      return {
        asOf: freshness.asOf.toISOString(),
        stale: freshness.stale,
        from: query.from,
        to: query.to,
        currency,
        totalPaise,
        series,
        byProgram: byProgramRows,
      };
    });
  }

  // ─── WS-A2: Enrollment trend ────────────────────────────────────────────────

  async getEnrollmentTrend(tenantId: string, query: EnrollmentTrendQuery): Promise<EnrollmentTrendDto> {
    this.assertValidDateRange(query.from, query.to);
    const scope = requireScopeContext();
    // "assigned" (Faculty) resolves to a batch-id restriction instead of a branch one;
    // "all"/"branch" resolve to a branch-id restriction (or no restriction for "all").
    let batchIds: string[] | null = null;
    let branchIds: string[] | null = null;
    if (scope.scope === "assigned") {
      const facultyProfileId = await this.repo.findFacultyProfileId(tenantId, scope.actorId);
      batchIds = facultyProfileId ? await this.repo.findAssignedBatchIds(tenantId, facultyProfileId) : [];
    } else if (scope.scope === "branch") {
      const callerBranchIds = await this.repo.listCallerBranchIds(scope.actorId);
      branchIds = this.resolveIdFilter(callerBranchIds, query.branchId);
    } else if (scope.scope === "all") {
      branchIds = this.resolveIdFilter(null, query.branchId);
    } else {
      throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
    }

    const key = this.cacheKey("enrollments", scope, {
      from: query.from,
      to: query.to,
      granularity: query.granularity ?? null,
      branchId: query.branchId ?? null,
    });
    return this.withCache(key, async () => {
      const rows = await this.repo.queryEnrollmentDaily(tenantId, query.from, query.to, batchIds, branchIds);
      const freshness = await this.repo.getFreshness("mv_enrollment_daily");

      const byDay = new Map<string, number>();
      for (const row of rows) {
        byDay.set(row.day.toISOString().slice(0, 10), Number(row.count));
      }

      const days = this.enumerateDays(query.from, query.to);
      const granularity = this.pickGranularity(query.granularity, days.length);
      const series = this.bucketSeries(days, byDay, granularity);
      const total = series.reduce((sum, point) => sum + point.value, 0);

      return {
        asOf: freshness.asOf.toISOString(),
        stale: freshness.stale,
        from: query.from,
        to: query.to,
        granularity,
        series,
        total,
      };
    });
  }

  /** Auto-coarsens granularity for very large ranges (Part 4 edge case) — the response
   * always echoes back the granularity ACTUALLY used, which may differ from requested. */
  private pickGranularity(requested: ReportGranularity | undefined, dayCount: number): ReportGranularity {
    if (dayCount > 366) return "monthly";
    if (dayCount > 62) return requested === "monthly" ? "monthly" : "weekly";
    return requested ?? "daily";
  }

  private bucketSeries(
    days: string[],
    byDay: Map<string, number>,
    granularity: ReportGranularity,
  ): Array<{ periodStart: string; value: number }> {
    const buckets = new Map<string, number>();
    for (const day of days) {
      const bucketStart = this.bucketStart(day, granularity);
      buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + (byDay.get(day) ?? 0));
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([periodStart, value]) => ({ periodStart, value }));
  }

  private bucketStart(day: string, granularity: ReportGranularity): string {
    if (granularity === "daily") return day;
    const d = new Date(`${day}T00:00:00.000Z`);
    if (granularity === "monthly") {
      return `${day.slice(0, 7)}-01`;
    }
    // weekly: Monday-start ISO week.
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    d.setUTCDate(d.getUTCDate() - diffToMonday);
    return d.toISOString().slice(0, 10);
  }

  // ─── WS-A3: Lead funnel / conversion ────────────────────────────────────────

  async getFunnel(tenantId: string, query: FunnelReportQuery): Promise<FunnelReportDto> {
    this.assertValidDateRange(query.from, query.to);
    const scope = requireScopeContext();

    let branchIds: string[] | null = null;
    let ownerId: string | null = null;
    switch (scope.scope) {
      case "all":
        branchIds = this.resolveIdFilter(null, query.branchId);
        break;
      case "branch": {
        const callerBranchIds = await this.repo.listCallerBranchIds(scope.actorId);
        branchIds = this.resolveIdFilter(callerBranchIds, query.branchId);
        break;
      }
      case "own":
        ownerId = scope.actorId; // Counsellor's own-scope is resolved server-side, never client-selectable.
        break;
      default:
        throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
    }

    const key = this.cacheKey("funnel", scope, { from: query.from, to: query.to, branchId: query.branchId ?? null });
    return this.withCache(key, async () => {
      const rows = await this.repo.queryFunnel(tenantId, query.from, query.to, ownerId, branchIds);
      const freshness = await this.repo.getFreshness("mv_lead_funnel_daily");

      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.stage, (counts.get(row.stage) ?? 0) + Number(row.count));
      }

      const stages = ALL_LEAD_STAGES.map((stage) => ({
        stage,
        count: counts.get(stage) ?? 0,
      }));
      const totalLeads = stages.reduce((sum, s) => sum + s.count, 0);
      const wonCount = counts.get("won") ?? 0;

      return {
        asOf: freshness.asOf.toISOString(),
        stale: freshness.stale,
        from: query.from,
        to: query.to,
        stages,
        totalLeads,
        wonCount,
        conversionRate: totalLeads > 0 ? wonCount / totalLeads : 0,
      };
    });
  }

  // ─── WS-A5: Course / video engagement ───────────────────────────────────────

  async getEngagement(tenantId: string, query: EngagementReportQuery): Promise<EngagementReportDto> {
    const scope = requireScopeContext();
    const scopeBatchIds = await this.resolveAssignedBatchIds(tenantId, scope);
    const batchIds = this.resolveIdFilter(scopeBatchIds, query.batchId);

    // H-1: the caller-supplied programId must belong to the caller's tenant. Validate BEFORE
    // any read (and before the cache) so a cross-tenant programId → 404 (IDOR convention),
    // never a curriculum-structure disclosure or a cached miss for another tenant.
    if (!(await this.repo.isProgramInTenant(tenantId, query.programId))) {
      throw new NotFoundException({ code: "reports.not_found", title: "Not found" });
    }

    const key = this.cacheKey("engagement", scope, { programId: query.programId, batchId: query.batchId ?? null });
    return this.withCache(key, async () => {
      const [lessons, rows, enrolledCount, freshness] = await Promise.all([
        this.repo.listLessonsForProgram(tenantId, query.programId),
        this.repo.queryEngagementByLesson(tenantId, query.programId, batchIds),
        this.repo.countEnrollments(tenantId, query.programId, batchIds),
        this.repo.getFreshness("mv_course_engagement_daily"),
      ]);

      const completedByLesson = new Map<string, number>();
      for (const row of rows) {
        completedByLesson.set(row.lessonId, Number(row.completedCount));
      }

      let dropOffLessonId: string | null = null;
      let previousCompleted: number | null = null;
      const lessonRows = lessons.map((lesson) => {
        const completedCount = completedByLesson.get(lesson.lessonId) ?? 0;
        const completionPercent = enrolledCount > 0 ? (completedCount / enrolledCount) * 100 : 0;

        let isDropOff = false;
        if (previousCompleted !== null && previousCompleted > 0 && completedCount < previousCompleted * DROP_OFF_RATIO) {
          isDropOff = true;
          if (dropOffLessonId === null) dropOffLessonId = lesson.lessonId;
        }
        previousCompleted = completedCount;

        return {
          lessonId: lesson.lessonId,
          moduleId: lesson.moduleId,
          title: lesson.title,
          order: lesson.order,
          completedCount,
          enrolledCount,
          completionPercent,
          isDropOff,
        };
      });

      return {
        asOf: freshness.asOf.toISOString(),
        stale: freshness.stale,
        programId: query.programId,
        batchId: query.batchId ?? null,
        lessons: lessonRows,
        dropOffLessonId,
      };
    });
  }

  // ─── WS-A6: Campaign performance ────────────────────────────────────────────

  /**
   * Deliberate LOCK-D1 exception (see analytics.repository.ts file header): reads the
   * already-tenant-scoped, always-live `campaigns.metrics` field via the existing
   * `CampaignsService.getCampaignMetrics()` instead of `mv_campaign_performance_daily`, so
   * this dashboard can NEVER drift from that cached field (AC-20's explicit "no drift"
   * requirement) — a single-campaign lookup is cheap/indexed, unlike the broad
   * tenant-wide aggregates the other seven dashboards compute. `getCampaign`/
   * `getCampaignMetrics` both throw NotFoundException for a cross-tenant/unknown id
   * (AC-22 — 404, not a cross-tenant 403).
   */
  async getCampaignPerformance(tenantId: string, query: CampaignPerformanceQuery): Promise<CampaignPerformanceDto> {
    const scope = requireScopeContext();
    // reports.campaigns.view is all-scope only (Part 8 — only marketing/admin/super_admin
    // are ever granted it, always at scope=all) — defense-in-depth in case a future grant
    // mistakenly issues a narrower scope for this permission.
    if (scope.scope !== "all") {
      throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
    }
    const campaign = await this.campaignsService.getCampaign(tenantId, query.campaignId);
    const metrics = await this.campaignsService.getCampaignMetrics(tenantId, query.campaignId);

    return {
      asOf: new Date().toISOString(), // live read, always current — never MV-backed (see above).
      stale: false,
      campaignId: campaign.id,
      campaignName: campaign.name,
      metrics,
    };
  }

  // ─── WS-A7: Gamification participation (staff-facing — MAY carry name/email, AC-24) ──

  async getGamificationParticipation(
    tenantId: string,
    query: GamificationParticipationQuery,
  ): Promise<GamificationParticipationDto> {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "assigned") {
      throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
    }
    const scopeBatchIds = await this.resolveAssignedBatchIds(tenantId, scope);
    const batchIds = this.resolveIdFilter(scopeBatchIds, query.batchId);

    const key = this.cacheKey("gamification", scope, { batchId: query.batchId ?? null });
    return this.withCache(key, async () => {
      // No batch dimension in mv_gamification_daily (schema.prisma caveat) — resolve the
      // batch(es)' enrolled student user ids first, then filter the MV by user_id.
      const userIds = batchIds !== null ? await this.repo.resolveUserIdsForBatches(tenantId, batchIds) : null;
      const rows = await this.repo.queryGamificationByUser(tenantId, userIds);
      const freshness = await this.repo.getFreshness("mv_gamification_daily");

      const contactUserIds = rows.map((r) => r.userId);
      const contacts = await this.repo.listUserContacts(contactUserIds);

      let activeEarnersCount = 0;
      let totalXpDistributed = 0;
      let badgeAwardCount = 0;
      const perStudent = rows.map((row) => {
        const totalXp = Number(row.totalXp);
        const earningEvents = Number(row.earningEvents);
        const badgeCount = Number(row.badgeCount);
        totalXpDistributed += totalXp;
        badgeAwardCount += badgeCount;
        if (earningEvents > 0) activeEarnersCount += 1;

        const contact = contacts.get(row.userId);
        return {
          studentId: row.userId,
          studentName: contact?.name ?? "Unknown Student",
          studentEmail: contact?.email ?? null,
          totalXp,
          badgeCount,
        };
      });

      return {
        asOf: freshness.asOf.toISOString(),
        stale: freshness.stale,
        batchId: query.batchId ?? null,
        activeEarnersCount,
        totalXpDistributed,
        badgeAwardCount,
        perStudent,
      };
    });
  }

  // ─── WS-A8: Forum health ────────────────────────────────────────────────────

  async getForumHealth(tenantId: string, query: ForumHealthReportQuery): Promise<ForumHealthReportDto> {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "assigned") {
      throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
    }
    const scopeBatchIds = await this.resolveAssignedBatchIds(tenantId, scope);
    const batchIds = this.resolveIdFilter(scopeBatchIds, query.batchId);

    const key = this.cacheKey("forum-health", scope, { batchId: query.batchId ?? null });
    return this.withCache(key, async () => {
      const agg = await this.repo.queryForumHealth(tenantId, batchIds);
      const freshness = await this.repo.getFreshness("mv_forum_health_daily");

      const threadCount = Number(agg.threadCount);
      const postCount = Number(agg.postCount);
      const resolvedCount = Number(agg.resolvedCount);

      return {
        asOf: freshness.asOf.toISOString(),
        stale: freshness.stale,
        batchId: query.batchId ?? null,
        threadCount,
        postCount,
        replyRate: threadCount > 0 ? postCount / threadCount : 0,
        resolutionRate: threadCount > 0 ? resolvedCount / threadCount : 0,
      };
    });
  }

  // ─── Lead performance by rep ────────────────────────────────────────────────

  /**
   * GET /crm/reports/lead-performance — the per-person scoreboard.
   *
   * Two things make this method different from every other report here:
   *
   * 1. NOT CACHED, and not read from a materialized view. `withCache` would hold a
   *    5-minute-old scoreboard, and an MV would hold an even older one; both are the
   *    wrong answer to "has this rep called anyone today". See the block comment above
   *    the live-table queries in analytics.repository.ts.
   *
   * 2. Every rep in the pool gets a row, INCLUDING one with nothing but zeros. Omitting
   *    inactive reps would make the report quietly flattering: the person who did no work
   *    would vanish rather than appear with a zero, and a manager scanning the table would
   *    never notice they were missing.
   *
   * Scope: `all` sees the whole tenant; `branch` sees the reps posted to their branches
   * and those branches' leads; anything else is a 404 (never 403 — no existence
   * disclosure, matching the other dashboards).
   */
  async getLeadPerformance(
    tenantId: string,
    query: LeadPerformanceReportQuery,
  ): Promise<LeadPerformanceReportDto> {
    this.assertValidDateRange(query.from, query.to);
    const scope = requireScopeContext();

    let branchIds: string[] | null;
    // Team narrowing (P17-4). `null` = no team filter, which is every path that existed
    // before the org chart did.
    let teamUserIds: string[] | null = null;
    switch (scope.scope) {
      case "all":
        branchIds = this.resolveIdFilter(null, query.branchId);
        break;
      case "branch": {
        const callerBranchIds = await this.repo.listCallerBranchIds(scope.actorId);
        branchIds = this.resolveIdFilter(callerBranchIds, query.branchId);
        break;
      }
      case "own": {
        // A TEAM LEAD OR MANAGER reading their own people (ADR-0069). Granted at scope=own
        // rather than a new scope value — see ADR-0069 (c) for why the enum was left alone.
        //
        // The actor is included alongside the people they lead: a lead who owns leads of
        // their own is measured on the same report, and omitting them would make the team
        // total disagree with the sum of the company one.
        const subordinates = await this.org.listSubordinateUserIds(tenantId, scope.actorId);
        teamUserIds = [scope.actorId, ...subordinates];
        branchIds = this.resolveIdFilter(null, query.branchId);
        break;
      }
      default:
        throw new NotFoundException({ code: "reports.scope_unresolvable", title: "Not found" });
    }

    // Inclusive of the full day at BOTH ends (AC-4 convention shared with the other
    // dashboards): `to` is a date, so it must be widened to that date's last instant or
    // every lead created after midnight on the final day would be silently excluded.
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T23:59:59.999Z`);
    const now = new Date();

    const staff = await this.repo.listLeadOwningStaff(
      tenantId,
      LEAD_OWNER_ROLE_KEYS,
      branchIds,
      query.userId,
      teamUserIds,
    );

    // A requested userId that resolved to nobody is an out-of-scope or non-existent user:
    // 404, consistent with resolveIdFilter's posture for branch/batch ids.
    if (query.userId && staff.length === 0) {
      throw new NotFoundException({ code: "reports.not_found", title: "Not found" });
    }

    const userIds = staff.map((s) => s.id);

    const [created, assignedStats, avgResponse, activityCounts, workload, unowned] = await Promise.all([
      this.repo.countLeadsCreatedByUser(tenantId, userIds, from, to, branchIds),
      this.repo.countLeadsAssignedByOwner(tenantId, userIds, from, to, branchIds),
      this.repo.avgFirstResponseMinutesByOwner(tenantId, userIds, from, to, branchIds),
      this.repo.countActivitiesByUser(tenantId, userIds, from, to),
      this.repo.countCurrentWorkloadByUser(tenantId, userIds, now, branchIds),
      this.repo.countUnownedLeads(tenantId, from, to, branchIds),
    ]);

    const rows = staff.map((member) => {
      const leadsAssigned = assignedStats.assigned.get(member.id) ?? 0;
      const converted = assignedStats.converted.get(member.id) ?? 0;
      const contacted = assignedStats.contacted.get(member.id) ?? 0;

      return {
        userId: member.id,
        userName: member.name,
        roleKeys: member.roleKeys,
        leadsCreated: created.get(member.id) ?? 0,
        leadsAssigned,
        callsLogged: activityCounts.calls.get(member.id) ?? 0,
        activitiesLogged: activityCounts.total.get(member.id) ?? 0,
        followUpsCompleted: activityCounts.tasksCompleted.get(member.id) ?? 0,
        converted,
        // Guarded division — a rep with no leads has a 0 rate, never NaN (which would
        // serialise as null and render as a blank cell that reads like "no data").
        conversionRate: leadsAssigned > 0 ? converted / leadsAssigned : 0,
        contactRate: leadsAssigned > 0 ? contacted / leadsAssigned : 0,
        // null, not 0: "nobody has been contacted yet" must not render as an instant
        // response time. The DTO documents this distinction.
        avgFirstResponseMinutes: avgResponse.get(member.id) ?? null,
        openLeads: workload.openLeads.get(member.id) ?? 0,
        overdueFollowUps: workload.overdueFollowUps.get(member.id) ?? 0,
      };
    });

    return {
      from: query.from,
      to: query.to,
      rows,
      totalLeadsCreated: rows.reduce((sum, r) => sum + r.leadsCreated, 0),
      totalConverted: rows.reduce((sum, r) => sum + r.converted, 0),
      unassignedLeads: unowned.unassigned,
      uncontactedLeads: unowned.uncontacted,
    };
  }
  // ── Team revenue ────────────────────────────────────────────────────────

  /**
   * `GET /crm/reports/team-revenue` — what each team brought in.
   *
   * Revenue was per-person only, and reachable only through `leads.owner_id`, so a member
   * enrolled through the onboarding form counted for nobody. Ownership now lives on the
   * member (`student_profiles.owner_id`) and this rolls it up the org chart: a member belongs
   * to a person, that person belongs to a team, the team's revenue is the sum.
   *
   * THE TWO UNATTRIBUTED BUCKETS ARE THE POINT, not an afterthought. Money from members
   * nobody owns, and money from members whose owner is on no team, are reported explicitly so
   * the arithmetic closes:
   *
   *     sum(rows) + unowned + unteamed === total
   *
   * Without them this would under-report the company and the only symptom would be a total
   * nobody cross-checks. The invariant is ASSERTED below rather than trusted, because the
   * failure is silent by construction: a join that quietly drops rows still produces a report
   * that adds up internally and simply reports less money than came in.
   */
  async getTeamRevenue(tenantId: string, query: TeamRevenueReportQuery): Promise<TeamRevenueReportDto> {
    const scope = requireScopeContext();

    // Who this caller may see teams for. Null = scope=all, every team. A manager or lead at
    // scope=own sees the teams they run, resolved from the org chart exactly as the
    // lead-performance report does (ADR-0069).
    let visibleUserIds: string[] | null = null;
    if (scope.scope !== "all") {
      const subordinates = await this.org.listSubordinateUserIds(tenantId, scope.actorId);
      visibleUserIds = [scope.actorId, ...subordinates];
    }

    // Inclusive of the full final day, the convention every other dashboard here uses: `to`
    // is a date, so without widening it every payment after midnight on the last day would be
    // silently excluded.
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(`${query.to}T23:59:59.999Z`);

    const teams = await this.repo.listTeamsForRevenue(tenantId, query.teamId, visibleUserIds);
    const staffByTeam = await this.repo.listTeamStaffIds(
      tenantId,
      teams.map((team) => team.id),
    );

    const allTeamStaff = [...new Set([...staffByTeam.values()].flat())];
    const [ownedCounts, revenue] = await Promise.all([
      this.repo.countMembersOwnedBy(tenantId, allTeamStaff),
      this.repo.sumRevenueByMemberOwner(tenantId, from, to),
    ]);

    const rows = teams.map((team) => {
      const staffIds = staffByTeam.get(team.id) ?? [];
      let revenuePaise = 0;
      let payingMembers = 0;
      let membersOwned = 0;
      for (const staffId of staffIds) {
        const own = revenue.byOwner.get(staffId);
        if (own) {
          revenuePaise += own.revenuePaise;
          payingMembers += own.payingMembers;
        }
        membersOwned += ownedCounts.get(staffId) ?? 0;
      }
      return {
        teamId: team.id,
        teamName: team.name,
        managerName: team.managerName,
        leadName: team.leadName,
        staffCount: team.staffCount,
        membersOwned,
        payingMembers,
        revenuePaise,
      };
    });

    // Everything attributed to a person who is on one of the teams we just built.
    const attributed = rows.reduce((sum, row) => sum + row.revenuePaise, 0);

    // The remainder splits in two, and the split is what makes the report actionable rather
    // than merely balanced: "tag the member" and "put that person on a team" are different
    // chores for different people.
    const unteamedPaise = Math.max(0, revenue.totalPaise - revenue.unownedPaise - attributed);

    const report: TeamRevenueReportDto = {
      from: query.from,
      to: query.to,
      currency: AnalyticsService.TENANT_REPORT_CURRENCY,
      rows,
      totalRevenuePaise: revenue.totalPaise,
      unownedRevenuePaise: revenue.unownedPaise,
      unteamedRevenuePaise: unteamedPaise,
    };

    // A caller at scope=own sees only their own teams, so the company total legitimately
    // exceeds what their rows account for and the invariant does not apply — the difference
    // is other people's teams, not lost money. It is checked only for the full-company view,
    // which is the one that claims to be complete.
    if (visibleUserIds === null && !teamRevenueReconciles(report)) {
      this.reportLogger.error(
        `[TeamRevenue] attribution does not reconcile for tenant ${tenantId} ` +
          `(${query.from}..${query.to}): rows=${attributed} unowned=${revenue.unownedPaise} ` +
          `unteamed=${unteamedPaise} total=${revenue.totalPaise}. Reporting the total as authoritative.`,
      );
    }

    return report;
  }
}
