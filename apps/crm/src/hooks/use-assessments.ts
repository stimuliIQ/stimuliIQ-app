// Assessments + Attempts data hooks — Phase 4 CRM surface.
// Faculty authoring + descriptive-grade queue. All business logic lives in
// hooks, not components (CLAUDE.md §3).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateAssessmentRequest,
  GradeAttemptRequest,
  ListAssessmentsQuery,
  UpdateAssessmentRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Query keys ────────────────────────────────────────────────────────────────

export const ASSESSMENTS_QUERY_KEY = ["assessments"] as const;

export function assessmentsListKey(query: Partial<ListAssessmentsQuery>) {
  return [...ASSESSMENTS_QUERY_KEY, "list", query] as const;
}
export function assessmentDetailKey(id: string) {
  return [...ASSESSMENTS_QUERY_KEY, "detail", id] as const;
}

// ── Assessments ───────────────────────────────────────────────────────────────

export function useAssessmentsList(query: Partial<ListAssessmentsQuery>) {
  return useQuery({
    queryKey: assessmentsListKey(query),
    queryFn: () => apiClient.learning.assessments.list(query),
    placeholderData: (prev) => prev,
  });
}

/**
 * CRM detail — includes questions WITH answer keys.
 * MUST NOT be called from any student-facing surface (AC-D2/AC-J9).
 */
export function useAssessmentDetailAuthor(id: string | undefined) {
  return useQuery({
    queryKey: assessmentDetailKey(id ?? ""),
    queryFn: () => apiClient.learning.assessments.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateAssessments() {
  const queryClient = useQueryClient();
  return (assessmentId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ASSESSMENTS_QUERY_KEY });
    if (assessmentId) {
      void queryClient.invalidateQueries({ queryKey: assessmentDetailKey(assessmentId) });
    }
  };
}

export function useCreateAssessment() {
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: (body: CreateAssessmentRequest) =>
      apiClient.learning.assessments.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateAssessment() {
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAssessmentRequest }) =>
      apiClient.learning.assessments.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

/**
 * Grade a descriptive attempt (manual grade queue).
 * Error 422 MANUAL_GRADE_NOT_APPLICABLE for MCQ-only attempts.
 */
export function useGradeAttempt() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAssessments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: GradeAttemptRequest }) =>
      apiClient.learning.assessments.gradeAttempt(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ASSESSMENTS_QUERY_KEY });
      invalidate();
    },
  });
}
