// LMS Forum hook — Phase 6, Task #10.
//
// Manages forum threads and posts for enrolled students.
// IDOR: Non-enrolled batch → 404 (AC-55, AC-56).
//
// Sanitization: all post bodies MUST be DOMPurify-sanitized before rendering.
// This hook does NOT sanitize — that is the component's responsibility
// via sanitizeHtml() from @/lib/sanitize.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { ThreadDto, PostDto, CreateThreadDto, CreatePostDto, ModerateDto, VoteResponse, ListThreadsQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const forumThreadsQueryKey = (batchId: string | null | undefined) =>
  ["lms", "forum", "threads", batchId ?? "__all__"] as const;

export const forumThreadDetailQueryKey = (threadId: string) =>
  ["lms", "forum", "thread", threadId] as const;

export const forumPostsQueryKey = (threadId: string) =>
  ["lms", "forum", "posts", threadId] as const;

// ---------------------------------------------------------------------------
// useForumThreads — thread list for a batch (enrollment-scoped)
// ---------------------------------------------------------------------------

export interface UseForumThreadsResult {
  threads: ThreadDto[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  isNotEnrolled: boolean;
  error: ApiError | null;
  hasMore: boolean;
  createThread: (data: CreateThreadDto) => Promise<ThreadDto>;
  isCreating: boolean;
  refetch: () => void;
}

/**
 * useForumThreads — fetches threads for a batch/program.
 *
 * IDOR (AC-55): non-enrolled student → 404.
 * The component hides the "Create Thread" button for batches where the
 * API would return 404 (isNotEnrolled = true). The API already enforces IDOR.
 *
 * @param batchId - The batch ID to scope threads to.
 */
export function useForumThreads(batchId: string | null | undefined): UseForumThreadsResult {
  const queryClient = useQueryClient();

  const query = useQuery<{ items: ThreadDto[]; meta: { hasMore?: boolean; nextCursor?: string } }, ApiError>({
    queryKey: forumThreadsQueryKey(batchId),
    queryFn: async () => {
      const q: Partial<ListThreadsQuery> = {};
      if (batchId) q.batchId = batchId;
      const result = await apiClient.engagement.forum.listThreads(q);
      return result as { items: ThreadDto[]; meta: { hasMore?: boolean; nextCursor?: string } };
    },
    enabled: Boolean(batchId),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.isUnauthenticated || error.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const createMutation = useMutation<ThreadDto, ApiError, CreateThreadDto>({
    mutationFn: (data) => apiClient.engagement.forum.createThread(data),
    onSuccess: (newThread) => {
      // Prepend to thread list
      queryClient.setQueryData(
        forumThreadsQueryKey(batchId),
        (old: { items: ThreadDto[]; meta: unknown } | undefined) => {
          if (!old) return { items: [newThread], meta: {} };
          return { ...old, items: [newThread, ...old.items] };
        },
      );
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;
  const isNotEnrolled = query.error instanceof ApiError && query.error.status === 404;

  return {
    threads: query.data?.items ?? [],
    isLoading: query.isLoading && Boolean(batchId),
    isSignedOut,
    isError: query.isError && !isSignedOut && !isNotEnrolled,
    isNotEnrolled,
    error: query.error ?? null,
    hasMore: query.data?.meta?.hasMore ?? false,
    createThread: (data) => createMutation.mutateAsync(data),
    isCreating: createMutation.isPending,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useForumPosts — posts in a thread (enrollment-scoped)
// ---------------------------------------------------------------------------

export interface UseForumPostsResult {
  posts: PostDto[];
  thread: ThreadDto | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  isNotEnrolled: boolean;
  error: ApiError | null;
  createPost: (data: CreatePostDto) => Promise<PostDto>;
  isPosting: boolean;
  upvote: (postId: string) => Promise<VoteResponse>;
  resolveThread: (data: ModerateDto) => Promise<ThreadDto>;
  refetch: () => void;
}

/**
 * useForumPosts — fetches posts in a thread + handles post mutations.
 *
 * DOMPurify note: post bodies are returned raw from the API. The component
 * MUST sanitize each body via sanitizeHtml() before rendering (AC-70).
 *
 * @param threadId - The thread to fetch posts for.
 */
export function useForumPosts(threadId: string | null | undefined): UseForumPostsResult {
  const queryClient = useQueryClient();

  const threadQuery = useQuery<ThreadDto, ApiError>({
    queryKey: threadId ? forumThreadDetailQueryKey(threadId) : ["lms", "forum", "thread", "__none__"],
    queryFn: () => (threadId ? apiClient.engagement.forum.getThread(threadId) : Promise.reject(new Error("No threadId"))),
    enabled: Boolean(threadId),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.isUnauthenticated || error.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const postsQuery = useQuery<{ items: PostDto[]; meta: unknown }, ApiError>({
    queryKey: threadId ? forumPostsQueryKey(threadId) : ["lms", "forum", "posts", "__none__"],
    queryFn: () =>
      threadId
        ? (apiClient.engagement.forum.listPosts(threadId) as Promise<{ items: PostDto[]; meta: unknown }>)
        : Promise.reject(new Error("No threadId")),
    enabled: Boolean(threadId),
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.isUnauthenticated || error.status === 404)) return false;
      return failureCount < 2;
    },
  });

  const createPostMutation = useMutation<PostDto, ApiError, CreatePostDto>({
    mutationFn: (data) => {
      if (!threadId) throw new Error("No threadId");
      return apiClient.engagement.forum.createPost(threadId, data);
    },
    onSuccess: (newPost) => {
      if (!threadId) return;
      queryClient.setQueryData(
        forumPostsQueryKey(threadId),
        (old: { items: PostDto[]; meta: unknown } | undefined) => {
          if (!old) return { items: [newPost], meta: {} };
          return { ...old, items: [...old.items, newPost] };
        },
      );
    },
  });

  const upvoteMutation = useMutation<VoteResponse, ApiError, string>({
    mutationFn: (postId) => apiClient.engagement.forum.vote(postId),
    onSuccess: (response, postId) => {
      if (!threadId) return;
      queryClient.setQueryData(
        forumPostsQueryKey(threadId),
        (old: { items: PostDto[]; meta: unknown } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((p) =>
              p.id === postId
                ? {
                    ...p,
                    upvotes: response.upvotes,
                    hasVoted: response.hasVoted,
                  }
                : p,
            ),
          };
        },
      );
    },
  });

  const resolveThreadMutation = useMutation<ThreadDto, ApiError, ModerateDto>({
    mutationFn: (data) => {
      if (!threadId) throw new Error("No threadId");
      return apiClient.engagement.forum.resolveThread(threadId, data);
    },
    onSuccess: (updatedThread) => {
      if (!threadId) return;
      queryClient.setQueryData(forumThreadDetailQueryKey(threadId), updatedThread);
    },
  });

  const isSignedOut =
    (threadQuery.error instanceof ApiError && threadQuery.error.isUnauthenticated) ||
    (postsQuery.error instanceof ApiError && postsQuery.error.isUnauthenticated);

  const isNotEnrolled =
    (threadQuery.error instanceof ApiError && threadQuery.error.status === 404) ||
    (postsQuery.error instanceof ApiError && postsQuery.error.status === 404);

  const isLoading = (threadQuery.isLoading || postsQuery.isLoading) && Boolean(threadId);

  return {
    posts: postsQuery.data?.items ?? [],
    thread: threadQuery.data,
    isLoading,
    isSignedOut,
    isError:
      (threadQuery.isError && !isSignedOut && !isNotEnrolled) ||
      (postsQuery.isError && !isSignedOut && !isNotEnrolled),
    isNotEnrolled,
    error: threadQuery.error ?? postsQuery.error ?? null,
    createPost: (data) => createPostMutation.mutateAsync(data),
    isPosting: createPostMutation.isPending,
    upvote: (postId) => upvoteMutation.mutateAsync(postId),
    resolveThread: (data) => resolveThreadMutation.mutateAsync(data),
    refetch: () => {
      void threadQuery.refetch();
      void postsQuery.refetch();
    },
  };
}
