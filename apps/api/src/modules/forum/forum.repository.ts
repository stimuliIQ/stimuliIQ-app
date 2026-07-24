// apps/api/src/modules/forum/forum.repository.ts
//
// Prisma data-access layer for the ForumModule (WS-4, docs/plans/phase-6.md task #9).
// (CLAUDE.md §3.3: "repository — Prisma data access only, applies soft-delete +
// data-scope filters (all|branch|assigned|own). No business logic.")
//
// SECURITY INVARIANTS (mirrored in service):
//   1. ALL queries carry tenantId — cross-tenant returns empty/null → NotFoundException.
//   2. Enrollment-scope: student threads/posts are only visible/writable when the
//      calling user has an active enrollment in the thread's batch (AC-53..AC-59).
//   3. Assigned-scope: moderation queries for faculty include a batch.faculty_id check
//      (ADR-0031 pattern — AC-64). Admin gets all-scope (no faculty filter).
//   4. Soft-delete: deletedAt=null filter applied on every query (Prisma extension +
//      explicit check where needed on nested relations).
//   5. No business logic: enrollment check, self-vote check, and audit writes live in
//      the service layer. The repo only fetches and persists.
//
// USER MODEL NOTES:
//   - User.name (single field, not firstName/lastName)
//   - User.userRoles -> UserRole -> Role.key (not a direct 'roles' relation)
//   - All author selects use: { name: true, userRoles: { select: { role: { select: { key: true } } }, take: 1 } }
//
// IDEMPOTENCY BACKBONE (AC-61, AC-63):
//   forum_post_votes has a partial-unique (post_id, user_id) WHERE deleted_at IS NULL.
//   A duplicate insert → Prisma P2002; the service treats this as a "toggle-off" (AC-61).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { ThreadStatus, PostStatus } from "@prisma/client";

// ─── Repository row types (contracts for the service layer) ──────────────────

export interface ThreadRow {
  id: string;
  tenantId: string;
  batchId: string | null;
  programId: string | null;
  authorId: string;
  authorName: string;
  authorRole: string;
  title: string;
  status: ThreadStatus;
  pinned: boolean;
  resolvedPostId: string | null;
  postCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PostRow {
  id: string;
  tenantId: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  parentId: string | null;
  upvotes: number;
  status: PostStatus;
  hiddenById: string | null;
  hiddenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VoteRow {
  id: string;
  postId: string;
  userId: string;
  deletedAt: Date | null;
}

export interface EnrollmentCheckRow {
  id: string;
  studentId: string;
  batchId: string;
  status: string;
}

// ─── Author select helper ─────────────────────────────────────────────────────

/** The Prisma nested select for an author's display name + role label. */
const AUTHOR_SELECT = {
  id: true,
  name: true,
  userRoles: {
    select: {
      role: {
        select: { key: true },
      },
    },
    take: 1,
    where: { deletedAt: null },
  },
} as const;

type AuthorResult = {
  id: string;
  name: string;
  userRoles: { role: { key: string } }[];
};

function resolveAuthorName(author: AuthorResult): string {
  return author.name || "Unknown";
}

function resolveAuthorRole(author: AuthorResult): string {
  return author.userRoles[0]?.role.key ?? "student";
}

// ─── Repository ───────────────────────────────────────────────────────────────

@Injectable()
export class ForumRepository {
  // Expose prisma client for advanced queries from the service (kept typed).
  readonly prisma: PrismaService;

  constructor(prismaService: PrismaService) {
    this.prisma = prismaService;
  }

  // ─── Enrollment + scope checks ──────────────────────────────────────────────

  /**
   * Check if a student (by userId) is enrolled in a batch.
   * Returns the enrollment row if active, null otherwise.
   * Used to enforce IDOR→404 for non-enrolled students (AC-55, AC-56).
   */
  async findActiveEnrollment(
    tenantId: string,
    userId: string,
    batchId: string,
  ): Promise<EnrollmentCheckRow | null> {
    // Find the student profile first (userId → studentId)
    const studentProfile = await this.prisma.client.studentProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!studentProfile) return null;

    const enrollment = await this.prisma.client.enrollment.findFirst({
      where: {
        tenantId,
        studentId: studentProfile.id,
        batchId,
        deletedAt: null,
        status: { in: ["active", "completed"] },
      },
      select: { id: true, studentId: true, batchId: true, status: true },
    });
    return enrollment;
  }

  /**
   * Check if a user has a FacultyProfile assigned to the given batch.
   * Used for assigned-scope moderation (ADR-0031 pattern, AC-64).
   * Returns true if the faculty is assigned to the batch (via batch.faculty_id).
   */
  async isFacultyAssignedToBatch(
    tenantId: string,
    userId: string,
    batchId: string,
  ): Promise<boolean> {
    const facultyProfile = await this.prisma.client.facultyProfile.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!facultyProfile) return false;

    const batch = await this.prisma.client.batch.findFirst({
      where: {
        id: batchId,
        tenantId,
        facultyId: facultyProfile.id,
        deletedAt: null,
      },
      select: { id: true },
    });
    return batch !== null;
  }

  // ─── Thread queries ──────────────────────────────────────────────────────────

  /**
   * List threads for a batch (or program), ordered by pinned first, then updatedAt desc.
   * Cursor-paginated. Only non-deleted, non-hidden threads for student scope.
   * Moderators (admin/faculty) may pass includeHidden=true to see hidden threads.
   */
  async listThreads(opts: {
    tenantId: string;
    batchId?: string;
    programId?: string;
    status?: ThreadStatus;
    cursor?: string;
    limit: number;
    includeHidden?: boolean;
  }): Promise<ThreadRow[]> {
    const { tenantId, batchId, programId, status, cursor, limit, includeHidden } = opts;

    // Status filter: students see only open/resolved/pinned (not hidden by default)
    const statusFilter: Record<string, unknown> = status
      ? { status }
      : includeHidden
        ? {}
        : { status: { in: ["open", "resolved", "pinned"] as ThreadStatus[] } };

    const rows = await this.prisma.client.forumThread.findMany({
      where: {
        tenantId,
        ...(batchId ? { batchId } : {}),
        ...(programId ? { programId } : {}),
        ...statusFilter,
        deletedAt: null,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: [
        { pinned: "desc" },
        { updatedAt: "desc" },
      ],
      take: limit + 1, // fetch one extra to detect hasMore
      select: {
        id: true,
        tenantId: true,
        batchId: true,
        programId: true,
        authorId: true,
        title: true,
        status: true,
        pinned: true,
        resolvedPostId: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: AUTHOR_SELECT,
        },
        posts: {
          where: { deletedAt: null, status: "visible" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
        _count: {
          select: {
            posts: { where: { deletedAt: null, status: "visible" } },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      batchId: r.batchId,
      programId: r.programId,
      authorId: r.authorId,
      authorName: resolveAuthorName(r.author),
      authorRole: resolveAuthorRole(r.author),
      title: r.title,
      status: r.status,
      pinned: r.pinned,
      resolvedPostId: r.resolvedPostId,
      postCount: r._count.posts,
      lastActivityAt: r.posts[0]?.createdAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Find a single thread by ID.
   * Returns null if not found or soft-deleted.
   */
  async findThreadById(tenantId: string, threadId: string): Promise<ThreadRow | null> {
    const r = await this.prisma.client.forumThread.findFirst({
      where: { id: threadId, tenantId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        batchId: true,
        programId: true,
        authorId: true,
        title: true,
        status: true,
        pinned: true,
        resolvedPostId: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: AUTHOR_SELECT,
        },
        posts: {
          where: { deletedAt: null, status: "visible" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
        _count: {
          select: {
            posts: { where: { deletedAt: null, status: "visible" } },
          },
        },
      },
    });

    if (!r) return null;

    return {
      id: r.id,
      tenantId: r.tenantId,
      batchId: r.batchId,
      programId: r.programId,
      authorId: r.authorId,
      authorName: resolveAuthorName(r.author),
      authorRole: resolveAuthorRole(r.author),
      title: r.title,
      status: r.status,
      pinned: r.pinned,
      resolvedPostId: r.resolvedPostId,
      postCount: r._count.posts,
      lastActivityAt: r.posts[0]?.createdAt ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * Create a new forum thread (atomically with the first post in a transaction).
   */
  async createThread(input: {
    tenantId: string;
    batchId?: string;
    programId?: string;
    authorId: string;
    title: string;
    body: string; // first post body
  }): Promise<{ thread: { id: string }; post: { id: string } }> {
    return this.prisma.client.$transaction(async (tx) => {
      const thread = await tx.forumThread.create({
        data: {
          tenantId: input.tenantId,
          batchId: input.batchId ?? null,
          programId: input.programId ?? null,
          authorId: input.authorId,
          title: input.title,
          status: "open",
          pinned: false,
        },
        select: { id: true },
      });

      const post = await tx.forumPost.create({
        data: {
          tenantId: input.tenantId,
          threadId: thread.id,
          authorId: input.authorId,
          body: input.body,
          parentId: null,
          upvotes: 0,
          status: "visible",
        },
        select: { id: true },
      });

      return { thread, post };
    });
  }

  /**
   * Update thread status/pinned/resolvedPostId for moderation.
   */
  async updateThread(
    tenantId: string,
    threadId: string,
    data: Partial<{ status: ThreadStatus; pinned: boolean; resolvedPostId: string | null }>,
  ): Promise<{ id: string; status: ThreadStatus; pinned: boolean }> {
    return this.prisma.client.forumThread.update({
      where: { id: threadId, tenantId },
      data,
      select: { id: true, status: true, pinned: true },
    });
  }

  /**
   * Soft-delete a thread (sets deletedAt).
   */
  async softDeleteThread(tenantId: string, threadId: string): Promise<void> {
    await this.prisma.client.forumThread.update({
      where: { id: threadId, tenantId },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Post queries ────────────────────────────────────────────────────────────

  /**
   * List posts in a thread, offset-paginated.
   * Only visible + non-deleted posts for student scope.
   * Optionally filter by parentId for nested replies.
   */
  async listPosts(opts: {
    tenantId: string;
    threadId: string;
    parentId?: string;
    page: number;
    pageSize: number;
    currentUserId: string;
    includeHidden?: boolean;
  }): Promise<{ rows: PostRow[]; total: number }> {
    const { tenantId, threadId, parentId, page, pageSize, currentUserId, includeHidden } = opts;

    const where = {
      tenantId,
      threadId,
      deletedAt: null,
      ...(parentId !== undefined ? { parentId } : {}),
      ...(includeHidden ? {} : { status: "visible" as PostStatus }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.forumPost.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          tenantId: true,
          threadId: true,
          authorId: true,
          body: true,
          parentId: true,
          upvotes: true,
          status: true,
          hiddenById: true,
          hiddenReason: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: AUTHOR_SELECT,
          },
          votes: {
            where: { userId: currentUserId, deletedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.client.forumPost.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        threadId: r.threadId,
        authorId: r.authorId,
        authorName: resolveAuthorName(r.author),
        authorRole: resolveAuthorRole(r.author),
        body: r.body,
        parentId: r.parentId,
        upvotes: r.upvotes,
        status: r.status,
        hiddenById: r.hiddenById,
        hiddenReason: r.hiddenReason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total,
    };
  }

  /**
   * Find a single post by ID.
   * Returns null if not found or soft-deleted.
   */
  async findPostById(tenantId: string, postId: string): Promise<PostRow | null> {
    const r = await this.prisma.client.forumPost.findFirst({
      where: { id: postId, tenantId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        threadId: true,
        authorId: true,
        body: true,
        parentId: true,
        upvotes: true,
        status: true,
        hiddenById: true,
        hiddenReason: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: AUTHOR_SELECT,
        },
      },
    });

    if (!r) return null;

    return {
      id: r.id,
      tenantId: r.tenantId,
      threadId: r.threadId,
      authorId: r.authorId,
      authorName: resolveAuthorName(r.author),
      authorRole: resolveAuthorRole(r.author),
      body: r.body,
      parentId: r.parentId,
      upvotes: r.upvotes,
      status: r.status,
      hiddenById: r.hiddenById,
      hiddenReason: r.hiddenReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * Create a new forum post (reply).
   */
  async createPost(input: {
    tenantId: string;
    threadId: string;
    authorId: string;
    body: string;
    parentId?: string | null;
  }): Promise<PostRow> {
    const r = await this.prisma.client.forumPost.create({
      data: {
        tenantId: input.tenantId,
        threadId: input.threadId,
        authorId: input.authorId,
        body: input.body,
        parentId: input.parentId ?? null,
        upvotes: 0,
        status: "visible",
      },
      select: {
        id: true,
        tenantId: true,
        threadId: true,
        authorId: true,
        body: true,
        parentId: true,
        upvotes: true,
        status: true,
        hiddenById: true,
        hiddenReason: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: AUTHOR_SELECT,
        },
      },
    });

    return {
      id: r.id,
      tenantId: r.tenantId,
      threadId: r.threadId,
      authorId: r.authorId,
      authorName: resolveAuthorName(r.author),
      authorRole: resolveAuthorRole(r.author),
      body: r.body,
      parentId: r.parentId,
      upvotes: r.upvotes,
      status: r.status,
      hiddenById: r.hiddenById,
      hiddenReason: r.hiddenReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /**
   * Update a post's status/hiddenBy/hiddenReason for moderation.
   */
  async updatePost(
    tenantId: string,
    postId: string,
    data: Partial<{
      status: PostStatus;
      hiddenById: string | null;
      hiddenReason: string | null;
    }>,
  ): Promise<{ id: string; status: PostStatus }> {
    return this.prisma.client.forumPost.update({
      where: { id: postId, tenantId },
      data,
      select: { id: true, status: true },
    });
  }

  /**
   * Soft-delete a post (sets deletedAt).
   */
  async softDeletePost(tenantId: string, postId: string): Promise<void> {
    await this.prisma.client.forumPost.update({
      where: { id: postId, tenantId },
      data: { deletedAt: new Date() },
    });
  }

  // ─── Vote queries ─────────────────────────────────────────────────────────────

  /**
   * Find an existing vote row for (postId, userId).
   * Returns the vote row (including deletedAt) if it exists.
   * Used to determine whether the user has upvoted (toggle logic in service).
   */
  async findVote(postId: string, userId: string): Promise<VoteRow | null> {
    // Find the most recent vote row regardless of deletedAt — service decides toggle.
    const row = await this.prisma.client.forumPostVote.findFirst({
      where: { postId, userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, postId: true, userId: true, deletedAt: true },
    });
    return row;
  }

  /**
   * Insert a new vote row and increment the post's upvotes.
   * Returns the new upvote count.
   * The partial-unique index (post_id, user_id) WHERE deleted_at IS NULL prevents
   * concurrent double-votes (P2002 → service swallows as toggle-toggle no-op).
   */
  async createVote(input: {
    tenantId: string;
    postId: string;
    userId: string;
  }): Promise<number> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.forumPostVote.create({
        data: {
          tenantId: input.tenantId,
          postId: input.postId,
          userId: input.userId,
        },
      });

      const updated = await tx.forumPost.update({
        where: { id: input.postId },
        data: { upvotes: { increment: 1 } },
        select: { upvotes: true },
      });
      return updated.upvotes;
    });
  }

  /**
   * Soft-delete the vote row (toggle off) and decrement upvotes.
   * Returns the new upvote count.
   */
  async deleteVote(voteId: string, postId: string): Promise<number> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.forumPostVote.update({
        where: { id: voteId },
        data: { deletedAt: new Date() },
      });

      const updated = await tx.forumPost.update({
        where: { id: postId },
        data: { upvotes: { decrement: 1 } },
        select: { upvotes: true },
      });

      // Clamp to 0 (guard against race conditions)
      return Math.max(0, updated.upvotes);
    });
  }

  /**
   * Check if a user has an ACTIVE (non-deleted) vote on a post.
   */
  async hasActiveVote(postId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.client.forumPostVote.count({
      where: { postId, userId, deletedAt: null },
    });
    return count > 0;
  }

  // ─── Moderation queue ────────────────────────────────────────────────────────

  /**
   * List posts for the CRM moderation queue.
   * faculty assigned-scope: filter to batches where batch.facultyId matches this faculty.
   * admin all-scope: no faculty filter.
   */
  async listModerationQueue(opts: {
    tenantId: string;
    facultyUserId?: string; // if set: assigned-scope (only their batches)
    batchId?: string;
    status?: PostStatus;
    page: number;
    pageSize: number;
  }): Promise<{ rows: PostRow[]; total: number }> {
    const { tenantId, facultyUserId, batchId, status, page, pageSize } = opts;

    // Resolve faculty profile id if assigned-scope
    let facultyBatchIds: string[] | undefined;
    if (facultyUserId) {
      const fp = await this.prisma.client.facultyProfile.findFirst({
        where: { tenantId, userId: facultyUserId, deletedAt: null },
        select: { id: true },
      });
      if (fp) {
        const batches = await this.prisma.client.batch.findMany({
          where: { tenantId, facultyId: fp.id, deletedAt: null },
          select: { id: true },
        });
        facultyBatchIds = batches.map((b) => b.id);
      } else {
        facultyBatchIds = []; // no faculty profile = no batches accessible
      }
    }

    // Build the thread-scope filter for the post join
    const threadFilter: Record<string, unknown> = { tenantId, deletedAt: null };
    if (batchId) {
      threadFilter["batchId"] = batchId;
    } else if (facultyBatchIds) {
      threadFilter["batchId"] = { in: facultyBatchIds };
    }

    const where = {
      tenantId,
      deletedAt: null,
      ...(status ? { status } : {}),
      thread: threadFilter,
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.forumPost.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          tenantId: true,
          threadId: true,
          authorId: true,
          body: true,
          parentId: true,
          upvotes: true,
          status: true,
          hiddenById: true,
          hiddenReason: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: AUTHOR_SELECT,
          },
        },
      }),
      this.prisma.client.forumPost.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        threadId: r.threadId,
        authorId: r.authorId,
        authorName: resolveAuthorName(r.author),
        authorRole: resolveAuthorRole(r.author),
        body: r.body,
        parentId: r.parentId,
        upvotes: r.upvotes,
        status: r.status,
        hiddenById: r.hiddenById,
        hiddenReason: r.hiddenReason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      total,
    };
  }

  // ─── User lookup (for notifications) ────────────────────────────────────────

  /**
   * Resolve a user's email and name by userId.
   * Used when building the forum_reply notification payload.
   */
  async findUserContact(userId: string): Promise<{ email: string | null; name: string | null } | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, name: true },
    });
    return user;
  }
}
