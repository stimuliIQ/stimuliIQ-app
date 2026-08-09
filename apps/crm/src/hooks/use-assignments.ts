// Assignments + Projects + Submissions data hooks — Phase 4 CRM surface.
// All TanStack Query usage + api-client calls live here; no business logic
// in components (CLAUDE.md §3: hooks own data concerns).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateAssignmentRequest,
  GradeSubmissionRequest,
  ListAssignmentsQuery,
  ListSubmissionsQuery,
  UpdateAssignmentRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Query keys ────────────────────────────────────────────────────────────────

export const ASSIGNMENTS_QUERY_KEY = ["assignments"] as const;

export function assignmentsListKey(query: Partial<ListAssignmentsQuery>) {
  return [...ASSIGNMENTS_QUERY_KEY, "list", query] as const;
}
export function assignmentDetailKey(id: string) {
  return [...ASSIGNMENTS_QUERY_KEY, "detail", id] as const;
}
export function assignmentProjectKey(id: string) {
  return [...ASSIGNMENTS_QUERY_KEY, "project", id] as const;
}
export function submissionsListKey(assignmentId: string, query: Partial<ListSubmissionsQuery>) {
  return [...ASSIGNMENTS_QUERY_KEY, "submissions", assignmentId, query] as const;
}
export function submissionDetailKey(id: string) {
  return [...ASSIGNMENTS_QUERY_KEY, "submission", id] as const;
}

// ── Assignments ───────────────────────────────────────────────────────────────

export function useAssignmentsList(query: Partial<ListAssignmentsQuery>) {
  return useQuery({
    queryKey: assignmentsListKey(query),
    queryFn: () => apiClient.learning.assignments.list(query),
    placeholderData: (prev) => prev,
  });
}

export function useAssignment(id: string | undefined) {
  return useQuery({
    queryKey: assignmentDetailKey(id ?? ""),
    queryFn: () => apiClient.learning.assignments.get(id as string),
    enabled: Boolean(id),
  });
}

export function useProjectDetail(assignmentId: string | undefined) {
  return useQuery({
    queryKey: assignmentProjectKey(assignmentId ?? ""),
    queryFn: () => apiClient.learning.assignments.getProjectCrm(assignmentId as string),
    enabled: Boolean(assignmentId),
  });
}

function useInvalidateAssignments() {
  const queryClient = useQueryClient();
  return (assignmentId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_QUERY_KEY });
    if (assignmentId) {
      void queryClient.invalidateQueries({ queryKey: assignmentDetailKey(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: assignmentProjectKey(assignmentId) });
    }
  };
}

export function useCreateAssignment() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (body: CreateAssignmentRequest) =>
      apiClient.learning.assignments.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateAssignment() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAssignmentRequest }) =>
      apiClient.learning.assignments.update(id, body),
    onSuccess: (_data, variables) => invalidate(variables.id),
  });
}

export function useDeleteAssignment() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (id: string) => apiClient.learning.assignments.softDelete(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

// ── Submissions (faculty grading queue) ──────────────────────────────────────

export function useSubmissionsList(
  assignmentId: string | undefined,
  query: Partial<ListSubmissionsQuery>,
) {
  return useQuery({
    queryKey: submissionsListKey(assignmentId ?? "", query),
    queryFn: () =>
      apiClient.learning.assignments.listSubmissions(assignmentId as string, query),
    enabled: Boolean(assignmentId),
    placeholderData: (prev) => prev,
  });
}

export function useSubmissionDetail(submissionId: string | undefined) {
  return useQuery({
    queryKey: submissionDetailKey(submissionId ?? ""),
    queryFn: () => apiClient.learning.assignments.getSubmission(submissionId as string),
    enabled: Boolean(submissionId),
  });
}

function useInvalidateSubmissions() {
  const queryClient = useQueryClient();
  return (assignmentId?: string, submissionId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_QUERY_KEY });
    if (assignmentId) {
      void queryClient.invalidateQueries({ queryKey: submissionsListKey(assignmentId, {}) });
      void queryClient.invalidateQueries({ queryKey: assignmentDetailKey(assignmentId) });
    }
    if (submissionId) {
      void queryClient.invalidateQueries({ queryKey: submissionDetailKey(submissionId) });
    }
  };
}

/**
 * Send a submission back to the student for changes.
 *
 * Not optimistic, unlike grading: this fires an email to the student and flips the project's
 * resubmission flag server-side, so the UI should reflect what actually happened rather than
 * what it hoped would. Invalidates broadly — the queue's status counts, the assignment's
 * graded/total counters and the submission itself all move.
 */
export function useReturnSubmission(assignmentId?: string) {
  const invalidate = useInvalidateSubmissions();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.learning.assignments.returnSubmission(id, { reason }),
    onSuccess: (_data, variables) => invalidate(assignmentId, variables.id),
  });
}

/**
 * Grade a submission (optimistic update + rollback on error).
 * Writes audit log before/after on the server (AC-B1/AC-B3).
 */
export function useGradeSubmission(assignmentId?: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateSubmissions();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: GradeSubmissionRequest }) =>
      apiClient.learning.assignments.gradeSubmission(id, body),
    // Optimistic update: mark the submission as graded in the cache immediately
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: submissionDetailKey(id) });
      const snapshot = queryClient.getQueryData(submissionDetailKey(id));
      return { snapshot, submissionId: id };
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.snapshot && context.submissionId) {
        queryClient.setQueryData(submissionDetailKey(context.submissionId), context.snapshot);
      }
    },
    onSuccess: (_data, variables) => {
      invalidate(assignmentId, variables.id);
    },
  });
}
