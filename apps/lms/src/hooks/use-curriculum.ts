// LMS Curriculum hook — enrollment-gated curriculum tree for one enrollment.
// Fetches GET /api/v1/me/enrollments/:id/curriculum.
// The API returns 403 if the enrollment doesn't belong to the requesting student;
// the UI handles this gracefully — the API is the enforcement point.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { CurriculumResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const CURRICULUM_QUERY_KEY = ["lms", "curriculum"] as const;

export function curriculumKey(enrollmentId: string) {
  return [...CURRICULUM_QUERY_KEY, enrollmentId] as const;
}

export interface UseCurriculumResult {
  data: CurriculumResponse | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  /** API returned 403/404 — enrollment doesn't belong to this student. */
  isForbidden: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/me/enrollments/:id/curriculum — enrollment-gated curriculum tree.
 *
 * Returns program → modules → lessons with per-lesson progress snapshots and
 * locked flags. The API is the enforcement point for enrollment scope:
 * a student can only access curriculum for their own active enrollments.
 *
 * Lesson content bodies are NOT in this response. Call useLesson(lessonId) for
 * the full detail of a specific lesson.
 */
export function useCurriculum(enrollmentId: string | undefined): UseCurriculumResult {
  const query = useQuery<CurriculumResponse, ApiError>({
    queryKey: curriculumKey(enrollmentId ?? ""),
    queryFn: () => apiClient.lms.enrollments.getCurriculum(enrollmentId as string),
    enabled: Boolean(enrollmentId),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.isUnauthenticated || error.status === 403 || error.status === 404)
      ) {
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
