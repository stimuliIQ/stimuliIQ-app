// apps/api/src/modules/growth/landing-pages.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern —
// unauthenticated public endpoints use a SEPARATE controller class with NO guards):
//   LandingPagesController       — /crm/landing-pages admin CRUD (landing_pages.view/edit).
//   PublicLandingPagesController — /public/landing-pages/:slug anonymous render (published
//                                  only; server resolves the A/B variant when omitted).

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
import type {
  CreateLandingPageRequest,
  GetPublicLandingPageQuery,
  LandingPageDetail,
  LandingPageSummary,
  ListLandingPagesQuery,
  PublicLandingPage,
  UpdateLandingPageRequest,
} from "@repo/types";
import {
  CreateLandingPageRequestSchema,
  GetPublicLandingPageQuerySchema,
  ListLandingPagesQuerySchema,
  UpdateLandingPageRequestSchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LandingPagesService } from "./landing-pages.service";

@Controller("crm/landing-pages")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LandingPagesController {
  constructor(private readonly service: LandingPagesService) {}

  @Get()
  @RequirePermission("landing_pages.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLandingPagesQuerySchema)) query: ListLandingPagesQuery,
  ): Promise<PaginatedResult<LandingPageSummary>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("landing_pages.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<LandingPageDetail> {
    return this.service.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("landing_pages.edit")
  @UsePipes(new ZodValidationPipe(CreateLandingPageRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateLandingPageRequest): Promise<LandingPageDetail> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("landing_pages.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLandingPageRequestSchema)) body: UpdateLandingPageRequest,
  ): Promise<LandingPageDetail> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("landing_pages.edit")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public render — NO guards, NO auth, CSRF-excluded via app.module.ts
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/landing-pages")
export class PublicLandingPagesController {
  constructor(private readonly service: LandingPagesService) {}

  @Get(":slug")
  async getBySlug(
    @Param("slug") slug: string,
    @Query(new ZodValidationPipe(GetPublicLandingPageQuerySchema)) query: GetPublicLandingPageQuery,
  ): Promise<PublicLandingPage> {
    return this.service.getPublicBySlug(slug, query.variant);
  }
}
