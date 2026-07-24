// apps/api/src/modules/content/content-pages-builder.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3) for the Phase-10 page builder
// (docs/specs/phase-10-page-builder.md). Mounted at the SAME `crm/content-pages` prefix
// as `ContentPagesController` (content-pages.controller.ts) — a separate controller
// class, same pattern as that file's CRM/public split (ADR-0019), keeping the
// always-super_admin `content.builder` surface physically separate from the generic
// `content.edit`/`content.publish`/`content.delete` CMS surface.

import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, UseGuards, UseInterceptors, UsePipes } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ContentPagesBuilderService } from "./content-pages-builder.service";
import {
  CreateBuilderPageRequestSchema,
  type CreateBuilderPageRequest,
  SaveBuilderPageRequestSchema,
  type SaveBuilderPageRequest,
  PreviewBuilderPageRequestSchema,
  type PreviewBuilderPageRequest,
  type PreviewBuilderPageResponse,
  ListContentPageVersionsQuerySchema,
  type ListContentPageVersionsQuery,
  type ContentPageVersionSummary,
  type ContentPageVersionDetail,
  RevertContentPageVersionRequestSchema,
  type RevertContentPageVersionRequest,
  type ContentPageBuilderDetail,
  ContentPageMediaUploadUrlRequestSchema,
  type ContentPageMediaUploadUrlRequest,
  type SignedUploadResponse,
} from "./dto";

@Controller("crm/content-pages")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ContentPagesBuilderController {
  constructor(private readonly service: ContentPagesBuilderService) {}

  /**
   * POST /api/v1/crm/content-pages/media-upload-url — mint a signed PUT URL for a
   * page-builder marketing image. Declared BEFORE `builder`/`:id/...` routes as a static
   * segment (same convention as CoursesController#imageUploadUrl / MentorsController#
   * photoUploadUrl) — no actual collision risk here (every other route on this
   * controller requires an `:id` segment first), but kept consistent for readability.
   * Permission: content.builder (super_admin-only, same as every other builder endpoint).
   */
  @Post("media-upload-url")
  @HttpCode(200)
  @RequirePermission("content.builder")
  @UsePipes(new ZodValidationPipe(ContentPageMediaUploadUrlRequestSchema))
  async mediaUploadUrl(
    @CurrentUser() user: RequestUser,
    @Body() body: ContentPageMediaUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.service.getMediaUploadUrl(user.tenantId, body);
  }

  @Post("builder")
  @HttpCode(201)
  @RequirePermission("content.builder")
  @UsePipes(new ZodValidationPipe(CreateBuilderPageRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateBuilderPageRequest): Promise<ContentPageBuilderDetail> {
    return this.service.create(user.tenantId, body);
  }

  @Put(":id/builder")
  @RequirePermission("content.builder")
  async save(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SaveBuilderPageRequestSchema)) body: SaveBuilderPageRequest,
  ): Promise<ContentPageBuilderDetail> {
    return this.service.save(user.tenantId, user, id, body);
  }

  @Post(":id/preview")
  @HttpCode(200)
  @RequirePermission("content.builder")
  async preview(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(PreviewBuilderPageRequestSchema)) body: PreviewBuilderPageRequest,
  ): Promise<PreviewBuilderPageResponse> {
    return this.service.preview(user.tenantId, id, body);
  }

  @Get(":id/versions")
  @RequirePermission("content.builder")
  async listVersions(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListContentPageVersionsQuerySchema)) query: ListContentPageVersionsQuery,
  ): Promise<PaginatedResult<ContentPageVersionSummary>> {
    return this.service.listVersions(user.tenantId, id, query);
  }

  @Get(":id/versions/:version")
  @RequirePermission("content.builder")
  async getVersion(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("version", new ParseIntPipe()) version: number,
  ): Promise<ContentPageVersionDetail> {
    return this.service.getVersion(user.tenantId, id, version);
  }

  @Post(":id/versions/:version/revert")
  @HttpCode(200)
  @RequirePermission("content.builder")
  async revert(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("version", new ParseIntPipe()) version: number,
    @Body(new ZodValidationPipe(RevertContentPageVersionRequestSchema)) body: RevertContentPageVersionRequest,
  ): Promise<ContentPageBuilderDetail> {
    return this.service.revert(user.tenantId, user, id, version, body);
  }
}
