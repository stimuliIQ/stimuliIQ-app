// Analytics/KPI dashboard data hooks — Phase 7, Wave 3 (docs/plans/phase-7.md
// task #14). All TanStack Query usage + api-client calls for the 8 WS-A
// dashboards live here; components only format/derive chart props
// (CLAUDE.md §3: no business logic in components).
//
// Every response is materialized-view-backed (LOCK-D1, docs/specs/phase-7-
// analytics-hardening.md) and refreshed on a ~5min cadence — `staleTime`
// below matches that so we don't refetch faster than the data can possibly
// change, while still picking up a new refresh on refocus/remount.
//
// SCOPE: none of these hooks accept a tenant/scope selector — the backend
// resolves all|branch|assigned|own from the caller's session. `enabled`
// lets a caller gate a query on RBAC (a permission the user lacks) or on a
// required selector not yet chosen (e.g. `programId` for engagement,
// `campaignId` for campaign performance) — CLAUDE.md §3.5: the UI only
// hides what the API would forbid/require, it never invents its own rule.
import { useQuery } from "@tanstack/react-query";
import type {
  CampaignPerformanceQuery,
  EngagementReportQuery,
  EnrollmentTrendQuery,
  ForumHealthReportQuery,
  FunnelReportQuery,
  GamificationParticipationQuery,
  LeadPerformanceReportQuery,
  RevenueReportQuery,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const REPORTS_QUERY_KEY = ["reports"] as const;

/** Materialized views refresh on a ~5min cadence (LOCK-D1) — don't poll faster than that. */
const REPORT_STALE_TIME_MS = 5 * 60 * 1000;

export function useRevenueReport(query: RevenueReportQuery, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "revenue", query] as const,
    queryFn: () => apiClient.crm.reports.getRevenue(query),
    enabled,
    staleTime: REPORT_STALE_TIME_MS,
  });
}

export function useEnrollmentTrendReport(query: EnrollmentTrendQuery, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "enrollment-trend", query] as const,
    queryFn: () => apiClient.crm.reports.getEnrollmentTrend(query),
    enabled,
    staleTime: REPORT_STALE_TIME_MS,
  });
}

export function useFunnelReport(query: FunnelReportQuery, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "funnel", query] as const,
    queryFn: () => apiClient.crm.reports.getFunnel(query),
    enabled,
    staleTime: REPORT_STALE_TIME_MS,
  });
}


/** `programId` is mandatory server-side — pass `enabled=false` (or omit `programId`) until one is chosen. */
export function useEngagementReport(query: EngagementReportQuery | undefined, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "engagement", query ?? null] as const,
    queryFn: () => apiClient.crm.reports.getEngagement(query as EngagementReportQuery),
    enabled: enabled && Boolean(query?.programId),
    staleTime: REPORT_STALE_TIME_MS,
  });
}

/** `campaignId` is mandatory server-side — pass `enabled=false` (or omit `campaignId`) until one is chosen. */
export function useCampaignPerformanceReport(
  query: CampaignPerformanceQuery | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "campaign-performance", query ?? null] as const,
    queryFn: () => apiClient.crm.reports.getCampaignPerformance(query as CampaignPerformanceQuery),
    enabled: enabled && Boolean(query?.campaignId),
    staleTime: REPORT_STALE_TIME_MS,
  });
}

export function useGamificationParticipationReport(
  query: GamificationParticipationQuery = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "gamification", query] as const,
    queryFn: () => apiClient.crm.reports.getGamificationParticipation(query),
    enabled,
    staleTime: REPORT_STALE_TIME_MS,
  });
}

export function useForumHealthReport(query: ForumHealthReportQuery = {}, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "forum-health", query] as const,
    queryFn: () => apiClient.crm.reports.getForumHealth(query),
    enabled,
    staleTime: REPORT_STALE_TIME_MS,
  });
}

/**
 * Per-rep lead performance.
 *
 * The ONE report here that is NOT materialized-view-backed, so it does not inherit
 * REPORT_STALE_TIME_MS: a 5-minute stale window is right for numbers that physically
 * cannot change faster than the MV refresh, and wrong for "how many calls has this rep
 * logged today", which changes the moment somebody hangs up. A short window keeps a
 * manager refreshing the page from being told yesterday's answer.
 */
export function useLeadPerformanceReport(query: LeadPerformanceReportQuery, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_QUERY_KEY, "lead-performance", query] as const,
    queryFn: () => apiClient.crm.reports.getLeadPerformance(query),
    enabled,
    staleTime: 30 * 1000,
  });
}
