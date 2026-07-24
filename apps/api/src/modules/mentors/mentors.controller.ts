// apps/api/src/modules/mentors/mentors.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/mentors (matches @repo/api-client's MentorsApi paths + the
// OpenAPI paths registered in packages/types/src/openapi/registry.ts exactly).
// Permission keys matched to prisma/seed.ts's P8_PERMISSIONS catalog: mentors.view/
// create/edit/delete — NEVER granted to the Mentor role itself (Rule M-3, AC-54).

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
import type { MentorDetail, SignedUploadResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { MentorsService } from "./mentors.service";
import {
  CreateMentorRequestSchema,
  type CreateMentorRequest,
  UpdateMentorRequestSchema,
  type UpdateMentorRequest,
  ListMentorsQuerySchema,
  type ListMentorsQuery,
  type MentorSummary,
  MentorPhotoUploadUrlRequestSchema,
  type MentorPhotoUploadUrlRequest,
} from "./dto";

@Controller("crm/mentors")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MentorsController {
  constructor(private readonly mentorsService: MentorsService) {}

  @Get()
  @RequirePermission("mentors.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListMentorsQuerySchema)) query: ListMentorsQuery,
  ): Promise<PaginatedResult<MentorSummary>> {
    return this.mentorsService.list(user.tenantId, query);
  }

  /**
   * POST /api/v1/crm/mentors/photo-upload-url — mint a signed PUT URL for a mentor photo.
   * Declared BEFORE the `:id` routes so the static `photo-upload-url` segment is never
   * shadowed. Permission: mentors.edit (same as create/update — staff only, Rule M-3).
   */
  @Post("photo-upload-url")
  @HttpCode(200)
  @RequirePermission("mentors.edit")
  @UsePipes(new ZodValidationPipe(MentorPhotoUploadUrlRequestSchema))
  async photoUploadUrl(
    @CurrentUser() user: RequestUser,
    @Body() body: MentorPhotoUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.mentorsService.getPhotoUploadUrl(user.tenantId, body);
  }

  @Get(":id")
  @RequirePermission("mentors.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<MentorDetail> {
    return this.mentorsService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("mentors.create")
  @UsePipes(new ZodValidationPipe(CreateMentorRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateMentorRequest): Promise<MentorDetail> {
    return this.mentorsService.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("mentors.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateMentorRequestSchema)) body: UpdateMentorRequest,
  ): Promise<MentorDetail> {
    return this.mentorsService.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @RequirePermission("mentors.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<MentorDetail> {
    return this.mentorsService.softDelete(user.tenantId, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission("mentors.edit")
  async restore(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<MentorDetail> {
    return this.mentorsService.restore(user.tenantId, id);
  }
}
