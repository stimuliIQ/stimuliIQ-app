// Forum contracts — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Covers WS-4 (Forum / Community):
//   - ThreadDto          — forum thread summary (list + detail view)
//   - CreateThreadDto    — POST /forum/threads input (enrollment-scoped)
//   - PostDto            — forum post (reply) with nested reply support
//   - CreatePostDto      — POST /forum/threads/:id/posts input (parent_id for nesting)
//   - ModerateDto        — moderation action input (hide/pin/resolve/delete)
//   - VoteDto            — upvote toggle input (POST /forum/posts/:id/vote)
//
// Architecture decisions (LOCKED per docs/specs/phase-6-engagement.md):
//   LOCK-6: Forum richness — plain text only (no rich editor, no attachments,
//     no @mentions, no full-text search). Sanitized at render (DOMPurify in frontend).
//   AC-71: Body max 10,000 characters. Enforced at the API boundary.
//   AC-70: DOMPurify applied on every render (frontend responsibility). Server
//     validates length/shape and strips obvious HTML (defense-in-depth).
//
// RBAC:
//   - `forum.read` (enrolled | assigned | branch | all): reading threads/posts.
//   - `forum.post` (enrolled | assigned | all): creating threads and posts.
//   - `forum.moderate` (assigned | branch | all): hide/pin/delete/unhide.
//   - IDOR→404 for non-enrolled students and non-assigned faculty (AC-55, AC-56, AC-64).
//
// All schemas are .strict() — global ZodValidationPipe strips extras.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums (mirror Prisma ThreadStatus, PostStatus)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Thread lifecycle + moderation state. Matches Prisma `ThreadStatus`.
 *   open     → normal discussion thread
 *   resolved → thread author (or moderator) marked the thread as resolved (Q&A)
 *   hidden   → moderator hid the thread (not visible to students)
 *   pinned   → moderator pinned the thread (shown at the top)
 */
export const ThreadStatusSchema = z.enum(["open", "resolved", "hidden", "pinned"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

/**
 * Post visibility state. Matches Prisma `PostStatus`.
 *   visible → normal post visible to enrolled students
 *   hidden  → moderator hid the post (not visible to students, AC-65)
 */
export const PostStatusSchema = z.enum(["visible", "hidden"]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

/**
 * Moderation action types for the ModerateDto.
 */
export const ModerateActionSchema = z.enum(["hide", "unhide", "pin", "unpin", "resolve", "unresolve", "delete"]);
export type ModerateAction = z.infer<typeof ModerateActionSchema>;

// ─────────────────────────────────────────────────────────────────────────
// ThreadDto — forum thread summary / list view
// ─────────────────────────────────────────────────────────────────────────

/**
 * Author summary for threads and posts — safe for display.
 * MUST NOT carry email, phone, or internal IDs beyond the display context.
 */
export const ForumAuthorDtoSchema = z
  .object({
    id: UuidSchema.describe("User ID. Opaque; used for IDOR prevention on own-post checks."),
    /** Display name (first name + last initial or full name per user profile). */
    displayName: z.string().min(1).describe("Author display name for forum attribution."),
    /** Role label for context (e.g. 'Student', 'Faculty', 'Admin'). */
    roleLabel: z.string().describe("Author's role label for display context."),
  })
  .strict();
export type ForumAuthorDto = z.infer<typeof ForumAuthorDtoSchema>;

/**
 * Forum thread summary — returned in GET /forum/threads list.
 *
 * RBAC: `forum.read` (enrolled scope for students — IDOR→404 for non-enrolled, AC-55).
 * The backend filters on `batch_id` enrollment before returning any thread.
 */
export const ThreadDtoSchema = z
  .object({
    id: UuidSchema,
    title: z.string().min(1).max(256).describe("Thread title."),
    status: ThreadStatusSchema,
    /** Whether this thread is pinned (status=pinned or pinned=true). */
    pinned: z.boolean(),
    /**
     * Batch context. Null if the thread is scoped to a program (not a batch).
     * Most threads are batch-scoped (per docs/plans/phase-6.md §2).
     */
    batchId: UuidSchema.nullable().describe("Batch this thread is scoped to. Null = program-scoped."),
    programId: UuidSchema.nullable().describe("Program this thread is scoped to. Null = batch-scoped."),
    author: ForumAuthorDtoSchema,
    /** Total post count (all visible posts in the thread). */
    postCount: z.number().int().min(0).describe("Number of visible posts in this thread."),
    /** ID of the post marked as the resolved answer. Null if not resolved or no answer picked. */
    resolvedPostId: UuidSchema.nullable().describe("The resolved/accepted answer post ID, if any."),
    createdAt: IsoDateTimeSchema,
    /** ISO-8601 datetime of the most recent post in this thread (for sort-by-latest). */
    lastActivityAt: IsoDateTimeSchema.nullable().describe("Most recent post time. Null if no posts."),
  })
  .strict();
export type ThreadDto = z.infer<typeof ThreadDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CreateThreadDto — POST /forum/threads input
// ─────────────────────────────────────────────────────────────────────────

/**
 * Input for POST /api/v1/forum/threads — create a new forum thread.
 *
 * RBAC: `forum.post` (enrolled scope — student MUST be enrolled in the batch, AC-56).
 * The backend checks enrollment for the supplied batchId before creating the thread.
 * A non-enrolled student returns 404 (IDOR-safe, AC-56).
 *
 * At least one of batchId or programId must be provided. batchId is preferred.
 * The first post body is included here (the initial post is created atomically).
 *
 * AC-71: body max 10,000 chars.
 */
export const CreateThreadDtoSchema = z
  .object({
    title: z.string().min(1).max(256).describe("Thread title."),
    /**
     * The body of the initial post (the thread-opening message).
     * Plain text / markdown-ish. Sanitized on render (DOMPurify, AC-70).
     * Max 10,000 chars (AC-71).
     */
    body: z
      .string()
      .min(1, "Body is required (AC: BODY_REQUIRED)")
      .max(10000, "Body too long. Max 10,000 characters (AC-71: BODY_TOO_LONG)")
      .describe("Opening post body. Plain text, max 10,000 chars."),
    /**
     * Batch to scope this thread to. REQUIRED for batch-scoped threads.
     * The backend validates enrollment before accepting this (AC-56).
     */
    batchId: UuidSchema.optional().describe("Batch scope. Student must be enrolled (IDOR→404)."),
    /**
     * Program to scope this thread to. Used for program-level discussions.
     * At least one of batchId or programId must be provided.
     */
    programId: UuidSchema.optional().describe("Program scope. Enrollment verified by the backend."),
  })
  .strict()
  .refine((d) => d.batchId != null || d.programId != null, {
    message: "At least one of batchId or programId must be provided.",
  });
export type CreateThreadDto = z.infer<typeof CreateThreadDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PostDto — forum post / reply
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single forum post (the initial post in a thread or a reply).
 * Returned in GET /forum/threads/:id/posts.
 *
 * `body` is stored as-is; DOMPurify sanitization happens on the CLIENT at render
 * time (AC-70). The backend strips obvious HTML (defense-in-depth), but the
 * rendering layer (LMS/CRM) is responsible for safe insertion into the DOM.
 *
 * `parentId` enables nested replies (one level of nesting in P6; deeper = same model).
 * `upvotes` is a cached count derived from `forum_post_votes`; not directly mutable.
 */
export const PostDtoSchema = z
  .object({
    id: UuidSchema,
    threadId: UuidSchema,
    author: ForumAuthorDtoSchema,
    /**
     * Post body. Plain text / markdown-ish. Stored raw; sanitize with DOMPurify on render.
     * The API returns the stored text; the client MUST sanitize before DOM insertion (AC-70).
     */
    body: z
      .string()
      .describe("Post body. Stored text. DOMPurify MUST be applied before DOM insertion (AC-70)."),
    /** Parent post ID for nested replies. Null = top-level post in the thread. */
    parentId: UuidSchema.nullable().describe("Parent post ID for nested replies. Null = top-level."),
    status: PostStatusSchema,
    /** Cached upvote count (from forum_post_votes). Not directly mutable via this field. */
    upvotes: z.number().int().min(0).describe("Upvote count (cached from forum_post_votes)."),
    /**
     * Whether the authenticated user has upvoted this post.
     * Populated by the backend on read; null if the user is not authenticated or has no vote.
     */
    hasVoted: z.boolean().nullable().describe("Whether the current user has upvoted this post."),
    /**
     * Whether the authenticated user authored this post.
     * Used by the frontend to show/hide edit/delete affordances.
     */
    isOwnPost: z.boolean().describe("True if the authenticated user authored this post."),
    /** Whether this post is the resolved answer in a Q&A thread. */
    isResolved: z.boolean().describe("True if this post is the accepted answer in the thread."),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict();
export type PostDto = z.infer<typeof PostDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CreatePostDto — POST /forum/threads/:id/posts input
// ─────────────────────────────────────────────────────────────────────────

/**
 * Input for POST /api/v1/forum/threads/:id/posts — create a post or reply.
 *
 * RBAC: `forum.post` (enrolled scope — AC-58, AC-59).
 * The thread's batchId is used to verify enrollment; the path threadId
 * is the authoritative scope. A non-enrolled student → 404.
 *
 * `parentId` is optional — omit for a top-level reply, provide for nested reply (AC-59).
 * When provided, the parentId MUST belong to the same thread (cross-thread reply → 404).
 *
 * AC-60: Reply to a thread authored by someone else → NotificationService.notify(author, forum_reply).
 * AC-71: body max 10,000 chars.
 */
export const CreatePostDtoSchema = z
  .object({
    /**
     * Post body. Plain text / markdown-ish. Max 10,000 chars (AC-71).
     * Required — empty body returns 422 BODY_REQUIRED (AC: edge case).
     */
    body: z
      .string()
      .min(1, "Body is required (BODY_REQUIRED)")
      .max(10000, "Body too long. Max 10,000 characters (BODY_TOO_LONG, AC-71)")
      .describe("Post body. Plain text, max 10,000 chars."),
    /**
     * Parent post ID for nested replies (AC-59).
     * Null or omitted = top-level reply to the thread.
     * MUST belong to the same thread — cross-thread parentId → 404.
     */
    parentId: UuidSchema.nullable().optional().describe("Parent post ID for nesting. Null = top-level."),
  })
  .strict();
export type CreatePostDto = z.infer<typeof CreatePostDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// ModerateDto — faculty/admin moderation action input
// ─────────────────────────────────────────────────────────────────────────

/**
 * Input for moderation endpoints.
 *
 * Used by:
 *   POST /forum/threads/:id/moderate   — pin/unpin/resolve/unresolve/delete a thread
 *   POST /forum/posts/:id/moderate     — hide/unhide/delete a post
 *
 * RBAC: `forum.moderate` (assigned scope for faculty → only assigned batches, AC-64).
 * Every moderation action is audit-logged with actor + before/after (AC-65, AC-66).
 * Soft-delete: 'delete' action sets `deleted_at`; the post disappears from student
 * lists but the row is retained for audit (AC-69).
 *
 * `reason` is required when action is 'hide' (AC-65 sets hidden_reason).
 * `reason` is optional for other actions (used for moderation audit notes).
 */
export const ModerateDtoSchema = z
  .object({
    action: ModerateActionSchema.describe("The moderation action to apply."),
    /**
     * Reason for hiding or moderating. REQUIRED when action='hide' (stored as hidden_reason).
     * Optional for other actions (stored in audit log only).
     */
    reason: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe("Reason for the moderation action. Required when action='hide'."),
    /**
     * For 'resolve' action on a thread: the post ID that resolves the question.
     * Stored as forum_threads.resolved_post_id (AC-65 adjacent — resolves a Q&A thread).
     */
    resolvedPostId: UuidSchema.optional().describe("Post ID that resolves the thread (action='resolve' only)."),
  })
  .strict()
  .refine(
    (d) => {
      if (d.action === "hide" && (d.reason == null || d.reason.trim().length === 0)) {
        return false;
      }
      return true;
    },
    { message: "reason is required when action is 'hide'", path: ["reason"] },
  );
export type ModerateDto = z.infer<typeof ModerateDtoSchema>;

/**
 * Response for moderation actions. Returns the updated thread or post state.
 * Minimal — action confirmation + new status.
 */
export const ModerateResponseSchema = z
  .object({
    message: z.string().describe("Confirmation message."),
    /** The new status after the action (for threads: ThreadStatus; for posts: PostStatus). */
    newStatus: z.string().describe("The resource's new status after moderation."),
  })
  .strict();
export type ModerateResponse = z.infer<typeof ModerateResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// VoteDto — upvote toggle input
// ─────────────────────────────────────────────────────────────────────────

/**
 * Input for POST /api/v1/forum/posts/:id/vote — toggle upvote on a post.
 *
 * Deduplication (AC-61): a second vote from the same user toggles off (removes the
 * forum_post_votes row and decrements upvotes). The partial-unique constraint
 * `(post_id, user_id) WHERE deleted_at IS NULL` prevents double-inserts.
 *
 * Self-vote prevention (AC-62): the backend rejects votes on own posts (422 CANNOT_VOTE_OWN_POST).
 *
 * Body is empty — the post ID comes from the path, the user from the session.
 */
export const VoteDtoSchema = z.object({}).strict();
export type VoteDto = z.infer<typeof VoteDtoSchema>;

/**
 * Response for POST /api/v1/forum/posts/:id/vote.
 * Returns the new upvote count and whether the current user has voted.
 */
export const VoteResponseSchema = z
  .object({
    upvotes: z.number().int().min(0).describe("Updated upvote count."),
    hasVoted: z.boolean().describe("Whether the current user now has an active vote on this post."),
  })
  .strict();
export type VoteResponse = z.infer<typeof VoteResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Query params for forum list endpoints
// ─────────────────────────────────────────────────────────────────────────

/**
 * Query params for GET /api/v1/forum/threads.
 * `batchId` is the primary filter — REQUIRED for enrollment-scope enforcement (AC-55).
 * The backend returns 404 if the authenticated user is not enrolled in the specified batch.
 */
export const ListThreadsQuerySchema = z
  .object({
    batchId: UuidSchema.optional().describe("Batch filter. REQUIRED for student access (IDOR→404 if not enrolled)."),
    programId: UuidSchema.optional().describe("Program filter. Alternative to batchId for program-level threads."),
    status: ThreadStatusSchema.optional().describe("Filter by thread status."),
    /** Cursor pagination (same as other list endpoints). */
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListThreadsQuery = z.infer<typeof ListThreadsQuerySchema>;

/**
 * Query params for GET /api/v1/forum/threads/:id/posts.
 * Returns posts in a thread, paginated. Includes nested replies (parent_id set).
 */
export const ListPostsQuerySchema = z
  .object({
    parentId: UuidSchema.optional().describe("Filter by parent post ID for nested-reply subthread view."),
    ...PageQuerySchema.shape,
  })
  .strict();
export type ListPostsQuery = z.infer<typeof ListPostsQuerySchema>;

/**
 * Query params for the CRM moderation report queue.
 * GET /api/v1/crm/forum/moderation — faculty/admin view of flagged posts.
 */
export const ListModerationQueueQuerySchema = z
  .object({
    batchId: UuidSchema.optional().describe("Filter by batch (scope: assigned for faculty)."),
    status: PostStatusSchema.optional().describe("Filter by post status."),
    ...PageQuerySchema.shape,
  })
  .strict();
export type ListModerationQueueQuery = z.infer<typeof ListModerationQueueQuerySchema>;
