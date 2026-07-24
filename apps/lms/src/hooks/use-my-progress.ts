// LMS My Progress hook — Wave 5b.
//
// Fetches:
//   GET /api/v1/me/progress     → MyProgressResponse (per-program/module rollup)
//   GET /api/v1/me/attendance   → MyAttendanceResponse (recorded attendance list + summaries)
//
// Follows the exact TanStack Query key / loading-empty-error conventions from Wave 5a.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { MyProgressResponse, MyAttendanceResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const MY_PROGRESS_QUERY_KEY = ["lms", "progress", "rollup"] as const;
export const MY_ATTENDANCE_QUERY_KEY = ["lms", "attendance", "list"] as const;

// ---------------------------------------------------------------------------
// useMyProgress
// ---------------------------------------------------------------------------

export interface UseMyProgressResult {
  data: MyProgressResponse | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/me/progress — per-program/module rollup.
 *
 * Returns completion percentages + lesson counts for all of the student's
 * active enrollments, with per-module breakdown. Used to render progress rings +
 * module breakdown bars in the My Progress view (docs/02 §7.10).
 */
export function useMyProgress(): UseMyProgressResult {
  const query = useQuery<MyProgressResponse, ApiError>({
    queryKey: MY_PROGRESS_QUERY_KEY,
    queryFn: () => apiClient.lms.progress.getRollup(),
    staleTime: 60_000,
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

// ---------------------------------------------------------------------------
// useMyAttendance
// ---------------------------------------------------------------------------

export interface UseMyAttendanceResult {
  data: MyAttendanceResponse | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/me/attendance — recorded attendance list + per-enrollment summaries.
 *
 * In P3, only source=recorded rows exist (created server-side on lesson completion).
 * Used to render the attendance section of the My Progress view (docs/02 §7.7).
 */
export function useMyAttendance(): UseMyAttendanceResult {
  const query = useQuery<MyAttendanceResponse, ApiError>({
    queryKey: MY_ATTENDANCE_QUERY_KEY,
    queryFn: () => apiClient.lms.attendance.list({ page: 1, pageSize: 50 }),
    staleTime: 60_000,
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
