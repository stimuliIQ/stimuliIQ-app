// apps/api/src/modules/forum/forum.controller.ts
//
// HTTP boundary for the ForumModule (WS-4, docs/plans/phase-6.md task #9).
// (CLAUDE.md §3.3: "controller — HTTP boundary, validates DTO via the global Zod pipe,
// returns DTO. No Prisma / no business logic in controllers.")
//
// ─── ROUTE MAP ────────────────────────────────────────────────────────────────
//
// LMS (student/faculty/admin — authenticated):
//   GET  /forum/threads                  forum.read   (enrolled scope)
//   POST /forum/threads                  forum.post   (enrolled scope)
//   GET  /forum/threads/:id              forum.read
//   GET  /forum/threads/:id/posts        forum.read   (enrolled scope)
//   POST /forum/threads/:id/posts        forum.post   (enrolled scope)
//   POST /forum/threads/:id/resolve      forum.post   (thread author or moderator)
//   POST /forum/posts/:id/vote           forum.post   (enrolled scope; self-vote → 422)
//
// Moderation (faculty/admin — authenticated, forum.moderate):
//   POST /forum/threads/:id/moderate     forum.moderate (assigned/all scope)
//   POST /forum/posts/:id/moderate       forum.moderate (assigned/all scope)
//
// CRM moderation queue (faculty/admin):
//   GET  /crm/forum/moderation           forum.moderate (assigned/all scope)
//
// ─── SECURITY ─────────────────────────────────────────────────────────────────
//   - All routes: JwtAuthGuard + PermissionsGuard + ScopeInterceptor.
//   - Enrollment-scope enforcement: inside ForumService (IDOR→404 for non-enrolled).
//   - Assigned-scope enforcement: inside ForumService (IDOR→404 for unassigned faculty).
//   - No business logic in this class — all delegated to ForumService.
//   - No Prisma access in this class.
//
// ─── PERMISSIONS ──────────────────────────────────────────────────────────────
//   forum.read     (enrolled | assigned | branch | all) — seeded in P6 migration
//   forum.post     (enrolled | assigned | all) — seeded in P6 migration
//   forum.moderate (assigned | branch | all) — seeded in P6 migration

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  ThreadDto,
  PostDto,
  CreateThreadDto,
  CreatePostDto,
  ModerateDto,
  VoteResponse,
  ListThreadsQuery,
  ListPostsQuery,
  ListModerationQueueQuery,
} from "@repo/types";
import {
  CreateThreadDtoSchema,
  CreatePostDtoSchema,
  ModerateDtoSchema,
  ListThreadsQuerySchema,
  ListPostsQuerySchema,
  ListModerationQueueQuerySchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ForumService } from "./forum.service";

// ─────────────────────────────────────────────────────────────────────────────
// Forum controller — LMS student/faculty surface
// ─────────────────────────────────────────────────────────────────────────────

@Controller("forum")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ForumController {
  constructor(private readonly service: ForumService) {}

  // ─── Threads ──────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/forum/threads?batchId=<id>
   * List threads for a batch the authenticated user is enrolled in (or assigned to).
   * Enrollment-scoped for students: IDOR→404 if not enrolled (AC-53, AC-55).
   * Permission: forum.read
   */
  @Get("threads")
  @RequirePermission("forum.read")
  async listThreads(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListThreadsQuerySchema)) query: ListThreadsQuery,
  ): Promise<PaginatedResult<ThreadDto>> {
    return this.service.listThreads(
      user.tenantId,
      user.id,
      user.roles,
      query,
    );
  }

  /**
   * POST /api/v1/forum/threads
   * Create a new forum thread in a batch the student is enrolled in (AC-56, AC-57).
   * Faculty: allowed in assigned batches.
   * Non-enrolled student → 404 (IDOR-safe, AC-56).
   * Permission: forum.post
   */
  @Post("threads")
  @HttpCode(201)
  @RequirePermission("forum.post")
  async createThread(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateThreadDtoSchema)) body: CreateThreadDto,
  ): Promise<ThreadDto> {
    return this.service.createThread(
      user.tenantId,
      user.id,
      user.roles,
      body,
    );
  }

  /**
   * GET /api/v1/forum/threads/:id
   * Get a single thread.
   * Enrollment-scoped for students.
   * Permission: forum.read
   */
  @Get("threads/:id")
  @RequirePermission("forum.read")
  async getThread(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ThreadDto> {
    return this.service.getThread(user.tenantId, user.id, user.roles, id);
  }

  /**
   * GET /api/v1/forum/threads/:id/posts
   * List posts in a thread, offset-paginated.
   * Enrollment-scoped for students.
   * Optional ?parentId filter for nested-reply subthread view (AC-59).
   * Permission: forum.read
   */
  @Get("threads/:id/posts")
  @RequirePermission("forum.read")
  async listPosts(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListPostsQuerySchema)) query: ListPostsQuery,
  ): Promise<PaginatedResult<PostDto>> {
    return this.service.listPosts(
      user.tenantId,
      user.id,
      user.roles,
      id,
      query,
    );
  }

  /**
   * POST /api/v1/forum/threads/:id/posts
   * Create a post or reply in a thread (AC-58, AC-59).
   * Enrollment-scoped for students.
   * Triggers a reply notification to the thread author (AC-60).
   * Permission: forum.post
   */
  @Post("threads/:id/posts")
  @HttpCode(201)
  @RequirePermission("forum.post")
  async createPost(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(CreatePostDtoSchema)) body: CreatePostDto,
  ): Promise<PostDto> {
    return this.service.createPost(
      user.tenantId,
      user.id,
      user.roles,
      id,
      body,
    );
  }

  /**
   * POST /api/v1/forum/threads/:id/resolve
   * Mark a thread as resolved (Q&A resolution).
   * Thread author or moderator may resolve; students can re-open their own threads.
   * resolvedPostId in body links the accepted answer; null = unresolve.
   * Permission: forum.post (further authorization check inside service)
   */
  @Post("threads/:id/resolve")
  @HttpCode(200)
  @RequirePermission("forum.post")
  async resolveThread(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: { resolvedPostId?: string | null },
  ): Promise<ThreadDto> {
    return this.service.resolveThread(
      user.tenantId,
      user.id,
      user.roles,
      id,
      body.resolvedPostId ?? null,
    );
  }

  /**
   * POST /api/v1/forum/posts/:id/vote
   * Toggle upvote on a post.
   * - Second vote from same user → toggle off (AC-61).
   * - Self-vote → 422 CANNOT_VOTE_OWN_POST (AC-62).
   * Body is empty (post ID from path, user from session).
   * Permission: forum.post
   */
  @Post("posts/:id/vote")
  @HttpCode(200)
  @RequirePermission("forum.post")
  async votePost(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<VoteResponse> {
    return this.service.votePost(
      user.tenantId,
      user.id,
      user.roles,
      id,
    );
  }

  // ─── Moderation ───────────────────────────────────────────────────────────

  /**
   * POST /api/v1/forum/threads/:id/moderate
   * Moderate a thread: hide/unhide/pin/unpin/delete.
   * Faculty: assigned batches only (IDOR→404 for others, AC-64).
   * Admin: all batches (AC-67).
   * Student: 403 (PermissionsGuard, AC-68).
   * Every action is audit-logged (AC-65, AC-66).
   * Permission: forum.moderate
   */
  @Post("threads/:id/moderate")
  @HttpCode(200)
  @RequirePermission("forum.moderate")
  async moderateThread(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ModerateDtoSchema)) body: ModerateDto,
  ): Promise<{ message: string; newStatus: string }> {
    return this.service.moderateThread(
      user.tenantId,
      user.id,
      user.roles,
      id,
      body,
    );
  }

  /**
   * POST /api/v1/forum/posts/:id/moderate
   * Moderate a post: hide/unhide/delete.
   * Faculty: assigned batches only (IDOR→404 for others, AC-64).
   * Admin: all batches (AC-67).
   * Student: 403 (PermissionsGuard, AC-68).
   * AC-65: hide requires a reason; writes hidden_by + hidden_reason + audit log.
   * AC-69: delete soft-deletes the post.
   * Permission: forum.moderate
   */
  @Post("posts/:id/moderate")
  @HttpCode(200)
  @RequirePermission("forum.moderate")
  async moderatePost(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ModerateDtoSchema)) body: ModerateDto,
  ): Promise<{ message: string; newStatus: string }> {
    return this.service.moderatePost(
      user.tenantId,
      user.id,
      user.roles,
      id,
      body,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM moderation queue — faculty/admin surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CRM forum moderation controller.
 * Path prefix: /crm/forum/...
 *
 * Separate controller class so the CRM surface (/crm/*) is distinct from the
 * LMS forum surface (/forum/*), matching the ADR-0019 convention of separate
 * controller classes for different RBAC contexts.
 *
 * Permission: forum.moderate (assigned for faculty, all for admin).
 */
@Controller("crm/forum")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CrmForumController {
  constructor(private readonly service: ForumService) {}

  /**
   * GET /api/v1/crm/forum/moderation
   * Moderation report queue — faculty sees only assigned-batch posts.
   * Admin sees all batches' posts.
   * Offset-paginated. Optional batchId + status filters.
   * Permission: forum.moderate
   */
  @Get("moderation")
  @RequirePermission("forum.moderate")
  async listModerationQueue(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListModerationQueueQuerySchema)) query: ListModerationQueueQuery,
  ): Promise<PaginatedResult<PostDto>> {
    return this.service.listModerationQueue(
      user.tenantId,
      user.id,
      user.roles,
      query,
    );
  }
}
