// LMS lesson-notes hook (own-scope) — Phase 9 Completion, T10/T29/T36
// (docs/plans/phase-9-completion.md). Backs the "Notes" panel on the lesson detail page —
// a student's personal notes on a lesson, optionally anchored to a video timestamp.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type {
  LessonNote,
  CreateLessonNoteRequest,
  UpdateLessonNoteRequest,
  OffsetPaginationMeta,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LESSON_NOTES_QUERY_KEY = ["lms", "lesson-notes"] as const;

export function lessonNotesKey(lessonId: string) {
  return [...LESSON_NOTES_QUERY_KEY, lessonId] as const;
}

export interface UseLessonNotesResult {
  notes: LessonNote[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  create: (body: CreateLessonNoteRequest) => Promise<LessonNote>;
  isCreating: boolean;
  update: (noteId: string, body: UpdateLessonNoteRequest) => Promise<LessonNote>;
  isUpdating: boolean;
  /** DELETE returns 204 No Content — resolves with nothing. */
  remove: (noteId: string) => Promise<void>;
  isRemoving: boolean;
  refetch: () => void;
}

/** useLessonNotes — a student's own notes on one lesson, ordered by the API (newest first). */
export function useLessonNotes(lessonId: string | undefined): UseLessonNotesResult {
  const queryClient = useQueryClient();

  const listQuery = useQuery<{ items: LessonNote[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: lessonNotesKey(lessonId ?? ""),
    queryFn: () => apiClient.lms.lessonNotes.list(lessonId as string, { page: 1, pageSize: 50 }),
    enabled: Boolean(lessonId),
    staleTime: 15_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const createMutation = useMutation<LessonNote, ApiError, CreateLessonNoteRequest>({
    mutationFn: (body) => apiClient.lms.lessonNotes.create(lessonId as string, body),
    onSuccess: () => {
      if (lessonId) void queryClient.invalidateQueries({ queryKey: lessonNotesKey(lessonId) });
    },
  });

  const updateMutation = useMutation<LessonNote, ApiError, { noteId: string; body: UpdateLessonNoteRequest }>({
    mutationFn: ({ noteId, body }) => apiClient.lms.lessonNotes.update(lessonId as string, noteId, body),
    onSuccess: () => {
      if (lessonId) void queryClient.invalidateQueries({ queryKey: lessonNotesKey(lessonId) });
    },
  });

  // DELETE returns 204 No Content — nothing comes back.
  const removeMutation = useMutation<void, ApiError, string>({
    mutationFn: (noteId) => apiClient.lms.lessonNotes.remove(lessonId as string, noteId),
    onSuccess: () => {
      if (lessonId) void queryClient.invalidateQueries({ queryKey: lessonNotesKey(lessonId) });
    },
  });

  const isSignedOut = listQuery.error instanceof ApiError && listQuery.error.isUnauthenticated;

  return {
    notes: listQuery.data?.items ?? [],
    isLoading: listQuery.isLoading,
    isSignedOut,
    isError: listQuery.isError && !isSignedOut,
    error: listQuery.error ?? null,
    create: (body) => createMutation.mutateAsync(body),
    isCreating: createMutation.isPending,
    update: (noteId, body) => updateMutation.mutateAsync({ noteId, body }),
    isUpdating: updateMutation.isPending,
    remove: (noteId) => removeMutation.mutateAsync(noteId),
    isRemoving: removeMutation.isPending,
    refetch: () => void listQuery.refetch(),
  };
}
