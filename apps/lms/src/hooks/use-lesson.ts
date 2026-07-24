// LMS Lesson detail hook — fetches GET /api/v1/lessons/:id.
// Enrollment-gated for non-preview lessons; preview lessons are open.
// The API is the enforcement point: 403 for non-enrolled non-preview access.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
// Wave 5b adds useStreamUrl() alongside this file; see the 5b seam comment below.
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { LessonDetailResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LESSON_QUERY_KEY = ["lms", "lesson"] as const;

export function lessonDetailKey(id: string) {
  return [...LESSON_QUERY_KEY, "detail", id] as const;
}

export interface UseLessonResult {
  data: LessonDetailResponse | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  /** 403/404 — not enrolled or lesson doesn't exist. */
  isForbidden: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * GET /api/v1/lessons/:id — lesson detail (metadata + content body + resource list).
 *
 * Enrollment-gated for non-preview lessons.
 * Preview lessons (is_preview=true) are accessible without enrollment.
 * The API returns 403 for non-enrolled non-preview access — UI handles gracefully.
 *
 * NOTE: does NOT return a playable stream URL.
 * Wave 5b adds useStreamUrl(lessonId) which calls GET /api/v1/lessons/:id/stream-url
 * just before playback. That hook must NOT cache the URL or log it.
 *
 * WAVE 5b seam:
 * - Add useStreamUrl(lessonId) to this file (or a separate use-stream-url.ts).
 * - The VideoPlayer component (from @repo/ui) mounts in the lesson page and
 *   calls useStreamUrl() via the player's onPlay callback.
 * - Progress reporting: call apiClient.lms.progress.ping(id, body) and
 *   apiClient.lms.progress.complete(id) from a dedicated useProgressReporting()
 *   hook in src/hooks/use-progress-reporting.ts.
 */
export function useLesson(id: string | undefined): UseLessonResult {
  const query = useQuery<LessonDetailResponse, ApiError>({
    queryKey: lessonDetailKey(id ?? ""),
    queryFn: () => apiClient.lms.lessons.get(id as string),
    enabled: Boolean(id),
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
