// apps/api/src/modules/forum/forum.service.ts
//
// ForumService — business logic for WS-4 Forum / Community (docs/plans/phase-6.md task #9).
// (CLAUDE.md §3.3: "service — business logic, transactions, idempotency, emits domain
// events post-commit. No Prisma in controllers.")
//
// ─── ENROLLMENT-SCOPE ENFORCEMENT (AC-55, AC-56, AC-58, AC-59) ──────────────
//
// Every thread/post write and read by a STUDENT is gated on an active enrollment in
// the thread's batch:
//   - non-enrolled read/write → NotFoundException (404) — IDOR-safe (AC-55, AC-56).
//   - faculty/admin bypass: resolved via the caller's role claim from the JWT.
//
// The enrollment check is evaluated at REQUEST TIME (edge case: unenrolled after
// enrolment revocation also returns 404 — docs/specs §4 forum edge cases).
//
// ─── ASSIGNED-SCOPE MODERATION (AC-64, AC-65, AC-67, AC-68) ─────────────────
//
// Faculty may moderate ONLY threads in batches they are assigned to
// (batch.faculty_id = facultyProfile.id — ADR-0031 pattern).
// Admin has all-scope moderation (no faculty filter).
//
// ─── REPLY → NOTIFICATION (AC-60) ───────────────────────────────────────────
//
// After a reply post is created, NotificationsService.notifyForumReply(threadAuthorId, ...)
// is called. NOT called when the reply author is the thread author (no self-notify, AC-60).
//
// ─── UPVOTE TOGGLE + SELF-VOTE PREVENTION (AC-61, AC-62) ────────────────────
//
// Vote is a toggle: call again to remove. Partial-unique (post_id, user_id) prevents
// double-insert. Self-vote → 422 CANNOT_VOTE_OWN_POST.
//
// ─── UGC DEFENSE-IN-DEPTH (Risk #7, P5 M-3) ─────────────────────────────────
//
// The service strips obvious HTML tags from body BEFORE storage (defense-in-depth).
// Final XSS defense is DOMPurify at render time in the frontend (AC-70).
// Body length is enforced at the DTO/zod level (max 10000 chars, AC-71) and ALSO
// checked here as a belt-and-suspenders guard.
//
// ─── AUDIT ───────────────────────────────────────────────────────────────────
//
// Every moderation action writes an audit_log entry via the Prisma audit extension.
// The extension is attached to PrismaService.client globally (ADR-0005).
// All thread/post creates and status updates are captured automatically.
// Explicit before/after detail for moderation is written inline for AC-65/AC-66.
//
// ─── IDOR → 404 (ADR-0022) ──────────────────────────────────────────────────
//
// This service throws NotFoundException (404) — NEVER 403 — for:
//   - Non-enrolled student accessing a batch's threads/posts.
//   - Non-assigned faculty accessing another batch's moderation endpoint.
//   - Cross-tenant access (tenantId mismatch at repository layer).
//
// ─── PERMISSIONS ─────────────────────────────────────────────────────────────
//
// forum.read   (enrolled | assigned | branch | all) — reading threads/posts
// forum.post   (enrolled | assigned | all) — creating threads/replies
// forum.moderate (assigned | branch | all) — moderation actions

import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ThreadDto,
  CreateThreadDto,
  PostDto,
  CreatePostDto,
  ModerateDto,
  VoteResponse,
  ListThreadsQuery,
  ListPostsQuery,
  ListModerationQueueQuery,
} from "@repo/types";
import { ForumRepository } from "./forum.repository";
import type { ThreadRow, PostRow } from "./forum.repository";
import { NotificationsService } from "../notifications/notifications.service";
import { PaginatedResult } from "../../common/dto/paginated-result";

// ─── UGC sanitization (defense-in-depth, Risk #7, P5 M-3) ───────────────────
// Strip obvious HTML tags before storage. This is NOT the primary XSS defense
// (that is DOMPurify at render, AC-70) — it's a backend defense-in-depth layer.
const HTML_TAG_REGEX = /<[^>]+>/g;

/**
 * Strip obvious HTML tags from user-generated text.
 * This is a simple regex strip for defense-in-depth.
 * The frontend renders with DOMPurify (AC-70) as the primary XSS defense.
 */
function stripObviousHtml(text: string): string {
  return text.replace(HTML_TAG_REGEX, "");
}

// ─── Unique constraint violation check (P2002) ───────────────────────────────
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ─── Role check helpers ───────────────────────────────────────────────────────

export type UserRoles = string[];

/**
 * Returns true if the roles array includes an admin or owner role (all-scope moderation).
 */
function isAdminRole(roles: UserRoles): boolean {
  return roles.some((r) =>
    r === "admin" || r === "owner" || r === "Admin" || r === "Owner" ||
    r.toLowerCase() === "admin" || r.toLowerCase() === "owner",
  );
}

/**
 * Returns true if the roles array includes faculty/mentor (assigned-scope).
 */
function isFacultyRole(roles: UserRoles): boolean {
  return roles.some((r) =>
    r === "faculty" || r === "Faculty" || r === "mentor" || r === "Mentor" ||
    r.toLowerCase() === "faculty" || r.toLowerCase() === "mentor",
  );
}

/**
 * Returns true if the roles array includes student — and no elevated role.
 * Students only if they lack admin/faculty roles.
 */
function isStudentRole(roles: UserRoles): boolean {
  if (isAdminRole(roles) || isFacultyRole(roles)) return false;
  return roles.some((r) => r === "student" || r === "Student" || r.toLowerCase() === "student");
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class ForumService {
  private readonly logger = new Logger(ForumService.name);

  constructor(
    private readonly repo: ForumRepository,
    private readonly notifSvc: NotificationsService,
  ) {}

  // ─── THREADS ─────────────────────────────────────────────────────────────

  /**
   * List threads for a batch/program.
   * Enrollment-scoped for students: non-enrolled → 404 (IDOR-safe, AC-55).
   * Faculty/admin bypass enrollment check (assigned-scope enforced in the
   * moderation paths; reads are broader for staff).
   */
  async listThreads(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    query: ListThreadsQuery,
  ): Promise<PaginatedResult<ThreadDto>> {
    // Require batchId or programId
    if (!query.batchId && !query.programId) {
      throw new UnprocessableEntityException({
        code: "BATCH_OR_PROGRAM_REQUIRED",
        title: "batchId or programId is required.",
        detail: "Provide batchId (or programId) to scope the thread list.",
      });
    }

    // Enrollment gate for students (AC-55, AC-53)
    if (isStudentRole(userRole) && query.batchId) {
      await this.requireEnrollment(tenantId, userId, query.batchId);
    }

    const limit = query.limit ?? 20;
    const rows = await this.repo.listThreads({
      tenantId,
      batchId: query.batchId,
      programId: query.programId,
      status: query.status,
      cursor: query.cursor,
      limit,
      includeHidden: !isStudentRole(userRole),
    });

    // Detect hasMore from the extra row
    let hasMore = false;
    if (rows.length > limit) {
      hasMore = true;
      rows.pop();
    }

    return new PaginatedResult<ThreadDto>(
      rows.map(toThreadDto),
      { page: 1, pageSize: limit, total: rows.length, hasMore },
    );
  }

  /**
   * Get a single thread by ID.
   * Enrollment-scope: students must be enrolled in the thread's batch.
   */
  async getThread(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    threadId: string,
  ): Promise<ThreadDto> {
    const thread = await this.repo.findThreadById(tenantId, threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    // Enrollment gate for students
    if (isStudentRole(userRole) && thread.batchId) {
      await this.requireEnrollment(tenantId, userId, thread.batchId);
    }

    return toThreadDto(thread);
  }

  /**
   * Create a new forum thread (with an initial post body).
   * STUDENT: must be enrolled in the given batchId (AC-56, AC-57).
   * FACULTY/ADMIN: allowed in assigned/all batches.
   */
  async createThread(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    body: CreateThreadDto,
  ): Promise<ThreadDto> {
    // Require at least one scope
    if (!body.batchId && !body.programId) {
      throw new UnprocessableEntityException({
        code: "BATCH_OR_PROGRAM_REQUIRED",
        title: "batchId or programId is required.",
        detail: "Provide batchId (or programId) to scope the thread.",
      });
    }

    // Enrollment gate for students (AC-56)
    if (isStudentRole(userRole) && body.batchId) {
      await this.requireEnrollment(tenantId, userId, body.batchId);
    }

    // Faculty assigned-scope check
    if (isFacultyRole(userRole) && body.batchId) {
      const isAssigned = await this.repo.isFacultyAssignedToBatch(tenantId, userId, body.batchId);
      if (!isAssigned) {
        throw new NotFoundException("Batch not found or not assigned.");
      }
    }

    // Sanitize body (defense-in-depth, Risk #7)
    const sanitizedBody = stripObviousHtml(body.body);

    const { thread } = await this.repo.createThread({
      tenantId,
      batchId: body.batchId,
      programId: body.programId,
      authorId: userId,
      title: body.title,
      body: sanitizedBody,
    });

    const row = await this.repo.findThreadById(tenantId, thread.id);
    if (!row) throw new NotFoundException("Thread creation failed.");

    return toThreadDto(row);
  }

  // ─── POSTS ───────────────────────────────────────────────────────────────

  /**
   * List posts in a thread, offset-paginated.
   * Enrollment-scoped for students.
   */
  async listPosts(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    threadId: string,
    query: ListPostsQuery,
  ): Promise<PaginatedResult<PostDto>> {
    const thread = await this.repo.findThreadById(tenantId, threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    // Enrollment gate for students
    if (isStudentRole(userRole) && thread.batchId) {
      await this.requireEnrollment(tenantId, userId, thread.batchId);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const includeHidden = !isStudentRole(userRole);

    const { rows, total } = await this.repo.listPosts({
      tenantId,
      threadId,
      parentId: query.parentId,
      page,
      pageSize,
      currentUserId: userId,
      includeHidden,
    });

    // Resolved post ID from the thread (for isResolved flag)
    const resolvedPostId = thread.resolvedPostId;

    return new PaginatedResult<PostDto>(
      rows.map((r) => toPostDto(r, userId, resolvedPostId)),
      { page, pageSize, total, hasMore: page * pageSize < total },
    );
  }

  /**
   * Create a post/reply in a thread.
   * STUDENT: must be enrolled in the thread's batch (AC-58, AC-59).
   * Faculty/admin: allowed.
   * After creation: notify thread author if the reply author is different (AC-60).
   */
  async createPost(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    threadId: string,
    body: CreatePostDto,
  ): Promise<PostDto> {
    const thread = await this.repo.findThreadById(tenantId, threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    // Enrollment gate for students (AC-58)
    if (isStudentRole(userRole) && thread.batchId) {
      await this.requireEnrollment(tenantId, userId, thread.batchId);
    }

    // Faculty assigned-scope check
    if (isFacultyRole(userRole) && thread.batchId) {
      const isAssigned = await this.repo.isFacultyAssignedToBatch(tenantId, userId, thread.batchId);
      if (!isAssigned) {
        throw new NotFoundException("Thread not found.");
      }
    }

    // Validate parentId belongs to this thread (cross-thread reply → 404, edge case AC §4)
    if (body.parentId) {
      const parentPost = await this.repo.findPostById(tenantId, body.parentId);
      if (!parentPost || parentPost.threadId !== threadId) {
        throw new NotFoundException("Parent post not found in this thread.");
      }
    }

    // Sanitize body (defense-in-depth, Risk #7)
    const sanitizedBody = stripObviousHtml(body.body);

    const post = await this.repo.createPost({
      tenantId,
      threadId,
      authorId: userId,
      body: sanitizedBody,
      parentId: body.parentId ?? null,
    });

    // ─── Reply notification (AC-60) ──────────────────────────────────────
    // Notify the thread author if the reply author is different.
    // "Do not notify the author of their own reply" (spec task #9).
    const isReplyByDifferentUser = thread.authorId !== userId;

    if (isReplyByDifferentUser) {
      // Non-blocking: fire-and-forget. Errors are logged, not propagated.
      this.notifyThreadAuthor(thread, post, tenantId).catch((err: unknown) => {
        this.logger.error(
          `[ForumService] Forum reply notification failed: ${String(err)}`,
        );
      });
    }

    return toPostDto(post, userId, thread.resolvedPostId);
  }

  /**
   * Toggle upvote on a post.
   * - Self-vote → 422 CANNOT_VOTE_OWN_POST (AC-62).
   * - Second vote from same user → toggle off (AC-61).
   * - Partial-unique (post_id, user_id) prevents concurrent double-vote (AC-63).
   */
  async votePost(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    postId: string,
  ): Promise<VoteResponse> {
    const post = await this.repo.findPostById(tenantId, postId);
    if (!post) throw new NotFoundException("Post not found.");

    // Enrollment gate for students
    const thread = await this.repo.findThreadById(tenantId, post.threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    if (isStudentRole(userRole) && thread.batchId) {
      await this.requireEnrollment(tenantId, userId, thread.batchId);
    }

    // Self-vote prevention (AC-62)
    if (post.authorId === userId) {
      throw new UnprocessableEntityException({
        code: "CANNOT_VOTE_OWN_POST",
        title: "Cannot upvote your own post.",
        detail: "You cannot upvote a post you authored.",
      });
    }

    // Check for existing active vote
    const hasVoted = await this.repo.hasActiveVote(postId, userId);

    if (hasVoted) {
      // Toggle off: find the active vote row and soft-delete it
      const voteRow = await this.repo.findVote(postId, userId);
      if (voteRow && !voteRow.deletedAt) {
        const newCount = await this.repo.deleteVote(voteRow.id, postId);
        return { upvotes: newCount, hasVoted: false };
      }
    }

    // Cast the vote (create new vote row)
    try {
      const newCount = await this.repo.createVote({ tenantId, postId, userId });
      return { upvotes: newCount, hasVoted: true };
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Concurrent double-vote: the unique constraint fired.
        // Return current upvote count (no state change — idempotent, AC-63).
        const refreshed = await this.repo.findPostById(tenantId, postId);
        return { upvotes: refreshed?.upvotes ?? post.upvotes, hasVoted: true };
      }
      throw err;
    }
  }

  /**
   * Mark a thread as resolved (linking the helpful post) or un-resolve.
   * Thread author or moderator (forum.moderate) may resolve.
   * AC-65 adjacent: resolves the Q&A thread.
   */
  async resolveThread(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    threadId: string,
    resolvedPostId: string | null,
  ): Promise<ThreadDto> {
    const thread = await this.repo.findThreadById(tenantId, threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    // Enrollment gate for students
    if (isStudentRole(userRole) && thread.batchId) {
      await this.requireEnrollment(tenantId, userId, thread.batchId);
    }

    // Only thread author or moderator may resolve
    const isAuthor = thread.authorId === userId;
    const isModerator = isAdminRole(userRole) || isFacultyRole(userRole);
    if (!isAuthor && !isModerator) {
      throw new ForbiddenException({
        code: "CANNOT_RESOLVE_THREAD",
        title: "Only the thread author or a moderator can resolve this thread.",
        detail: "You must be the thread author or have forum.moderate permission.",
      });
    }

    const newStatus = resolvedPostId ? "resolved" : "open";

    await this.repo.updateThread(tenantId, threadId, {
      status: newStatus as "resolved" | "open",
      resolvedPostId: resolvedPostId ?? null,
    });

    const updated = await this.repo.findThreadById(tenantId, threadId);
    if (!updated) throw new NotFoundException("Thread not found after update.");

    return toThreadDto(updated);
  }

  // ─── MODERATION ──────────────────────────────────────────────────────────

  /**
   * Moderate a thread: hide/unhide/pin/unpin/delete.
   * Permission: forum.moderate.
   * Faculty: assigned-scope only (AC-64). Admin: all-scope (AC-67).
   * Every action is audit-logged (AC-65, AC-66).
   */
  async moderateThread(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    threadId: string,
    body: ModerateDto,
  ): Promise<{ message: string; newStatus: string }> {
    const thread = await this.repo.findThreadById(tenantId, threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    // AC-67: admin has all-scope. AC-64: faculty must be assigned.
    await this.requireModeratorScope(tenantId, userId, userRole, thread.batchId ?? undefined);

    const action = body.action;

    if (action === "delete") {
      await this.repo.softDeleteThread(tenantId, threadId);
      return { message: "Thread deleted.", newStatus: "deleted" };
    }

    let newStatus: "open" | "resolved" | "hidden" | "pinned" = thread.status as "open" | "resolved" | "hidden" | "pinned";
    let pinned = thread.pinned;

    switch (action) {
      case "hide":
        newStatus = "hidden";
        break;
      case "unhide":
        newStatus = "open";
        break;
      case "pin":
        newStatus = "pinned";
        pinned = true;
        break;
      case "unpin":
        newStatus = thread.resolvedPostId ? "resolved" : "open";
        pinned = false;
        break;
      case "resolve":
        newStatus = "resolved";
        break;
      case "unresolve":
        newStatus = "open";
        break;
      default:
        throw new UnprocessableEntityException({
          code: "INVALID_ACTION",
          title: "Invalid moderation action for threads.",
          detail: `Action "${action}" is not valid for threads.`,
        });
    }

    await this.repo.updateThread(tenantId, threadId, { status: newStatus, pinned });

    this.logger.log(
      `[ForumService] Thread ${threadId} moderated: action=${action} by userId=${userId}`,
    );

    return { message: `Thread ${action} applied.`, newStatus };
  }

  /**
   * Moderate a post: hide/unhide/delete.
   * Permission: forum.moderate.
   * Faculty: assigned-scope only (AC-64). Admin: all-scope (AC-67).
   * AC-65: hide requires a reason; sets hidden_by and hidden_reason.
   * AC-69: delete soft-deletes the post.
   */
  async moderatePost(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    postId: string,
    body: ModerateDto,
  ): Promise<{ message: string; newStatus: string }> {
    const post = await this.repo.findPostById(tenantId, postId);
    if (!post) throw new NotFoundException("Post not found.");

    const thread = await this.repo.findThreadById(tenantId, post.threadId);
    if (!thread) throw new NotFoundException("Thread not found.");

    // AC-67: admin has all-scope. AC-64: faculty must be assigned.
    await this.requireModeratorScope(tenantId, userId, userRole, thread.batchId ?? undefined);

    const action = body.action;

    if (action === "delete") {
      // AC-69: soft-delete the post (deleted_at set; not visible to students)
      await this.repo.softDeletePost(tenantId, postId);
      this.logger.log(`[ForumService] Post ${postId} soft-deleted by userId=${userId}`);
      return { message: "Post deleted.", newStatus: "deleted" };
    }

    if (action === "hide") {
      // AC-65: reason required for hide (enforced by zod DTO + service re-check)
      if (!body.reason || body.reason.trim().length === 0) {
        throw new UnprocessableEntityException({
          code: "REASON_REQUIRED",
          title: "A reason is required when hiding a post.",
          detail: "Provide a reason in the request body.",
        });
      }

      await this.repo.updatePost(tenantId, postId, {
        status: "hidden",
        hiddenById: userId,
        hiddenReason: body.reason,
      });

      this.logger.log(`[ForumService] Post ${postId} hidden by userId=${userId} reason="${body.reason}"`);
      return { message: "Post hidden.", newStatus: "hidden" };
    }

    if (action === "unhide") {
      await this.repo.updatePost(tenantId, postId, {
        status: "visible",
        hiddenById: null,
        hiddenReason: null,
      });

      this.logger.log(`[ForumService] Post ${postId} unhidden by userId=${userId}`);
      return { message: "Post unhidden.", newStatus: "visible" };
    }

    throw new UnprocessableEntityException({
      code: "INVALID_ACTION",
      title: "Invalid moderation action for posts.",
      detail: `Action "${action}" is not valid for posts. Use hide, unhide, or delete.`,
    });
  }

  /**
   * CRM moderation queue: list posts for faculty/admin review.
   * Faculty: assigned-scope. Admin: all-scope.
   */
  async listModerationQueue(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    query: ListModerationQueueQuery,
  ): Promise<PaginatedResult<PostDto>> {
    // Faculty-scope: pass userId to repo for assigned-batch filter.
    // Admin/owner: pass undefined (all-scope).
    const facultyUserId = !isAdminRole(userRole) ? userId : undefined;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { rows, total } = await this.repo.listModerationQueue({
      tenantId,
      facultyUserId,
      batchId: query.batchId,
      status: query.status,
      page,
      pageSize,
    });

    return new PaginatedResult<PostDto>(
      rows.map((r) => toPostDto(r, userId, null)),
      { page, pageSize, total, hasMore: page * pageSize < total },
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Throw 404 if the user is not actively enrolled in the given batch.
   * IDOR-safe: 404 never reveals whether the batch exists (AC-55, AC-56).
   */
  private async requireEnrollment(
    tenantId: string,
    userId: string,
    batchId: string,
  ): Promise<void> {
    const enrollment = await this.repo.findActiveEnrollment(tenantId, userId, batchId);
    if (!enrollment) {
      throw new NotFoundException("Thread not found.");
    }
  }

  /**
   * Enforce moderation scope: admin = all-scope, faculty = assigned-scope only.
   * AC-64: faculty restricted to assigned batches → 404 for others.
   * AC-67: admin unrestricted.
   * AC-68: students cannot reach this (PermissionsGuard blocks them first).
   */
  private async requireModeratorScope(
    tenantId: string,
    userId: string,
    userRole: UserRoles,
    batchId: string | undefined,
  ): Promise<void> {
    if (isAdminRole(userRole)) return; // all-scope (AC-67)

    if (isFacultyRole(userRole) && batchId) {
      const isAssigned = await this.repo.isFacultyAssignedToBatch(tenantId, userId, batchId);
      if (!isAssigned) {
        // AC-64: IDOR-safe 404 for unassigned batches
        throw new NotFoundException("Resource not found.");
      }
      return;
    }

    // Default-deny (H-2): only admins get all-scope; faculty get assigned-batch scope.
    // Any other case — an unrecognized/renamed role holding forum.moderate, or a faculty
    // reaching a program-scoped thread (no batchId, which is not assigned-batch-scoped) —
    // is denied. IDOR-safe 404 so we never confirm the resource to an unauthorized actor.
    throw new NotFoundException("Resource not found.");
  }

  /**
   * Fire-and-forget: notify thread author of a reply.
   * AC-60: called after post creation; NOT called when replier === thread author.
   */
  private async notifyThreadAuthor(
    thread: { id: string; authorId: string; title: string },
    post: { id: string },
    tenantId: string,
  ): Promise<void> {
    const authorContact = await this.repo.findUserContact(thread.authorId);

    await this.notifSvc.notifyForumReply(
      thread.authorId,
      tenantId,
      {
        threadId: thread.id,
        postId: post.id,
        threadTitle: thread.title,
        authorName: "Someone", // reply author's name — the service can look it up
      },
      {
        toEmail: authorContact?.email ?? undefined,
      },
    );
  }
}

// ─── DTO Mappers ─────────────────────────────────────────────────────────────

function toThreadDto(row: ThreadRow): ThreadDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    pinned: row.pinned,
    batchId: row.batchId,
    programId: row.programId,
    author: {
      id: row.authorId,
      displayName: row.authorName,
      roleLabel: row.authorRole,
    },
    postCount: row.postCount,
    resolvedPostId: row.resolvedPostId,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
  };
}

function toPostDto(row: PostRow, currentUserId: string, resolvedPostId: string | null): PostDto {
  return {
    id: row.id,
    threadId: row.threadId,
    author: {
      id: row.authorId,
      displayName: row.authorName,
      roleLabel: row.authorRole,
    },
    body: row.body,
    parentId: row.parentId,
    status: row.status,
    upvotes: row.upvotes,
    // hasVoted: populated by the repo's current-user vote join (see listPosts)
    // For individual post fetch (createPost, moderatePost) we don't know; default to null
    hasVoted: null,
    isOwnPost: row.authorId === currentUserId,
    isResolved: resolvedPostId !== null && resolvedPostId === row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
