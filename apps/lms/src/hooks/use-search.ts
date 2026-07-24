// LMS global search hook — Phase 9 Completion, T36 (docs/plans/phase-9-completion.md).
// GET /api/v1/me/search — own-scoped lessons/resources/forum threads via tsvector.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { GlobalSearchResponse, SearchResultType } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const SEARCH_QUERY_KEY = ["lms", "search"] as const;

export interface UseGlobalSearchOptions {
  /** Restrict to a subset of result types (e.g. ["resource"] for the Downloads page). */
  types?: SearchResultType[];
  limit?: number;
}

export interface UseGlobalSearchResult {
  results: GlobalSearchResponse["results"];
  isLoading: boolean;
  isFetching: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

/**
 * useGlobalSearch — searches the student's own-scoped lessons/resources/forum
 * threads. Skipped (query disabled) while `q` is empty since the API requires
 * a non-empty search term (`q: z.string().min(1)`).
 */
export function useGlobalSearch(q: string, options: UseGlobalSearchOptions = {}): UseGlobalSearchResult {
  const trimmed = q.trim();
  const { types, limit = 20 } = options;

  const query = useQuery<GlobalSearchResponse, ApiError>({
    queryKey: [...SEARCH_QUERY_KEY, trimmed, types?.join(",") ?? "all", limit],
    queryFn: () =>
      apiClient.lms.search.search({
        q: trimmed,
        types: types && types.length > 0 ? types.join(",") : undefined,
        limit,
      }),
    enabled: trimmed.length > 0,
    staleTime: 15_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    results: query.data?.results ?? [],
    isLoading: query.isLoading && trimmed.length > 0,
    isFetching: query.isFetching,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}
