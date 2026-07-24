// LMS Gamification hook — Phase 6, Task #10.
//
// Fetches:
//   GET /api/v1/me/gamification   → PointsSummaryDto (points, badges, streak, leaderboard prefs)
//   GET /api/v1/batches/:id/leaderboard → LeaderboardEntryDto[] (opt-in, PII-minimal)
//
// Mutations:
//   PUT /api/v1/me/gamification/prefs → UpdateGamificationPrefsDto (leaderboard opt-in + displayName)
//
// The leaderboard is ONLY fetched and rendered when:
//   (a) the summary response shows leaderboardOptIn = true, AND
//   (b) a batchId is provided by the page context.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { PointsSummaryDto, LeaderboardEntryDto, UpdateGamificationPrefsDto } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const GAMIFICATION_SUMMARY_QUERY_KEY = ["lms", "gamification", "summary"] as const;
export const leaderboardQueryKey = (batchId: string) =>
  ["lms", "gamification", "leaderboard", batchId] as const;

// ---------------------------------------------------------------------------
// useGamificationSummary — own-scope points + badges + streak + prefs
// ---------------------------------------------------------------------------

export interface UseGamificationSummaryResult {
  summary: PointsSummaryDto | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  isUpdatingPrefs: boolean;
  updateLeaderboardPrefs: (prefs: UpdateGamificationPrefsDto) => Promise<void>;
  refetch: () => void;
}

/**
 * useGamificationSummary — fetches the student's gamification data (own-scope).
 *
 * Points: display floor of 0 — if totalPoints is negative due to a reversal row,
 * render as Math.max(0, totalPoints) in the component.
 *
 * Leaderboard opt-in: the summary includes leaderboardOptIn and leaderboardDisplayName.
 * Use updateLeaderboardPrefs to toggle opt-in and set the display alias.
 */
export function useGamificationSummary(): UseGamificationSummaryResult {
  const queryClient = useQueryClient();

  const query = useQuery<PointsSummaryDto, ApiError>({
    queryKey: GAMIFICATION_SUMMARY_QUERY_KEY,
    queryFn: () => apiClient.engagement.gamification.getMySummary(),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const prefsUpdateMutation = useMutation<PointsSummaryDto, ApiError, UpdateGamificationPrefsDto>({
    mutationFn: (prefs) => apiClient.engagement.gamification.updatePrefs(prefs),
    onSuccess: (data) => {
      queryClient.setQueryData(GAMIFICATION_SUMMARY_QUERY_KEY, data);
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    summary: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    isUpdatingPrefs: prefsUpdateMutation.isPending,
    updateLeaderboardPrefs: async (prefs) => {
      await prefsUpdateMutation.mutateAsync(prefs);
    },
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useLeaderboard — opt-in batch leaderboard (enrollment-scoped, PII-minimal)
// ---------------------------------------------------------------------------

export interface UseLeaderboardResult {
  entries: LeaderboardEntryDto[];
  total: number;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  /** Whether the student is enrolled in the batch (404 = not enrolled). */
  isNotEnrolled: boolean;
  refetch: () => void;
}

/**
 * useLeaderboard — fetches the batch leaderboard.
 *
 * LOCK-D5: only contains { rank, displayName, totalPoints, badgeCount } — no PII.
 * The query is skipped when batchId is not provided, preventing accidental fetches.
 *
 * AC-52: a non-enrolled student gets 404 → isNotEnrolled = true (the component
 * should hide or not render the leaderboard section).
 */
export function useLeaderboard(batchId: string | null | undefined): UseLeaderboardResult {
  const query = useQuery<{ items: LeaderboardEntryDto[]; meta: { total: number; ttlSeconds: number } }, ApiError>({
    queryKey: batchId ? leaderboardQueryKey(batchId) : ["lms", "gamification", "leaderboard", "__none__"],
    queryFn: () =>
      batchId
        ? apiClient.engagement.gamification.getLeaderboard(batchId)
        : Promise.reject(new Error("No batchId")),
    enabled: Boolean(batchId),
    staleTime: 60_000, // cache TTL aligned with backend's 60s default (AC-51)
    retry: (failureCount, error) => {
      // Don't retry 404 (not enrolled — IDOR-safe)
      if (error instanceof ApiError && (error.isUnauthenticated || error.status === 404)) return false;
      return failureCount < 1;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;
  const isNotEnrolled = query.error instanceof ApiError && query.error.status === 404;

  return {
    entries: query.data?.items ?? [],
    total: query.data?.meta.total ?? 0,
    isLoading: query.isLoading && Boolean(batchId),
    isSignedOut,
    isError: query.isError && !isSignedOut && !isNotEnrolled,
    error: query.error ?? null,
    isNotEnrolled,
    refetch: () => void query.refetch(),
  };
}
