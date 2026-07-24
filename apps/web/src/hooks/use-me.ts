// Data hook for GET /api/v1/me — the ONLY place components ask "who is the
// current user". Keeps TanStack Query + the api-client call out of
// components per CLAUDE.md §3 ("no business logic in components").
"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { MeResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const ME_QUERY_KEY = ["me"] as const;

export interface UseMeResult {
  me: MeResponse | undefined;
  isLoading: boolean;
  /** True specifically for the 401 "not signed in" case — render the signed-out empty state, not a generic error. */
  isSignedOut: boolean;
  /** Any other failure (network, 5xx, etc.) — render the generic error state. */
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMe(): UseMeResult {
  const query = useQuery<MeResponse, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiClient.auth.getMe(),
    // A 401 here means "signed out", not a transient failure — retrying
    // won't help until the user logs in, so don't burn retries/backoff on it.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    me: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}
