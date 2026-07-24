// LMS bookmarks hook (own-scope) — Phase 9 Completion, T10/T29/T36
// (docs/plans/phase-9-completion.md). Backs the bookmark toggle button on lessons/threads
// and the "My Bookmarks" tab on the /search page.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { Bookmark, CreateBookmarkRequest, ListBookmarksQuery, OffsetPaginationMeta } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const BOOKMARKS_QUERY_KEY = ["lms", "bookmarks"] as const;

export function bookmarksListKey(query: ListBookmarksQuery) {
  return [...BOOKMARKS_QUERY_KEY, "list", query] as const;
}

export interface UseBookmarksResult {
  bookmarks: Bookmark[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  create: (body: CreateBookmarkRequest) => Promise<Bookmark>;
  isCreating: boolean;
  /** DELETE returns 204 No Content — resolves with nothing. */
  remove: (id: string) => Promise<void>;
  isRemoving: boolean;
  refetch: () => void;
}

/**
 * useBookmarks — the student's own bookmarks (optionally filtered by refType,
 * e.g. "lesson" or "forum_thread"). Own-scope; IDOR->404 on delete of another
 * user's bookmark is handled by the API — this hook does not special-case it.
 */
export function useBookmarks(query: ListBookmarksQuery = { page: 1, pageSize: 50 }): UseBookmarksResult {
  const queryClient = useQueryClient();

  const listQuery = useQuery<{ items: Bookmark[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: bookmarksListKey(query),
    queryFn: () => apiClient.lms.bookmarks.list(query),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const createMutation = useMutation<Bookmark, ApiError, CreateBookmarkRequest>({
    mutationFn: (body) => apiClient.lms.bookmarks.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOOKMARKS_QUERY_KEY });
    },
  });

  // DELETE returns 204 No Content — nothing comes back.
  const removeMutation = useMutation<void, ApiError, string>({
    mutationFn: (id) => apiClient.lms.bookmarks.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOOKMARKS_QUERY_KEY });
    },
  });

  const isSignedOut = listQuery.error instanceof ApiError && listQuery.error.isUnauthenticated;

  return {
    bookmarks: listQuery.data?.items ?? [],
    isLoading: listQuery.isLoading,
    isSignedOut,
    isError: listQuery.isError && !isSignedOut,
    error: listQuery.error ?? null,
    create: (body) => createMutation.mutateAsync(body),
    isCreating: createMutation.isPending,
    remove: (id) => removeMutation.mutateAsync(id),
    isRemoving: removeMutation.isPending,
    refetch: () => void listQuery.refetch(),
  };
}

/**
 * useBookmarkToggle — a lightweight bookmark on/off toggle for a single
 * (refType, refId) pair (e.g. one lesson, one forum thread). Looks up whether
 * a bookmark already exists among the caller-provided `bookmarks` list (from
 * useBookmarks) and exposes a single `toggle()` that creates or removes it.
 */
export function useBookmarkToggle(refType: string, refId: string) {
  const { bookmarks, create, remove, isCreating, isRemoving } = useBookmarks({
    refType,
    page: 1,
    pageSize: 100,
  });

  const existing = bookmarks.find((b) => b.refType === refType && b.refId === refId);

  return {
    isBookmarked: Boolean(existing),
    isPending: isCreating || isRemoving,
    toggle: async (note?: string) => {
      if (existing) {
        await remove(existing.id);
      } else {
        await create({ refType, refId, note });
      }
    },
  };
}
