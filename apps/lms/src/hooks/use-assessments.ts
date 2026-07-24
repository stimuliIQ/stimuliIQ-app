// LMS Assessments + Attempts hooks — Phase 4 Task #10.
//
// Fetches and mutations for the student-facing assessment list, detail,
// starting an attempt (timed quiz), submitting answers, and tab-switch flagging.
//
// SECURITY GUARANTEE (answer-key isolation):
//   - startAttempt() returns AssessmentQuestionPublic[] — NO answer key.
//   - The QuizRunner component receives only public question types.
//   - The hooks never expose answer key fields; the @repo/types DTOs structurally
//     omit them (AC-D2, AC-J9).
//
// CLAUDE.md §3: "No business logic in components — use hooks/services."
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type {
  AssessmentSummary,
  AssessmentDetailPublic,
  AttemptInProgress,
  AttemptResult,
  SubmitAttemptRequest,
  FlagAttemptRequest,
  OffsetPaginationMeta,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const ASSESSMENTS_LIST_KEY = ["lms", "assessments", "list"] as const;
export const assessmentDetailKey = (id: string) => ["lms", "assessments", "detail", id] as const;
export const attemptKey = (attemptId: string) => ["lms", "attempts", attemptId] as const;

// ---------------------------------------------------------------------------
// useMyAssessments — student assessment list (no answer keys)
// ---------------------------------------------------------------------------

export interface UseMyAssessmentsResult {
  assessments: AssessmentSummary[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMyAssessments(): UseMyAssessmentsResult {
  const query = useQuery<{ items: AssessmentSummary[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: ASSESSMENTS_LIST_KEY,
    queryFn: () => apiClient.learning.assessments.listMine(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    assessments: query.data?.items ?? [],
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useAssessmentDetail — student assessment metadata (no answer keys)
// ---------------------------------------------------------------------------

export interface UseAssessmentDetailResult {
  assessment: AssessmentDetailPublic | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useAssessmentDetail(id: string): UseAssessmentDetailResult {
  const query = useQuery<AssessmentDetailPublic, ApiError>({
    queryKey: assessmentDetailKey(id),
    queryFn: () => apiClient.learning.assessments.getMine(id),
    staleTime: 30_000,
    enabled: Boolean(id),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    assessment: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useAttempt — get a specific attempt (in-progress or completed)
// ---------------------------------------------------------------------------

export interface UseAttemptResult {
  attempt: AttemptResult | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useAttempt(attemptId: string): UseAttemptResult {
  const query = useQuery<AttemptResult, ApiError>({
    queryKey: attemptKey(attemptId),
    queryFn: () => apiClient.learning.assessments.getAttempt(attemptId),
    staleTime: 10_000,
    enabled: Boolean(attemptId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    attempt: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useStartAttempt — begin a new timed attempt
// Server sets started_at + time_expires_at. Returns shuffled questions with NO answer key.
// ---------------------------------------------------------------------------

export interface UseStartAttemptResult {
  startAttempt: (assessmentId: string) => Promise<AttemptInProgress>;
  isStarting: boolean;
  error: ApiError | null;
}

export function useStartAttempt(): UseStartAttemptResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<AttemptInProgress, ApiError, string>({
    mutationFn: (assessmentId: string) =>
      apiClient.learning.assessments.startAttempt(assessmentId),
    onSuccess: (_data, assessmentId) => {
      // Refresh the assessment detail so attempts_remaining updates
      void queryClient.invalidateQueries({ queryKey: assessmentDetailKey(assessmentId) });
      void queryClient.invalidateQueries({ queryKey: ASSESSMENTS_LIST_KEY });
    },
  });

  return {
    startAttempt: (assessmentId) => mutation.mutateAsync(assessmentId),
    isStarting: mutation.isPending,
    error: mutation.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// useSubmitAttempt — submit answers (idempotent; MCQ auto-graded server-side)
// ---------------------------------------------------------------------------

export interface UseSubmitAttemptResult {
  submitAttempt: (
    attemptId: string,
    body: SubmitAttemptRequest,
  ) => Promise<AttemptResult>;
  isSubmitting: boolean;
  error: ApiError | null;
}

export function useSubmitAttempt(): UseSubmitAttemptResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    AttemptResult,
    ApiError,
    { attemptId: string; body: SubmitAttemptRequest }
  >({
    mutationFn: ({ attemptId, body }) =>
      apiClient.learning.assessments.submitAttempt(attemptId, body),
    onSuccess: (data, { attemptId }) => {
      // Cache the result so the results view loads instantly
      queryClient.setQueryData(attemptKey(attemptId), data);
      // Refresh the assessments list (attempts_remaining, status)
      void queryClient.invalidateQueries({ queryKey: ASSESSMENTS_LIST_KEY });
    },
  });

  return {
    submitAttempt: (attemptId, body) => mutation.mutateAsync({ attemptId, body }),
    isSubmitting: mutation.isPending,
    error: mutation.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// useFlagAttempt — advisory tab-switch signal (not a hard block — AC-D6)
// ---------------------------------------------------------------------------

export interface UseFlagAttemptResult {
  flagAttempt: (attemptId: string, body: FlagAttemptRequest) => void;
}

export function useFlagAttempt(): UseFlagAttemptResult {
  const mutation = useMutation<AttemptResult, ApiError, { attemptId: string; body: FlagAttemptRequest }>({
    mutationFn: ({ attemptId, body }) =>
      apiClient.learning.assessments.flagAttempt(attemptId, body),
    // Fire-and-forget — no UI feedback needed for the advisory flag
  });

  return {
    flagAttempt: (attemptId, body) => {
      mutation.mutate({ attemptId, body });
    },
  };
}
