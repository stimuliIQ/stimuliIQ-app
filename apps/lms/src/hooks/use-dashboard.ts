// LMS Dashboard data hook — student's own dashboard snapshot.
// Data logic lives here; the Dashboard page component is pure presentation.
// Mirrors the use-courses.ts / use-enrollments.ts pattern from apps/crm.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { MeDashboardResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const DASHBOARD_QUERY_KEY = ["lms", "dashboard"] as const;

export interface UseDashboardResult {
  data: MeDashboardResponse | undefined;
  isLoading: boolean;
  /** True specifically for the 401 "not signed in" case. */
  isSignedOut: boolean;
  /** Any other failure (network, 5xx, etc.). */
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/me/dashboard — the student's own dashboard snapshot.
 *
 * The server enforces `courses.view scope:own` — all data is the authenticated
 * student's. This hook is the only place that calls this endpoint; components
 * consume the result via props, never calling client.lms.dashboard.get() directly.
 */
export function useDashboard(): UseDashboardResult {
  const query = useQuery<MeDashboardResponse, ApiError>({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: () => apiClient.lms.dashboard.get(),
    staleTime: 30_000,
    // 401 means signed out — don't retry; surface immediately.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    data: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}
