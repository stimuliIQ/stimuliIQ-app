// apps/api/src/modules/content/blog.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   BlogController       — /crm/blog/* admin CRUD (content.view/create/edit/delete/publish).
//   PublicBlogController — /public/blog/* anonymous read (published only).

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
import { BlogService } from "./blog.service";
import {
  CreateBlogCategoryRequestSchema,
  type CreateBlogCategoryRequest,
  UpdateBlogCategoryRequestSchema,
  type UpdateBlogCategoryRequest,
  type BlogCategory,
  CreateBlogPostRequestSchema,
  type CreateBlogPostRequest,
  UpdateBlogPostRequestSchema,
  type UpdateBlogPostRequest,
  ListBlogPostsQuerySchema,
  type ListBlogPostsQuery,
  type BlogPostSummary,
  type BlogPostDetail,
  ListPublicBlogPostsQuerySchema,
  type ListPublicBlogPostsQuery,
  type PublicBlogPostSummary,
  type PublicBlogPostDetail,
} from "./dto";

@Controller("crm/blog")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BlogController {
  constructor(private readonly service: BlogService) {}

  @Get("categories")
  @RequirePermission("content.view")
  async listCategories(@CurrentUser() user: RequestUser): Promise<BlogCategory[]> {
    return this.service.listCategories(user.tenantId);
  }

  @Post("categories")
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreateBlogCategoryRequestSchema))
  async createCategory(@CurrentUser() user: RequestUser, @Body() body: CreateBlogCategoryRequest): Promise<BlogCategory> {
    return this.service.createCategory(user.tenantId, body);
  }

  @Patch("categories/:id")
  @RequirePermission("content.edit")
  async updateCategory(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBlogCategoryRequestSchema)) body: UpdateBlogCategoryRequest,
  ): Promise<BlogCategory> {
    return this.service.updateCategory(user.tenantId, id, body);
  }

  @Get("posts")
  @RequirePermission("content.view")
  async listPosts(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListBlogPostsQuerySchema)) query: ListBlogPostsQuery,
  ): Promise<PaginatedResult<BlogPostSummary>> {
    return this.service.listPosts(user.tenantId, query);
  }

  @Get("posts/:id")
  @RequirePermission("content.view")
  async getPost(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<BlogPostDetail> {
    return this.service.getById(user.tenantId, id);
  }

  @Post("posts")
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreateBlogPostRequestSchema))
  async createPost(@CurrentUser() user: RequestUser, @Body() body: CreateBlogPostRequest): Promise<BlogPostDetail> {
    return this.service.create(user.tenantId, user.id, body);
  }

  @Patch("posts/:id")
  @RequirePermission("content.edit")
  async updatePost(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBlogPostRequestSchema)) body: UpdateBlogPostRequest,
  ): Promise<BlogPostDetail> {
    return this.service.update(user.tenantId, id, body);
  }

  @Post("posts/:id/publish")
  @HttpCode(200)
  @RequirePermission("content.publish")
  async publishPost(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<BlogPostDetail> {
    return this.service.publish(user.tenantId, id);
  }

  @Delete("posts/:id")
  @HttpCode(200)
  @RequirePermission("content.delete")
  async removePost(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public reads — NO guards, NO auth
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/blog")
export class PublicBlogController {
  constructor(private readonly service: BlogService) {}

  @Get("posts")
  async list(
    @Query(new ZodValidationPipe(ListPublicBlogPostsQuerySchema)) query: ListPublicBlogPostsQuery,
  ): Promise<PublicBlogPostSummary[]> {
    return this.service.listPublic(query);
  }

  @Get("posts/:slug")
  async getBySlug(@Param("slug") slug: string): Promise<PublicBlogPostDetail> {
    return this.service.getPublicBySlug(slug);
  }
}
