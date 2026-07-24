// apps/api/src/modules/content/colleges.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Colleges are `Partner` rows (category=
// "college_partner") shown on a DEDICATED CRM screen (docs/plans/phase-11-locked-
// templates.md; crm/colleges.schemas.ts) — mirrors the mentors/courses precedent of "own
// screen over a purpose-built field set" rather than reusing the generic hiring/tech
// partner-logo screen. No public read endpoint here: colleges surface on the site via the
// EXISTING `GET /public/partners?category=college_partner` (PublicPartnersController,
// partners.controller.ts) through the `live_collection_ref(collection="partners")`
// page-builder mechanism (page-templates.schemas.ts's `colleges_live` sections).
//
// Permissions reuse the SAME `content.*` keys `/crm/partners` uses (content.view/create/
// edit/delete) — colleges are still Partner rows, not a new permission domain (see
// crm/colleges.schemas.ts's "PERMISSIONS" file-header comment for the considered
// alternative and why this repo follows the partners precedent instead).

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors, UsePipes } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { CollegesService } from "./colleges.service";
import {
  CreateCollegeRequestSchema,
  type CreateCollegeRequest,
  UpdateCollegeRequestSchema,
  type UpdateCollegeRequest,
  ListCollegesQuerySchema,
  type ListCollegesQuery,
  type College,
  CollegeLogoUploadUrlRequestSchema,
  type CollegeLogoUploadUrlRequest,
  type SignedUploadResponse,
} from "./dto";

@Controller("crm/colleges")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CollegesController {
  constructor(private readonly service: CollegesService) {}

  /**
   * POST /api/v1/crm/colleges/logo-upload-url — mint a signed PUT URL for a college logo.
   * Declared BEFORE the `:id` routes (same static-segment convention as MentorsController#
   * photoUploadUrl / ContentPagesBuilderController#mediaUploadUrl). Permission: content.edit
   * (mirrors MentorPhotoUploadUrlRequestSchema's single-permission convention — the same
   * permission the update endpoint below requires).
   */
  @Post("logo-upload-url")
  @HttpCode(200)
  @RequirePermission("content.edit")
  @UsePipes(new ZodValidationPipe(CollegeLogoUploadUrlRequestSchema))
  async logoUploadUrl(@CurrentUser() user: RequestUser, @Body() body: CollegeLogoUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.service.getLogoUploadUrl(user.tenantId, body);
  }

  @Get()
  @RequirePermission("content.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCollegesQuerySchema)) query: ListCollegesQuery,
  ): Promise<PaginatedResult<College>> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("content.create")
  @UsePipes(new ZodValidationPipe(CreateCollegeRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateCollegeRequest): Promise<College> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("content.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCollegeRequestSchema)) body: UpdateCollegeRequest,
  ): Promise<College> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("content.delete")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}
