// LMS My Courses data hook — paginated list of the student's own enrollments.
// Mirrors use-courses.ts / use-enrollments.ts conventions from apps/crm.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { ListMyEnrollmentsQuery, MyEnrollmentSummary, OffsetPaginationMeta } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const MY_COURSES_QUERY_KEY = ["lms", "my-courses"] as const;

export function myCoursesListKey(query: ListMyEnrollmentsQuery) {
  return [...MY_COURSES_QUERY_KEY, "list", query] as const;
}

export interface UseMyCoursesResult {
  data: { items: MyEnrollmentSummary[]; meta: OffsetPaginationMeta } | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/me/enrollments — the student's own enrollment list.
 *
 * Enrollment-scoped: the API only returns enrollments belonging to the
 * authenticated student (enforced server-side; API is the enforcement point).
 */
export function useMyCourses(
  query: ListMyEnrollmentsQuery = { page: 1, pageSize: 20 },
): UseMyCoursesResult {
  const q = useQuery<{ items: MyEnrollmentSummary[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: myCoursesListKey(query),
    queryFn: () => apiClient.lms.enrollments.list(query),
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = q.error instanceof ApiError && q.error.isUnauthenticated;

  return {
    data: q.data,
    isLoading: q.isLoading,
    isSignedOut,
    isError: q.isError && !isSignedOut,
    error: q.error ?? null,
    refetch: () => void q.refetch(),
  };
}
