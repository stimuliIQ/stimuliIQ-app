// apps/api/src/modules/content/content-pages.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   ContentPagesController       — /crm/content-pages admin CRUD.
//   PublicContentPagesController — /public/pages/:slug anonymous read (published only).

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ContentPagesService } from "./content-pages.service";
import {
  CreateContentPageRequestSchema,
  type CreateContentPageRequest,
  UpdateContentPageRequestSchema,
  type UpdateContentPageRequest,
  ListContentPagesQuerySchema,
  type ListContentPagesQuery,
  type ContentPageSummary,
  type ContentPageDetail,
  type PublicContentPage,
} from "./dto";

@Controller("crm/content-pages")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ContentPagesController {
  constructor(private readonly service: ContentPagesService) {}

  @Get()
  @RequirePermission("content.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListContentPagesQuerySchema)) query: ListContentPagesQuery,
  ): Promise<PaginatedResult<ContentPageSummary>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("content.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<ContentPageDetail> {
    return this.service.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreateContentPageRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateContentPageRequest): Promise<ContentPageDetail> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("content.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateContentPageRequestSchema)) body: UpdateContentPageRequest,
  ): Promise<ContentPageDetail> {
    return this.service.update(user.tenantId, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("content.publish")
  async publish(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<ContentPageDetail> {
    return this.service.publish(user.tenantId, id);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("content.delete")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

@Controller("public/pages")
export class PublicContentPagesController {
  constructor(private readonly service: ContentPagesService) {}

  @Get(":slug")
  async getBySlug(@Param("slug") slug: string): Promise<PublicContentPage> {
    return this.service.getPublicBySlug(slug);
  }
}
