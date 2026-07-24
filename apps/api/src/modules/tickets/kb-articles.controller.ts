// apps/api/src/modules/tickets/kb-articles.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern —
// unauthenticated public endpoints use a SEPARATE controller class with NO guards):
//   KbArticlesController       — /crm/kb-articles admin CRUD (kb.view read / kb.edit write).
//   PublicKbArticlesController — /public/kb-articles anonymous read (published only).

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
import { KbArticlesService } from "./kb-articles.service";
import {
  CreateKbArticleRequestSchema,
  type CreateKbArticleRequest,
  UpdateKbArticleRequestSchema,
  type UpdateKbArticleRequest,
  ListKbArticlesQuerySchema,
  type ListKbArticlesQuery,
  type KbArticleDetail,
  type KbArticleSummary,
  ListPublicKbArticlesQuerySchema,
  type ListPublicKbArticlesQuery,
  type PublicKbArticleDetail,
  type PublicKbArticleSummary,
} from "./dto";

@Controller("crm/kb-articles")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class KbArticlesController {
  constructor(private readonly service: KbArticlesService) {}

  @Get()
  @RequirePermission("kb.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListKbArticlesQuerySchema)) query: ListKbArticlesQuery,
  ): Promise<PaginatedResult<KbArticleSummary>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("kb.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<KbArticleDetail> {
    return this.service.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("kb.edit")
  @UsePipes(new ZodValidationPipe(CreateKbArticleRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateKbArticleRequest): Promise<KbArticleDetail> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("kb.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateKbArticleRequestSchema)) body: UpdateKbArticleRequest,
  ): Promise<KbArticleDetail> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("kb.edit")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public reads — NO guards, NO auth, CSRF-excluded via app.module.ts
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/kb-articles")
export class PublicKbArticlesController {
  constructor(private readonly service: KbArticlesService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListPublicKbArticlesQuerySchema)) query: ListPublicKbArticlesQuery,
  ): Promise<PublicKbArticleSummary[]> {
    return this.service.listPublic(query);
  }

  @Get(":slug")
  async getBySlug(@Param("slug") slug: string): Promise<PublicKbArticleDetail> {
    return this.service.getPublicBySlug(slug);
  }
}
