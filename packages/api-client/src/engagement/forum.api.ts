// Forum SDK — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Namespace: client.engagement.forum.*
//
// Endpoints covered:
//   LMS student surface (enrollment-scoped):
//     GET    /forum/threads                   → listThreads()
//     POST   /forum/threads                   → createThread()
//     GET    /forum/threads/:id               → getThread()
//     GET    /forum/threads/:id/posts         → listPosts()
//     POST   /forum/threads/:id/posts         → createPost() [replies + nested, parent_id]
//     POST   /forum/posts/:id/vote            → vote()
//     POST   /forum/threads/:id/resolve       → resolveThread()
//
//   CRM Moderation (faculty: assigned-scope; admin: all-scope):
//     POST   /forum/threads/:id/moderate      → moderateThread()
//     POST   /forum/posts/:id/moderate        → moderatePost()
//     GET    /crm/forum/moderation            → getModerationQueue()
//
// SECURITY CONTRACTS:
//   1. listThreads() + createThread() + createPost(): Enrollment-scoped IDOR.
//      A non-enrolled student requesting data for a non-enrolled batch → 404.
//      The backend checks enrollment before returning/writing any data.
//      AC-55, AC-56, AC-58, AC-59.
//   2. vote(): Self-vote prevention — voting on own post → 422 CANNOT_VOTE_OWN_POST (AC-62).
//      Deduped via partial-unique (post_id, user_id) — toggle off on second call (AC-61).
//   3. moderateThread() + moderatePost(): Assigned-scope for faculty (IDOR→404 for
//      non-assigned batches, AC-64). All-scope for admin (AC-67). 403 for students (AC-68).
//   4. All body content is stored raw. DOMPurify MUST be applied on every render
//      in LMS + CRM — the client (not the SDK) is responsible for sanitization before
//      inserting post.body into the DOM (AC-70, LOCK-6).

import type {
  ThreadDto,
  CreateThreadDto,
  PostDto,
  CreatePostDto,
  ModerateDto,
  ModerateResponse,
  VoteResponse,
  ListThreadsQuery,
  ListPostsQuery,
  ListModerationQueueQuery,
  OffsetPaginationMeta,
  PaginationMeta,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class ForumApi {
  constructor(private readonly client: ApiClient) {}

  // ─── Threads (LMS enrollment-scoped) ─────────────────────────────────────

  /**
   * GET /api/v1/forum/threads
   *
   * Returns threads for a batch or program, cursor-paginated.
   *
   * IDOR / Enrollment-scope (AC-55):
   *   A non-enrolled student requesting threads for a non-enrolled batch → 404.
   *   Pass `batchId` to allow the backend to verify enrollment.
   *   A batch with 0 threads returns data=[], meta.hasMore=false (not 404, AC-54).
   *
   * @param query - { batchId, programId, status, cursor, limit }
   * Permissions: forum.read (enrolled scope for students; assigned for faculty; all for admin).
   */
  async listThreads(
    query: Partial<ListThreadsQuery> = {},
  ): Promise<{ items: ThreadDto[]; meta: PaginationMeta }> {
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestCursorPaginated<ThreadDto>(
      "GET",
      `/api/v1/forum/threads${qs ? `?${qs}` : ""}`,
    );
  }

  /**
   * POST /api/v1/forum/threads
   *
   * Creates a new forum thread with an atomically-created opening post (body field).
   *
   * ENROLLMENT IDOR (AC-56):
   *   The student MUST be enrolled in the batchId → 404 if not.
   *   Batch existence is not revealed to non-enrolled students (IDOR-safe).
   *
   * Body max: 10,000 chars (AC-71). The zod schema enforces this at form-validation time.
   *
   * SANITIZATION: The body is stored raw. The frontend MUST apply DOMPurify before
   * inserting the rendered body into the DOM (AC-70).
   *
   * @param body - CreateThreadDto (title + body + batchId|programId).
   * @param idempotencyKey - Default: new UUID.
   * Permissions: forum.post (enrolled scope — student must be enrolled in batchId).
   */
  async createThread(
    body: CreateThreadDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ThreadDto> {
    return this.client.request<ThreadDto>(
      "POST",
      "/api/v1/forum/threads",
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/forum/threads/:id
   *
   * Returns thread detail. Enrollment-scope check applied (AC-55).
   * Permissions: forum.read (enrolled scope).
   */
  async getThread(id: string): Promise<ThreadDto> {
    return this.client.request<ThreadDto>("GET", `/api/v1/forum/threads/${id}`);
  }

  // ─── Posts / replies (LMS enrollment-scoped) ─────────────────────────────

  /**
   * GET /api/v1/forum/threads/:id/posts
   *
   * Lists posts in a thread, offset-paginated. Enrollment-scope check applied.
   * Thread with 0 posts: returns items=[], meta.total=0 (NOT 404).
   *
   * @param threadId - The thread ID.
   * @param query - { parentId?, page?, pageSize? }
   * Permissions: forum.read (enrolled scope).
   */
  async listPosts(
    threadId: string,
    query: Partial<ListPostsQuery> = {},
  ): Promise<{ items: PostDto[]; meta: OffsetPaginationMeta }> {
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestPaginated<PostDto>(
      "GET",
      `/api/v1/forum/threads/${threadId}/posts${qs ? `?${qs}` : ""}`,
    );
  }

  /**
   * POST /api/v1/forum/threads/:id/posts
   *
   * Creates a post or nested reply in a thread.
   *
   * For nested replies: supply `parentId` (must belong to the same thread, AC-59).
   * For top-level reply: omit `parentId` or set to null.
   *
   * Reply notification (AC-60): When a student replies to a thread they did not author,
   * NotificationService.notify(threadAuthor, 'forum_reply', ...) is called server-side.
   *
   * Body max: 10,000 chars (AC-71). Empty body → 422 BODY_REQUIRED.
   *
   * SANITIZATION: Store raw. Frontend MUST apply DOMPurify before DOM insertion (AC-70).
   *
   * @param threadId - The thread ID to post in.
   * @param body - CreatePostDto (body + optional parentId).
   * @param idempotencyKey - Default: new UUID.
   * Permissions: forum.post (enrolled scope — AC-58, AC-59).
   */
  async createPost(
    threadId: string,
    body: CreatePostDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PostDto> {
    return this.client.request<PostDto>(
      "POST",
      `/api/v1/forum/threads/${threadId}/posts`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/forum/posts/:id/vote
   *
   * Toggles an upvote on a post (deduped — one active vote per user per post).
   *
   * - First call: creates forum_post_votes row, increments upvotes (AC-61).
   * - Second call from same user: removes vote, decrements upvotes (toggle off, AC-61).
   * - Self-vote (own post): 422 CANNOT_VOTE_OWN_POST (AC-62).
   * - Concurrent votes from different users: atomic (AC-63).
   *
   * @param postId - The post to vote on.
   * @param idempotencyKey - Default: new UUID.
   * Permissions: forum.post (enrolled scope).
   */
  async vote(
    postId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<VoteResponse> {
    return this.client.request<VoteResponse>(
      "POST",
      `/api/v1/forum/posts/${postId}/vote`,
      { body: {}, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/forum/threads/:id/resolve
   *
   * Marks a thread as resolved (Q&A flow). Can optionally set the accepted answer post.
   * Thread author or moderator only. Enrollment-scope check applied.
   *
   * @param threadId - The thread to resolve.
   * @param body - ModerateDto with action='resolve' + optional resolvedPostId.
   * @param idempotencyKey - Default: new UUID.
   * Permissions: forum.post (own thread) or forum.moderate.
   */
  async resolveThread(
    threadId: string,
    body: ModerateDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ThreadDto> {
    return this.client.request<ThreadDto>(
      "POST",
      `/api/v1/forum/threads/${threadId}/resolve`,
      { body, idempotencyKey },
    );
  }

  // ─── Moderation (CRM faculty/admin surface) ───────────────────────────────

  /**
   * POST /api/v1/forum/threads/:id/moderate
   *
   * Moderation action on a thread (hide/unhide/pin/unpin/delete).
   *
   * RBAC:
   *   - Faculty: assigned-scope (only batches assigned to them, IDOR→404 for others, AC-64).
   *   - Admin: all-scope (AC-67).
   *   - Student with no forum.moderate permission: 403 (AC-68).
   *
   * Every action is audit-logged with actor + before/after (AC-65, AC-66).
   * Soft-delete: 'delete' sets deleted_at (AC-69).
   *
   * @param threadId - The thread to moderate.
   * @param body - ModerateDto with action + optional reason.
   * @param idempotencyKey - Default: new UUID.
   * Permissions: forum.moderate (assigned-scope faculty / all-scope admin).
   */
  async moderateThread(
    threadId: string,
    body: ModerateDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ModerateResponse> {
    return this.client.request<ModerateResponse>(
      "POST",
      `/api/v1/forum/threads/${threadId}/moderate`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/forum/posts/:id/moderate
   *
   * Moderation action on a post (hide/unhide/delete).
   *
   * IMPORTANT: 'hide' action REQUIRES `reason` in the body (AC-65).
   * The ModerateDto schema enforces this at form-validation time.
   *
   * RBAC:
   *   - Faculty: assigned-scope (AC-64, AC-65). All-scope for admin (AC-67). 403 for students (AC-68).
   *
   * Every action is audit-logged. Soft-delete: 'delete' sets deleted_at (AC-69).
   *
   * @param postId - The post to moderate.
   * @param body - ModerateDto with action + reason (required for 'hide').
   * @param idempotencyKey - Default: new UUID.
   * Permissions: forum.moderate (assigned-scope faculty / all-scope admin).
   */
  async moderatePost(
    postId: string,
    body: ModerateDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ModerateResponse> {
    return this.client.request<ModerateResponse>(
      "POST",
      `/api/v1/forum/posts/${postId}/moderate`,
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/crm/forum/moderation
   *
   * Returns the CRM moderation queue — posts that are hidden or reported.
   * Used by the CRM forum moderation view (faculty sees assigned batches only).
   *
   * Faculty: assigned-scope. Admin: all-scope.
   *
   * @param query - { batchId?, status?, page?, pageSize? }
   * Permissions: forum.moderate (assigned-scope faculty / all admin).
   */
  async getModerationQueue(
    query: Partial<ListModerationQueueQuery> = {},
  ): Promise<{ items: PostDto[]; meta: OffsetPaginationMeta }> {
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestPaginated<PostDto>(
      "GET",
      `/api/v1/crm/forum/moderation${qs ? `?${qs}` : ""}`,
    );
  }
}
