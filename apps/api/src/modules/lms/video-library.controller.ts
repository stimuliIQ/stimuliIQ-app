// apps/api/src/modules/lms/video-library.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Mounted at /crm/videos* (T26, docs/plans/
// phase-9-completion.md). Transcode-status webhook stays on the EXISTING
// VideoWebhookController (video-webhook.controller.ts) — untouched by this file.

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { VideoLibraryService } from "./video-library.service";
import {
  CreateVideoAssetRequestSchema,
  type CreateVideoAssetRequest,
  type CreateVideoAssetResponse,
  ListVideoAssetsQuerySchema,
  type ListVideoAssetsQuery,
  type VideoAsset,
  AttachCaptionsRequestSchema,
  type AttachCaptionsRequest,
  MarkVideoUploadedRequestSchema,
  type MarkVideoUploadedRequest,
  type VideoPreviewUrlResponse,
} from "./dto/video-library.schemas";

@Controller("crm/videos")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class VideoLibraryController {
  constructor(private readonly service: VideoLibraryService) {}

  @Get()
  @RequirePermission("videolib.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListVideoAssetsQuerySchema)) query: ListVideoAssetsQuery,
  ): Promise<PaginatedResult<VideoAsset>> {
    return this.service.list(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("videolib.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<VideoAsset> {
    return this.service.getById(user.tenantId, user.id, id);
  }

  /** POST /crm/videos — ingest (== attach to a lesson, see dto file header) + presigned upload URL. */
  @Post()
  @HttpCode(201)
  @RequirePermission("videolib.upload")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateVideoAssetRequestSchema)) body: CreateVideoAssetRequest,
  ): Promise<CreateVideoAssetResponse> {
    return this.service.create(user.tenantId, user.id, body);
  }

  @Patch(":id/captions")
  @RequirePermission("videolib.edit")
  async attachCaptions(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AttachCaptionsRequestSchema)) body: AttachCaptionsRequest,
  ): Promise<VideoAsset> {
    return this.service.attachCaptions(user.tenantId, user.id, id, body);
  }

  /**
   * POST /crm/videos/:id/uploaded — the browser finished its direct PUT.
   * Flips non-transcoding providers (noop/local dev) to `ready`; a no-op on status
   * for Cloudflare Stream / Mux, where the transcode webhook stays authoritative.
   */
  @Post(":id/uploaded")
  @HttpCode(200)
  @RequirePermission("videolib.upload")
  async markUploaded(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(MarkVideoUploadedRequestSchema)) body: MarkVideoUploadedRequest,
  ): Promise<VideoAsset> {
    return this.service.markUploaded(user.tenantId, user.id, id, body);
  }

  /** GET /crm/videos/:id/preview-url — short-TTL signed URL so staff can verify the attached file. */
  @Get(":id/preview-url")
  @RequirePermission("videolib.view")
  async previewUrl(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<VideoPreviewUrlResponse> {
    return this.service.getPreviewUrl(user.tenantId, user.id, id);
  }
}
