// LMS Enrollment detail hook — single enrollment detail by id.
// Fetches GET /api/v1/me/enrollments/:id, which is enrollment-gated:
// the enrollment MUST belong to the requesting student or the API returns 403/404.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { MyEnrollmentDetail } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const ENROLLMENT_QUERY_KEY = ["lms", "enrollment"] as const;

export function enrollmentDetailKey(id: string) {
  return [...ENROLLMENT_QUERY_KEY, "detail", id] as const;
}

export interface UseEnrollmentResult {
  data: MyEnrollmentDetail | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  /** 403/404 returned by API when enrollment doesn't belong to this student. */
  isForbidden: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/me/enrollments/:id — enrollment detail.
 *
 * The API is the enforcement point: it returns 403 if the enrollment doesn't
 * belong to the requesting student. The UI surfaces this gracefully via
 * `isForbidden` (renders a "Not found" empty state rather than a generic error).
 */
export function useEnrollment(id: string | undefined): UseEnrollmentResult {
  const query = useQuery<MyEnrollmentDetail, ApiError>({
    queryKey: enrollmentDetailKey(id ?? ""),
    queryFn: () => apiClient.lms.enrollments.get(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.isUnauthenticated || error.status === 403 || error.status === 404)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;
  const isForbidden =
    query.error instanceof ApiError &&
    (query.error.status === 403 || query.error.status === 404);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isForbidden,
    isError: query.isError && !isSignedOut && !isForbidden,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}
