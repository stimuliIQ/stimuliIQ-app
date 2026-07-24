// LMS learning-path hook (own-scope) — Phase 9 Completion, T14/T35
// (docs/plans/phase-9-completion.md). GET /api/v1/me/learning-path — "what to do
// next" across the student's active enrollments.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { LearningPathResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LEARNING_PATH_QUERY_KEY = ["lms", "learning-path"] as const;

export interface UseLearningPathResult {
  steps: LearningPathResponse["steps"];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useLearningPath(): UseLearningPathResult {
  const query = useQuery<LearningPathResponse, ApiError>({
    queryKey: LEARNING_PATH_QUERY_KEY,
    queryFn: () => apiClient.lms.learningPath.get(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    steps: query.data?.steps ?? [],
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}
