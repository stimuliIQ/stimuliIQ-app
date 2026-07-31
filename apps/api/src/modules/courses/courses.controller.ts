// apps/api/src/modules/courses/courses.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/courses (matches @repo/api-client's CoursesApi paths exactly —
// note: programs/modules/lessons have NO delete/restore routes in this contract, only
// CRUD + reorder + publish/unpublish; see courses.service.ts file header for why).
// Permission keys matched to prisma/seed.ts: courses.view/create/edit/approve
// (publish/unpublish use `courses.approve` per packages/types/src/openapi/registry.ts).

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
import type { CurriculumTree, LessonNode, ModuleNode, ProgramDetail } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { CoursesService } from "./courses.service";
import {
  CreateLessonRequestSchema,
  type CreateLessonRequest,
  CreateModuleRequestSchema,
  type CreateModuleRequest,
  CreateProgramRequestSchema,
  type CreateProgramRequest,
  ListProgramsQuerySchema,
  type ListProgramsQuery,
  ReorderLessonsRequestSchema,
  type ReorderLessonsRequest,
  ReorderModulesRequestSchema,
  type ReorderModulesRequest,
  ReorderProgramsRequestSchema,
  type ReorderProgramsRequest,
  UpdateLessonRequestSchema,
  type UpdateLessonRequest,
  UpdateModuleRequestSchema,
  type UpdateModuleRequest,
  UpdateProgramRequestSchema,
  type UpdateProgramRequest,
  SetProgramVisibilityRequestSchema,
  type SetProgramVisibilityRequest,
  LessonResourceUploadUrlRequestSchema,
  type LessonResourceUploadUrlRequest,
  CreateLessonResourceRequestSchema,
  type CreateLessonResourceRequest,
  type LessonResource,
  ProgramImageUploadUrlRequestSchema,
  type ProgramImageUploadUrlRequest,
  ProgramBrochureUploadUrlRequestSchema,
  type ProgramBrochureUploadUrlRequest,
  type SignedUploadResponse,
  type ProgramSummary,
} from "./dto";

@Controller("crm/courses")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @RequirePermission("courses.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListProgramsQuerySchema)) query: ListProgramsQuery,
  ): Promise<PaginatedResult<ProgramSummary>> {
    return this.coursesService.list(user.tenantId, query);
  }

  /**
   * POST /api/v1/crm/courses/image-upload-url — mint a signed PUT URL for a course
   * card/OG image. Declared BEFORE the `:id` routes so the static `image-upload-url`
   * segment is never shadowed. Permission: courses.edit (same as update — staff only).
   */
  @Post("image-upload-url")
  @HttpCode(200)
  @RequirePermission("courses.edit")
  @UsePipes(new ZodValidationPipe(ProgramImageUploadUrlRequestSchema))
  async imageUploadUrl(
    @CurrentUser() user: RequestUser,
    @Body() body: ProgramImageUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.coursesService.getImageUploadUrl(user.tenantId, body);
  }

  /**
   * POST /api/v1/crm/courses/brochure-upload-url — mint a signed PUT URL for the course
   * brochure PDF. Also declared BEFORE the `:id` routes so the static segment is never
   * shadowed. Permission: courses.edit (same as update — staff only).
   */
  @Post("brochure-upload-url")
  @HttpCode(200)
  @RequirePermission("courses.edit")
  @UsePipes(new ZodValidationPipe(ProgramBrochureUploadUrlRequestSchema))
  async brochureUploadUrl(
    @CurrentUser() user: RequestUser,
    @Body() body: ProgramBrochureUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.coursesService.getBrochureUploadUrl(user.tenantId, body);
  }

  /**
   * POST /api/v1/crm/courses/reorder — rewrite the staff-curated program sequence that the
   * public site and this CRM table both render. Body is the FULL ordered id list; the
   * server derives `order` from array position (same contract as modules/lessons reorder).
   *
   * Declared before the `:id` routes so the static segment is never shadowed. Permission is
   * courses.edit, not courses.approve: curating the order is an editorial act, not a
   * publish-state change.
   */
  @Post("reorder")
  @HttpCode(204)
  @RequirePermission("courses.edit")
  @UsePipes(new ZodValidationPipe(ReorderProgramsRequestSchema))
  async reorder(
    @CurrentUser() user: RequestUser,
    @Body() body: ReorderProgramsRequest,
  ): Promise<void> {
    await this.coursesService.reorderPrograms(user.tenantId, body);
  }

  @Get(":id")
  @RequirePermission("courses.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ProgramDetail> {
    return this.coursesService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("courses.create")
  @UsePipes(new ZodValidationPipe(CreateProgramRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateProgramRequest): Promise<ProgramDetail> {
    return this.coursesService.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("courses.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateProgramRequestSchema)) body: UpdateProgramRequest,
  ): Promise<ProgramDetail> {
    return this.coursesService.update(user.tenantId, id, body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("courses.approve")
  async publish(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ProgramDetail> {
    return this.coursesService.publish(user.tenantId, id);
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  @RequirePermission("courses.approve")
  async unpublish(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ProgramDetail> {
    return this.coursesService.unpublish(user.tenantId, id);
  }

  /** Toggle marketing visibility (website listing). Same permission as publish/unpublish. */
  @Patch(":id/visibility")
  @RequirePermission("courses.approve")
  async setVisibility(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(SetProgramVisibilityRequestSchema)) body: SetProgramVisibilityRequest,
  ): Promise<ProgramDetail> {
    return this.coursesService.setVisibility(user.tenantId, id, body.isPublic);
  }

  @Get(":id/curriculum")
  @RequirePermission("courses.view")
  async getCurriculum(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CurriculumTree> {
    return this.coursesService.getCurriculum(user.tenantId, id);
  }

  @Post(":id/modules")
  @HttpCode(201)
  @RequirePermission("courses.edit")
  @UsePipes(new ZodValidationPipe(CreateModuleRequestSchema))
  async createModule(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) programId: string,
    @Body() body: CreateModuleRequest,
  ): Promise<ModuleNode> {
    return this.coursesService.createModule(user.tenantId, programId, body);
  }

  @Patch(":id/modules/:moduleId")
  @RequirePermission("courses.edit")
  async updateModule(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) programId: string,
    @Param("moduleId", new ParseUUIDPipe()) moduleId: string,
    @Body(new ZodValidationPipe(UpdateModuleRequestSchema)) body: UpdateModuleRequest,
  ): Promise<ModuleNode> {
    return this.coursesService.updateModule(user.tenantId, programId, moduleId, body);
  }

  @Post(":id/modules/reorder")
  @HttpCode(200)
  @RequirePermission("courses.edit")
  async reorderModules(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) programId: string,
    @Body(new ZodValidationPipe(ReorderModulesRequestSchema)) body: ReorderModulesRequest,
  ): Promise<CurriculumTree> {
    return this.coursesService.reorderModules(user.tenantId, programId, body);
  }

  @Post(":id/modules/:moduleId/lessons")
  @HttpCode(201)
  @RequirePermission("courses.edit")
  @UsePipes(new ZodValidationPipe(CreateLessonRequestSchema))
  async createLesson(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) programId: string,
    @Param("moduleId", new ParseUUIDPipe()) moduleId: string,
    @Body() body: CreateLessonRequest,
  ): Promise<LessonNode> {
    return this.coursesService.createLesson(user.tenantId, programId, moduleId, body);
  }

  @Patch(":id/modules/:moduleId/lessons/:lessonId")
  @RequirePermission("courses.edit")
  async updateLesson(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) programId: string,
    @Param("moduleId", new ParseUUIDPipe()) moduleId: string,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(UpdateLessonRequestSchema)) body: UpdateLessonRequest,
  ): Promise<LessonNode> {
    return this.coursesService.updateLesson(user.tenantId, programId, moduleId, lessonId, body);
  }

  // ─── Lesson resources (PDF / slides / datasets) ───────────────────────────
  //
  // Attaching a file to a lesson IS curriculum authoring, so these reuse
  // `courses.edit` / `courses.view` rather than introducing new permission keys
  // (every new key must be seeded AND granted, or every caller 403s — the P6
  // forum.read bug class). Two-step ingest: mint signed PUT → register the key.

  /** Short-TTL signed PUT for a lesson attachment. Permission: courses.edit. */
  @Post("lessons/:lessonId/resources/upload-url")
  @HttpCode(200)
  @RequirePermission("courses.edit")
  async resourceUploadUrl(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(LessonResourceUploadUrlRequestSchema)) body: LessonResourceUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.coursesService.getResourceUploadUrl(user.tenantId, lessonId, body);
  }

  @Get("lessons/:lessonId/resources")
  @RequirePermission("courses.view")
  async listLessonResources(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
  ): Promise<LessonResource[]> {
    return this.coursesService.listResources(user.tenantId, lessonId);
  }

  /** Registers an uploaded object against the lesson. Permission: courses.edit. */
  @Post("lessons/:lessonId/resources")
  @HttpCode(201)
  @RequirePermission("courses.edit")
  async createLessonResource(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(CreateLessonResourceRequestSchema)) body: CreateLessonResourceRequest,
  ): Promise<LessonResource> {
    return this.coursesService.createResource(user.tenantId, lessonId, body);
  }

  /** Soft-deletes a lesson attachment. Permission: courses.edit. */
  @Delete("lessons/resources/:resourceId")
  @HttpCode(204)
  @RequirePermission("courses.edit")
  async deleteLessonResource(
    @CurrentUser() user: RequestUser,
    @Param("resourceId", new ParseUUIDPipe()) resourceId: string,
  ): Promise<void> {
    return this.coursesService.deleteResource(user.tenantId, resourceId);
  }

  @Post(":id/modules/:moduleId/lessons/reorder")
  @HttpCode(200)
  @RequirePermission("courses.edit")
  async reorderLessons(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) programId: string,
    @Param("moduleId", new ParseUUIDPipe()) moduleId: string,
    @Body(new ZodValidationPipe(ReorderLessonsRequestSchema)) body: ReorderLessonsRequest,
  ): Promise<CurriculumTree> {
    return this.coursesService.reorderLessons(user.tenantId, programId, moduleId, body);
  }
}
