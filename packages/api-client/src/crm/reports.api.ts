// Typed KPI dashboard SDK — Phase 7, Wave 1 (docs/plans/phase-7.md task #4).
//
// Namespace: client.crm.reports.*
//
// Read-only over GET /api/v1/crm/reports/* — the 8 WS-A dashboards
// (docs/specs/phase-7-analytics-hardening.md). Every response is
// materialized-view-backed (LOCK-D1) and carries `asOf`/`stale` freshness
// (@repo/types ReportFreshnessSchema) — render a "data as of HH:MM" /
// staleness indicator, never present a response as if it were live.
//
// ONE EXCEPTION: getLeadPerformance() is computed live off the write-path tables and
// therefore returns NO asOf/stale pair. Do not render a freshness indicator for it —
// there is no snapshot behind it to be stale.
//
// SCOPE: none of these methods accept a tenant/scope selector — the backend
// resolves all|branch|assigned|own from the caller's session
// (CLAUDE.md §3.5). An out-of-scope `branchId`/`batchId`/`campaignId` filter
// returns 404 (IDOR-safe), never 403 (Part 4 edge-case table).
//
// Money: `RevenueReportDto.totalPaise`/`amountPaise` are INTEGER PAISE with
// an explicit `currency` — never a float (CLAUDE.md §3.6, AC-1).

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
  LeadPerformanceReportQuery,
  LeadPerformanceReportDto,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class ReportsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/crm/reports/revenue
   * AC-1 (HEADLINE): totalPaise reconciles exactly with captured payments in range.
   * Permissions: reports.revenue.view (scope: all|branch).
   */
  async getRevenue(query: RevenueReportQuery): Promise<RevenueReportDto> {
    return this.client.request<RevenueReportDto>(
      "GET",
      `/api/v1/crm/reports/revenue${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/reports/enrollments
   * Permissions: reports.enrollment.view (scope: all|branch|assigned).
   */
  async getEnrollmentTrend(query: EnrollmentTrendQuery): Promise<EnrollmentTrendDto> {
    return this.client.request<EnrollmentTrendDto>(
      "GET",
      `/api/v1/crm/reports/enrollments${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/reports/funnel
   * Permissions: reports.funnel.view (scope: all|branch|own).
   */
  async getFunnel(query: FunnelReportQuery): Promise<FunnelReportDto> {
    return this.client.request<FunnelReportDto>(
      "GET",
      `/api/v1/crm/reports/funnel${toQueryString(query)}`,
    );
  }


  /**
   * GET /api/v1/crm/reports/engagement
   * `dropOffLessonId` in the response names the first lesson crossing the
   * configured drop-off threshold — null if none crossed (AC-18).
   * Permissions: reports.engagement.view (scope: all|branch|assigned).
   */
  async getEngagement(query: EngagementReportQuery): Promise<EngagementReportDto> {
    return this.client.request<EngagementReportDto>(
      "GET",
      `/api/v1/crm/reports/engagement${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/reports/campaigns
   * `metrics` reuses `CampaignMetricsDto` verbatim — matches
   * `campaigns.metrics` exactly, no separate recount drift (AC-20).
   * Permissions: reports.campaigns.view (all-scope; reuses campaigns.view).
   */
  async getCampaignPerformance(query: CampaignPerformanceQuery): Promise<CampaignPerformanceDto> {
    return this.client.request<CampaignPerformanceDto>(
      "GET",
      `/api/v1/crm/reports/campaigns${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/reports/gamification
   * STAFF-FACING: unlike the PII-minimal student leaderboard, `perStudent`
   * rows MAY carry real names/emails (AC-24) — this is a deliberate spec
   * divergence, not a leak. Opted-out students ARE included (AC-25).
   * Permissions: reports.gamification.view (scope: all|assigned).
   */
  async getGamificationParticipation(
    query: GamificationParticipationQuery = {},
  ): Promise<GamificationParticipationDto> {
    return this.client.request<GamificationParticipationDto>(
      "GET",
      `/api/v1/crm/reports/gamification${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/reports/forum-health
   * Permissions: reports.forum.view (scope: all|assigned).
   */
  async getForumHealth(query: ForumHealthReportQuery = {}): Promise<ForumHealthReportDto> {
    return this.client.request<ForumHealthReportDto>(
      "GET",
      `/api/v1/crm/reports/forum-health${toQueryString(query)}`,
    );
  }

  /**
   * GET /api/v1/crm/reports/lead-performance
   * Permissions: reports.lead_performance.view (scope: all|branch).
   *
   * Unlike the other reports on this client, the response carries no `asOf`/`stale`
   * freshness pair — it is computed live rather than off a materialized view, so there is
   * no snapshot for it to be stale against.
   */
  async getLeadPerformance(query: LeadPerformanceReportQuery): Promise<LeadPerformanceReportDto> {
    return this.client.request<LeadPerformanceReportDto>(
      "GET",
      `/api/v1/crm/reports/lead-performance${toQueryString(query)}`,
    );
  }
}
