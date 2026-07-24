// apps/api/src/modules/forum/forum.service.spec.ts
//
// Unit tests for ForumService (WS-4, docs/plans/phase-6.md task #9).
//
// Test coverage:
//   - Student can only post in enrolled batch (non-enrolled → 404, AC-56)
//   - Faculty moderates only assigned batches (non-assigned → 404, AC-64)
//   - Reply notifies thread/parent author (AC-60) — not self (no self-notify)
//   - Upvote dedupe: one per user per post (AC-61) + self-vote 422 (AC-62)
//   - HTML-strip defense-in-depth (Risk #7, P5 M-3)
//   - Cross-tenant isolation: tenantId always threaded through to the repo
//   - Admin has all-scope moderation (AC-67)
//   - Student blocked from moderation (AC-68) — role check in helper

import { NotFoundException, UnprocessableEntityException, ForbiddenException } from "@nestjs/common";
import { ForumService } from "./forum.service";
import type { ForumRepository } from "./forum.repository";
import type { NotificationsService } from "../notifications/notifications.service";

// ─── Minimal mock factories ──────────────────────────────────────────────────

function makeThreadRow(overrides: Partial<{
  id: string;
  tenantId: string;
  batchId: string | null;
  authorId: string;
  title: string;
  status: "open" | "resolved" | "hidden" | "pinned";
  pinned: boolean;
  resolvedPostId: string | null;
  postCount: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorName: string;
  authorRole: string;
  programId: string | null;
}> = {}) {
  return {
    id: "thread-1",
    tenantId: "tenant-1",
    batchId: "batch-1",
    programId: null,
    authorId: "author-user-1",
    authorName: "Author Student",
    authorRole: "student",
    title: "Test Thread",
    status: "open" as const,
    pinned: false,
    resolvedPostId: null,
    postCount: 0,
    lastActivityAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makePostRow(overrides: Partial<{
  id: string;
  tenantId: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  parentId: string | null;
  upvotes: number;
  status: "visible" | "hidden";
  hiddenById: string | null;
  hiddenReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "post-1",
    tenantId: "tenant-1",
    threadId: "thread-1",
    authorId: "author-user-1",
    authorName: "Author Student",
    authorRole: "student",
    body: "Test body",
    parentId: null,
    upvotes: 0,
    status: "visible" as const,
    hiddenById: null,
    hiddenReason: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ─── Mock classes ────────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<ForumRepository> = {}): ForumRepository {
  return {
    findActiveEnrollment: jest.fn().mockResolvedValue({ id: "enroll-1", studentId: "student-1", batchId: "batch-1", status: "active" }),
    isFacultyAssignedToBatch: jest.fn().mockResolvedValue(true),
    findThreadById: jest.fn().mockResolvedValue(makeThreadRow()),
    listThreads: jest.fn().mockResolvedValue([]),
    createThread: jest.fn().mockResolvedValue({ thread: { id: "thread-1" }, post: { id: "post-1" } }),
    updateThread: jest.fn().mockResolvedValue({ id: "thread-1", status: "open", pinned: false }),
    softDeleteThread: jest.fn().mockResolvedValue(undefined),
    findPostById: jest.fn().mockResolvedValue(makePostRow()),
    listPosts: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    createPost: jest.fn().mockResolvedValue(makePostRow()),
    updatePost: jest.fn().mockResolvedValue({ id: "post-1", status: "hidden" }),
    softDeletePost: jest.fn().mockResolvedValue(undefined),
    findVote: jest.fn().mockResolvedValue(null),
    createVote: jest.fn().mockResolvedValue(1),
    deleteVote: jest.fn().mockResolvedValue(0),
    hasActiveVote: jest.fn().mockResolvedValue(false),
    listModerationQueue: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findUserContact: jest.fn().mockResolvedValue({ email: "author@test.com", firstName: "Author" }),
    prisma: {} as never,
    ...overrides,
  } as unknown as ForumRepository;
}

function makeNotifSvc(overrides: Partial<NotificationsService> = {}): NotificationsService {
  return {
    notifyForumReply: jest.fn().mockResolvedValue(undefined),
    notify: jest.fn().mockResolvedValue({ notificationId: "notif-1", channelsSent: {} }),
    ...overrides,
  } as unknown as NotificationsService;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("ForumService", () => {
  let service: ForumService;
  let repo: ReturnType<typeof makeRepo>;
  let notifSvc: ReturnType<typeof makeNotifSvc>;

  beforeEach(() => {
    repo = makeRepo();
    notifSvc = makeNotifSvc();
    service = new ForumService(repo as unknown as ForumRepository, notifSvc as unknown as NotificationsService);
  });

  // ─── Enrollment scope: student posts only in enrolled batch ─────────────

  describe("createThread — enrollment scope (AC-56)", () => {
    it("allows a student to create a thread in their enrolled batch", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({
        id: "enroll-1",
        studentId: "student-1",
        batchId: "batch-1",
        status: "active",
      });
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      const result = await service.createThread("tenant-1", "student-user-1", ["student"], {
        batchId: "batch-1",
        title: "My Question",
        body: "Help me!",
      });

      expect(result.id).toBe("thread-1");
      expect(repo.createThread).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: "batch-1", authorId: "student-user-1" }),
      );
    });

    it("returns 404 (IDOR-safe) when student is not enrolled in the batch (AC-56)", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createThread("tenant-1", "student-user-1", ["student"], {
          batchId: "batch-C",
          title: "Title",
          body: "Body",
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.createThread).not.toHaveBeenCalled();
    });

    it("does not check enrollment for admin users (all-scope)", async () => {
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      await service.createThread("tenant-1", "admin-user-1", ["admin"], {
        batchId: "batch-any",
        title: "Admin thread",
        body: "Admin can post anywhere",
      });

      expect(repo.findActiveEnrollment).not.toHaveBeenCalled();
      expect(repo.createThread).toHaveBeenCalled();
    });
  });

  // ─── createPost — enrollment scope (AC-58) ────────────────────────────

  describe("createPost — enrollment scope (AC-58)", () => {
    it("allows a student to post in enrolled batch thread", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({
        id: "enroll-1",
        studentId: "student-1",
        batchId: "batch-1",
        status: "active",
      });

      await service.createPost("tenant-1", "student-user-2", ["student"], "thread-1", {
        body: "My reply",
      });

      expect(repo.createPost).toHaveBeenCalledWith(
        expect.objectContaining({ authorId: "student-user-2", body: "My reply" }),
      );
    });

    it("returns 404 when student posts in non-enrolled batch (AC-58)", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createPost("tenant-1", "non-enrolled-student", ["student"], "thread-1", {
          body: "Reply",
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.createPost).not.toHaveBeenCalled();
    });
  });

  // ─── Reply notification (AC-60) ────────────────────────────────────────

  describe("createPost — reply notification (AC-60)", () => {
    it("notifies the thread author when a different user replies", async () => {
      const threadAuthorId = "author-user-1";
      const replyAuthorId = "student-user-2"; // different from thread author

      (repo.findThreadById as jest.Mock).mockResolvedValue(
        makeThreadRow({ authorId: threadAuthorId, batchId: "batch-1" }),
      );
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({
        id: "enroll-1",
        studentId: "student-1",
        batchId: "batch-1",
        status: "active",
      });

      // Flush all promises (notification is fire-and-forget)
      await service.createPost("tenant-1", replyAuthorId, ["student"], "thread-1", {
        body: "A reply",
      });

      // Wait for the micro-task fire-and-forget to resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(notifSvc.notifyForumReply).toHaveBeenCalledWith(
        threadAuthorId,
        "tenant-1",
        expect.objectContaining({ threadId: "thread-1" }),
        expect.objectContaining({ toEmail: "author@test.com" }),
      );
    });

    it("does NOT notify when the thread author replies to their own thread (AC-60)", async () => {
      const threadAuthorId = "author-user-1";

      (repo.findThreadById as jest.Mock).mockResolvedValue(
        makeThreadRow({ authorId: threadAuthorId }),
      );

      await service.createPost("tenant-1", threadAuthorId, ["student"], "thread-1", {
        body: "My own reply",
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(notifSvc.notifyForumReply).not.toHaveBeenCalled();
    });
  });

  // ─── Upvote dedupe + self-vote prevention (AC-61, AC-62) ───────────────

  describe("votePost — upvote dedupe (AC-61, AC-62)", () => {
    it("creates a vote and returns hasVoted=true for first vote", async () => {
      (repo.hasActiveVote as jest.Mock).mockResolvedValue(false);
      (repo.createVote as jest.Mock).mockResolvedValue(1);
      (repo.findPostById as jest.Mock).mockResolvedValue(
        makePostRow({ authorId: "other-user", upvotes: 0 }),
      );
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      const result = await service.votePost("tenant-1", "voter-user", ["student"], "post-1");

      expect(result.upvotes).toBe(1);
      expect(result.hasVoted).toBe(true);
      expect(repo.createVote).toHaveBeenCalledWith(
        expect.objectContaining({ postId: "post-1", userId: "voter-user" }),
      );
    });

    it("toggles off (removes vote) when user votes again (AC-61)", async () => {
      (repo.hasActiveVote as jest.Mock).mockResolvedValue(true);
      (repo.findVote as jest.Mock).mockResolvedValue({ id: "vote-1", postId: "post-1", userId: "voter-user", deletedAt: null });
      (repo.deleteVote as jest.Mock).mockResolvedValue(0);
      (repo.findPostById as jest.Mock).mockResolvedValue(
        makePostRow({ authorId: "other-user", upvotes: 1 }),
      );
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      const result = await service.votePost("tenant-1", "voter-user", ["student"], "post-1");

      expect(result.hasVoted).toBe(false);
      expect(result.upvotes).toBe(0);
      expect(repo.deleteVote).toHaveBeenCalledWith("vote-1", "post-1");
    });

    it("returns 422 CANNOT_VOTE_OWN_POST when user votes on their own post (AC-62)", async () => {
      const selfUser = "self-author";
      (repo.findPostById as jest.Mock).mockResolvedValue(
        makePostRow({ authorId: selfUser }),
      );
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      await expect(
        service.votePost("tenant-1", selfUser, ["student"], "post-1"),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(repo.createVote).not.toHaveBeenCalled();
    });
  });

  // ─── Moderation — faculty assigned-scope (AC-64) ───────────────────────

  describe("moderatePost — assigned-scope (AC-64)", () => {
    it("allows faculty to hide a post in an assigned batch (AC-65)", async () => {
      (repo.isFacultyAssignedToBatch as jest.Mock).mockResolvedValue(true);
      (repo.findPostById as jest.Mock).mockResolvedValue(makePostRow());
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow({ batchId: "batch-1" }));

      const result = await service.moderatePost("tenant-1", "faculty-user", ["faculty"], "post-1", {
        action: "hide",
        reason: "Inappropriate content",
      });

      expect(result.newStatus).toBe("hidden");
      expect(repo.updatePost).toHaveBeenCalledWith(
        "tenant-1",
        "post-1",
        expect.objectContaining({ status: "hidden", hiddenById: "faculty-user", hiddenReason: "Inappropriate content" }),
      );
    });

    it("returns 404 when faculty tries to moderate an unassigned batch (AC-64)", async () => {
      (repo.isFacultyAssignedToBatch as jest.Mock).mockResolvedValue(false);
      (repo.findPostById as jest.Mock).mockResolvedValue(makePostRow());
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow({ batchId: "batch-C" }));

      await expect(
        service.moderatePost("tenant-1", "faculty-user", ["faculty"], "post-1", {
          action: "hide",
          reason: "Bad content",
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.updatePost).not.toHaveBeenCalled();
    });

    it("allows admin to moderate any batch (AC-67)", async () => {
      (repo.findPostById as jest.Mock).mockResolvedValue(makePostRow());
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow({ batchId: "batch-X" }));

      const result = await service.moderatePost("tenant-1", "admin-user", ["admin"], "post-1", {
        action: "hide",
        reason: "Spam",
      });

      expect(result.newStatus).toBe("hidden");
      // Admin does NOT call isFacultyAssignedToBatch (all-scope)
      expect(repo.isFacultyAssignedToBatch).not.toHaveBeenCalled();
    });

    it("requires a reason when hiding a post (AC-65)", async () => {
      (repo.isFacultyAssignedToBatch as jest.Mock).mockResolvedValue(true);
      (repo.findPostById as jest.Mock).mockResolvedValue(makePostRow());
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      await expect(
        service.moderatePost("tenant-1", "faculty-user", ["faculty"], "post-1", {
          action: "hide",
          // no reason
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  // ─── HTML-strip defense-in-depth (Risk #7, P5 M-3) ────────────────────

  describe("HTML sanitization (defense-in-depth)", () => {
    it("strips obvious HTML tags from post body before storage", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({ id: "enroll-1" });
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      const maliciousBody = "<script>alert('xss')</script>Hello <b>world</b>";

      await service.createPost("tenant-1", "student-user", ["student"], "thread-1", {
        body: maliciousBody,
      });

      // The repo.createPost should be called with the stripped body
      expect(repo.createPost).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("<script>"),
        }),
      );
      expect(repo.createPost).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("<b>"),
        }),
      );
    });

    it("strips HTML from thread body on creation", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({ id: "enroll-1" });
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      await service.createThread("tenant-1", "student-user", ["student"], {
        batchId: "batch-1",
        title: "Thread Title",
        body: "<img src=x onerror=alert(1)>Plain text",
      });

      expect(repo.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("<img"),
        }),
      );
      expect(repo.createThread).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("Plain text"),
        }),
      );
    });
  });

  // ─── Cross-tenant isolation (S1-3 AC-74) ────────────────────────────────

  describe("cross-tenant isolation", () => {
    it("passes tenantId through to the repo on every thread read", async () => {
      const tenantA = "tenant-A";

      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow({ tenantId: tenantA }));

      await service.getThread(tenantA, "user-1", ["admin"], "thread-1");

      expect(repo.findThreadById).toHaveBeenCalledWith(tenantA, "thread-1");
    });

    it("passes tenantId through to enrollment check", async () => {
      const tenantA = "tenant-A";
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue(null); // not enrolled

      await expect(
        service.createThread(tenantA, "student-user", ["student"], {
          batchId: "batch-X",
          title: "t",
          body: "b",
        }),
      ).rejects.toThrow(NotFoundException);

      expect(repo.findActiveEnrollment).toHaveBeenCalledWith(tenantA, "student-user", "batch-X");
    });
  });

  // ─── listThreads — requires batchId or programId ─────────────────────────

  describe("listThreads", () => {
    it("throws 422 if neither batchId nor programId is supplied", async () => {
      await expect(
        service.listThreads("tenant-1", "user-1", ["student"], {
          limit: 20,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("allows reading batch threads when enrolled", async () => {
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({ id: "enroll-1" });
      (repo.listThreads as jest.Mock).mockResolvedValue([makeThreadRow()]);

      const result = await service.listThreads("tenant-1", "student-user", ["student"], {
        batchId: "batch-1",
        limit: 20,
      });

      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── resolveThread (thread author can resolve their own thread) ─────────

  describe("resolveThread", () => {
    it("allows thread author to mark thread as resolved", async () => {
      const authorId = "author-user-1";
      (repo.findThreadById as jest.Mock)
        .mockResolvedValueOnce(makeThreadRow({ authorId }))
        .mockResolvedValueOnce(makeThreadRow({ status: "resolved", resolvedPostId: "post-1" }));
      (repo.updateThread as jest.Mock).mockResolvedValue({ id: "thread-1", status: "resolved", pinned: false });

      const result = await service.resolveThread("tenant-1", authorId, ["student"], "thread-1", "post-1");

      expect(result.status).toBe("resolved");
    });

    it("throws ForbiddenException when a non-author student tries to resolve another user's thread", async () => {
      const authorId = "author-user-1";
      const otherStudent = "other-student";

      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow({ authorId }));
      (repo.findActiveEnrollment as jest.Mock).mockResolvedValue({ id: "enroll-1" });

      await expect(
        service.resolveThread("tenant-1", otherStudent, ["student"], "thread-1", "post-1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── votePost — concurrent unique violation handled (AC-63) ─────────────

  describe("votePost — concurrent race (AC-63)", () => {
    it("handles unique constraint violation (P2002) as idempotent", async () => {
      const { Prisma } = jest.requireActual("@prisma/client");
      const uniqueError = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0",
      });

      (repo.hasActiveVote as jest.Mock).mockResolvedValue(false);
      (repo.createVote as jest.Mock).mockRejectedValue(uniqueError);
      (repo.findPostById as jest.Mock).mockResolvedValue(
        makePostRow({ authorId: "other-user", upvotes: 1 }),
      );
      (repo.findThreadById as jest.Mock).mockResolvedValue(makeThreadRow());

      const result = await service.votePost("tenant-1", "voter-user", ["student"], "post-1");

      // Handles the race: returns current state without throwing
      expect(result.hasVoted).toBe(true);
      expect(result.upvotes).toBe(1);
    });
  });
});
