// Forum moderation data hooks — Phase 6 CRM staff surface (task #11).
// Faculty sees only assigned-batch moderation; admin sees all (API enforces scope).
// All TanStack Query usage + api-client calls here; no business logic in components.
//
// IDOR contract: getModerationQueue returns only records in batches assigned to the
// calling faculty member (assigned-scope) or all batches for admin. A request for
// a non-assigned batch returns 404 from the API — the UI reflects the empty result.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ListModerationQueueQuery,
  ModerateDto,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Query keys ─────────────────────────────────────────────────────────────────

export const MODERATION_QUEUE_KEY = ["forum", "moderation-queue"] as const;

export function moderationQueueKey(query: Partial<ListModerationQueueQuery>) {
  return [...MODERATION_QUEUE_KEY, query] as const;
}

// ── Moderation queue ───────────────────────────────────────────────────────────

/**
 * Fetches the CRM moderation queue — posts that are hidden or reported.
 * GET /api/v1/crm/forum/moderation (faculty: assigned-scope, admin: all-scope).
 * Requires forum.moderate permission.
 */
export function useModerationQueue(query: Partial<ListModerationQueueQuery> = {}) {
  return useQuery({
    queryKey: moderationQueueKey(query),
    queryFn: () => apiClient.engagement.forum.getModerationQueue(query),
    placeholderData: (prev) => prev,
  });
}

// ── Moderation mutations ────────────────────────────────────────────────────────

function useInvalidateModeration() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: MODERATION_QUEUE_KEY });
  };
}

/**
 * Moderate a specific post (hide/unhide/delete).
 * POST /api/v1/forum/posts/:id/moderate
 * - 'hide' requires a non-empty reason (enforced by ModerateDto zod schema).
 * - Faculty: assigned-scope — non-assigned batch → 404 from the API.
 * - Admin: all-scope.
 *
 * Every action is audit-logged server-side (AC-65, AC-69).
 */
export function useModeratePost() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: string; body: ModerateDto }) =>
      apiClient.engagement.forum.moderatePost(postId, body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Moderate a thread (pin/unpin/hide/unhide/delete).
 * POST /api/v1/forum/threads/:id/moderate
 * Faculty: assigned-scope. Admin: all-scope.
 */
export function useModerateThread() {
  const invalidate = useInvalidateModeration();
  return useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: ModerateDto }) =>
      apiClient.engagement.forum.moderateThread(threadId, body),
    onSuccess: () => invalidate(),
  });
}
