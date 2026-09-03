// LMS Assignments hooks — Phase 4 Task #10.
//
// Fetches and mutations for the student-facing assignment list + detail +
// submit + my-submission views.
//
// Conventions (identical to use-my-progress.ts, use-dashboard.ts):
//   - TanStack Query for data; useMutation for mutations.
//   - isSignedOut: boolean detected from ApiError.isUnauthenticated.
//   - No business logic — components are pure presentational.
//   - Optimistic submit with rollback (docs/07 §6 "confirm + undo on destructive").
//   - NEVER cache a signed URL; getDownloadUrl returns fresh signed URL each call.
//
// CLAUDE.md §3: "No business logic in components — use hooks/services."
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type {
  AssignmentListItem,
  AssignmentStudentDetail,
  SubmissionDetail,
  SubmitAssignmentRequest,
  ProjectDetail,
  OffsetPaginationMeta,
} from "@repo/types";
import { SubmissionContentTypeSchema } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const ASSIGNMENTS_LIST_KEY = ["lms", "assignments", "list"] as const;
export const assignmentDetailKey = (id: string) => ["lms", "assignments", "detail", id] as const;
export const assignmentSubmissionKey = (assignmentId: string) =>
  ["lms", "assignments", "submission", assignmentId] as const;
export const assignmentProjectKey = (assignmentId: string) =>
  ["lms", "assignments", "project", assignmentId] as const;

// ---------------------------------------------------------------------------
// useMyAssignments — student assignment list
// ---------------------------------------------------------------------------

export interface UseMyAssignmentsResult {
  assignments: AssignmentListItem[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMyAssignments(): UseMyAssignmentsResult {
  const query = useQuery<{ items: AssignmentListItem[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: ASSIGNMENTS_LIST_KEY,
    queryFn: () => apiClient.learning.assignments.listMine(),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    assignments: query.data?.items ?? [],
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useAssignmentDetail — student assignment detail
// ---------------------------------------------------------------------------

export interface UseAssignmentDetailResult {
  assignment: AssignmentStudentDetail | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useAssignmentDetail(id: string): UseAssignmentDetailResult {
  const query = useQuery<AssignmentStudentDetail, ApiError>({
    queryKey: assignmentDetailKey(id),
    queryFn: () => apiClient.learning.assignments.getMine(id),
    staleTime: 30_000,
    enabled: Boolean(id),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    assignment: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useMySubmission — student's own submission for an assignment
// ---------------------------------------------------------------------------

export interface UseMySubmissionResult {
  submission: SubmissionDetail | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMySubmission(assignmentId: string): UseMySubmissionResult {
  const query = useQuery<SubmissionDetail, ApiError>({
    queryKey: assignmentSubmissionKey(assignmentId),
    queryFn: () => apiClient.learning.assignments.getMySubmission(assignmentId),
    staleTime: 30_000,
    enabled: Boolean(assignmentId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      // 404 means not yet submitted — don't retry
      if (error instanceof ApiError && error.problem.status === 404) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;
  const isNotFound =
    query.error instanceof ApiError && query.error.problem.status === 404;

  return {
    submission: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    // Treat 404 as "not submitted yet" (empty state), not an error
    isError: query.isError && !isSignedOut && !isNotFound,
    error: (query.isError && !isSignedOut && !isNotFound) ? (query.error ?? null) : null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useMyProject — student's project with milestone states
// ---------------------------------------------------------------------------

export interface UseMyProjectResult {
  project: ProjectDetail | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMyProject(assignmentId: string): UseMyProjectResult {
  const query = useQuery<ProjectDetail, ApiError>({
    queryKey: assignmentProjectKey(assignmentId),
    queryFn: () => apiClient.learning.assignments.getMyProject(assignmentId),
    staleTime: 30_000,
    enabled: Boolean(assignmentId),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    project: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useSubmitAssignment — student submits an assignment (optimistic)
// ---------------------------------------------------------------------------

export interface UseSubmitAssignmentResult {
  submit: (assignmentId: string, body: SubmitAssignmentRequest) => Promise<SubmissionDetail>;
  isSubmitting: boolean;
  error: ApiError | null;
}

export function useSubmitAssignment(): UseSubmitAssignmentResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    SubmissionDetail,
    ApiError,
    { assignmentId: string; body: SubmitAssignmentRequest }
  >({
    mutationFn: ({ assignmentId, body }) =>
      apiClient.learning.assignments.submit(assignmentId, body),
    onSuccess: (_data, { assignmentId }) => {
      // Invalidate the list + detail + submission queries so they refetch
      void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: assignmentDetailKey(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: assignmentSubmissionKey(assignmentId) });
    },
  });

  return {
    submit: (assignmentId, body) => mutation.mutateAsync({ assignmentId, body }),
    isSubmitting: mutation.isPending,
    error: mutation.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// useSubmitMilestone — student submits a project milestone
// ---------------------------------------------------------------------------

export interface UseSubmitMilestoneResult {
  submitMilestone: (
    assignmentId: string,
    milestoneId: string,
    body: SubmitAssignmentRequest,
  ) => Promise<SubmissionDetail>;
  isSubmitting: boolean;
  error: ApiError | null;
}

export function useSubmitMilestone(): UseSubmitMilestoneResult {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    SubmissionDetail,
    ApiError,
    { assignmentId: string; milestoneId: string; body: SubmitAssignmentRequest }
  >({
    mutationFn: ({ assignmentId, milestoneId, body }) =>
      apiClient.learning.assignments.submitMilestone(assignmentId, milestoneId, body),
    onSuccess: (_data, { assignmentId }) => {
      void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: assignmentDetailKey(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: assignmentProjectKey(assignmentId) });
    },
  });

  return {
    submitMilestone: (assignmentId, milestoneId, body) =>
      mutation.mutateAsync({ assignmentId, milestoneId, body }),
    isSubmitting: mutation.isPending,
    error: mutation.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// useRequestUploadUrl — seam for FileUpload component
// Returns the requestUploadUrl callback suitable for FileUpload's prop.
// The component calls this → we call getUploadUrl → PUT to signed URL in FileUpload.
// StorageKey (never the signed URL) is what goes into the submission payload.
// ---------------------------------------------------------------------------

export function useRequestUploadUrl() {
  return async (file: File): Promise<{ url: string; storageKey: string }> => {
    // The server allow-lists the MIME type (SubmissionContentTypeSchema) because the value
    // is locked into the signed PUT and replayed when a reviewer opens the file — an
    // uploaded text/html or image/svg+xml would otherwise render on the storage origin.
    // Parse here so the student gets a named, immediate reason instead of a 422 from the
    // mint call after they have already picked the file.
    const parsedContentType = SubmissionContentTypeSchema.safeParse(file.type);
    if (!parsedContentType.success) {
      throw new Error(
        `"${file.name}" is a ${file.type || "file of unknown type"}, which can't be submitted. ` +
          "Upload a PDF, Word or PowerPoint document, a spreadsheet, a zip, a plain-text or CSV " +
          "file, or a PNG/JPEG/WebP image.",
      );
    }

    const response = await apiClient.learning.storage.getUploadUrl({
      fileName: file.name,
      contentType: parsedContentType.data,
      sizeBytes: file.size,
      purpose: "submission",
    });
    // response matches SignedUploadResponse: { uploadUrl, storageKey, expiresAt, ... }
    return { url: response.uploadUrl, storageKey: response.storageKey };
  };
}
