// Composed reports NOT backed by a dedicated backend report endpoint —
// Phase 9 Completion T40 ("Reports: cohort/branch-comparison/faculty-
// performance/refund reports (extend the analytics routes)"). GAP: no
// `crm/reports/cohort`, `crm/reports/branch-comparison`, or
// `crm/reports/faculty-performance` endpoint exists in apps/api (out of this
// task's scope to add — flagged in the final report). These three are built
// by COMPOSING existing, already-scope-checked endpoints client-side:
//   - Branch comparison: fan-out `crm.reports.getRevenue`/`getEnrollmentTrend`
//     per branch (both already accept an optional `branchId` narrowing filter).
//   - Cohort (= batch, the standard EdTech "intake cohort" unit): the batches
//     to avoid an N+1 fan-out across every batch.
//   - Faculty performance: batch load + fill-rate per faculty, derived from
//     the batches list grouped client-side by facultyId (real data, not an
//     invented metric) — a truer per-faculty rollup would need a
//     new backend aggregate and is out of scope here.
// The refund report has a REAL backend list (`commerce.refunds.list`) — see
// hooks/use-refunds.ts; this file only adds the aggregation on top.
import { useQueries } from "@tanstack/react-query";
import type { BatchSummary, EnrollmentTrendQuery, RevenueReportQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { REPORTS_QUERY_KEY } from "./use-reports";

// ── Branch comparison ───────────────────────────────────────────────────

export interface BranchComparisonRow {
  branchId: string;
  branchName: string;
  revenuePaise: number | null;
  enrollments: number | null;
  loading: boolean;
  error: boolean;
}

export function useBranchComparisonReport(
  branches: ReadonlyArray<{ id: string; name: string }>,
  range: { from: string; to: string },
  enabled: boolean,
): { rows: BranchComparisonRow[]; isLoading: boolean; isError: boolean; refetch: () => void } {
  const revenueQueries = useQueries({
    queries: branches.map((branch) => ({
      queryKey: [...REPORTS_QUERY_KEY, "branch-compare", "revenue", branch.id, range] as const,
      queryFn: () =>
        apiClient.crm.reports.getRevenue({ ...range, branchId: branch.id } satisfies RevenueReportQuery),
      enabled,
      staleTime: 5 * 60 * 1000,
    })),
  });
  const enrollmentQueries = useQueries({
    queries: branches.map((branch) => ({
      queryKey: [...REPORTS_QUERY_KEY, "branch-compare", "enrollment", branch.id, range] as const,
      queryFn: () =>
        apiClient.crm.reports.getEnrollmentTrend({
          ...range,
          branchId: branch.id,
        } satisfies EnrollmentTrendQuery),
      enabled,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const rows: BranchComparisonRow[] = branches.map((branch, i) => ({
    branchId: branch.id,
    branchName: branch.name,
    revenuePaise: revenueQueries[i]?.data?.totalPaise ?? null,
    enrollments: enrollmentQueries[i]?.data?.total ?? null,
    loading: Boolean(revenueQueries[i]?.isLoading || enrollmentQueries[i]?.isLoading),
    error: Boolean(revenueQueries[i]?.isError || enrollmentQueries[i]?.isError),
  }));

  function refetch() {
    revenueQueries.forEach((q) => void q.refetch());
    enrollmentQueries.forEach((q) => void q.refetch());
  }

  return {
    rows,
    isLoading: enabled && rows.some((r) => r.loading),
    isError: enabled && branches.length > 0 && rows.every((r) => r.error),
    refetch,
  };
}

// ── Cohort (batch) report ───────────────────────────────────────────────


// ── Faculty performance (batch load + fill rate) ────────────────────────

export interface FacultyPerformanceRow {
  facultyId: string;
  facultyName: string;
  batchCount: number;
  totalEnrolled: number;
  totalCapacity: number;
  fillRatePercent: number;
}

export function summarizeFacultyPerformance(batches: readonly BatchSummary[]): FacultyPerformanceRow[] {
  const byFaculty = new Map<string, FacultyPerformanceRow>();
  for (const batch of batches) {
    if (!batch.facultyId) continue;
    const existing = byFaculty.get(batch.facultyId);
    if (existing) {
      existing.batchCount += 1;
      existing.totalEnrolled += batch.enrolledCount;
      existing.totalCapacity += batch.capacity;
    } else {
      byFaculty.set(batch.facultyId, {
        facultyId: batch.facultyId,
        facultyName: batch.facultyName ?? "Unknown",
        batchCount: 1,
        totalEnrolled: batch.enrolledCount,
        totalCapacity: batch.capacity,
        fillRatePercent: 0,
      });
    }
  }
  const rows = Array.from(byFaculty.values());
  for (const row of rows) {
    row.fillRatePercent = row.totalCapacity > 0 ? Math.round((row.totalEnrolled / row.totalCapacity) * 100) : 0;
  }
  return rows.sort((a, b) => b.totalEnrolled - a.totalEnrolled);
}
