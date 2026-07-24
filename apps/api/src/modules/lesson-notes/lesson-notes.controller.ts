// apps/api/src/modules/lesson-notes/lesson-notes.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/me/lessons/:lessonId/notes — own-scope only.
//
// Permission: notes.manage (scope: own — granted to `student` role only, prisma/seed.ts).

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
} from "@nestjs/common";
import type { LessonNote } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LessonNotesService } from "./lesson-notes.service";
import {
  CreateLessonNoteRequestSchema,
  type CreateLessonNoteRequest,
  UpdateLessonNoteRequestSchema,
  type UpdateLessonNoteRequest,
  ListLessonNotesQuerySchema,
  type ListLessonNotesQuery,
} from "./dto";

@Controller("me/lessons/:lessonId/notes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LessonNotesController {
  constructor(private readonly service: LessonNotesService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission("notes.manage")
  async create(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Body(new ZodValidationPipe(CreateLessonNoteRequestSchema)) body: CreateLessonNoteRequest,
  ): Promise<LessonNote> {
    return this.service.create(user.tenantId, user.id, lessonId, body);
  }

  @Get()
  @RequirePermission("notes.manage")
  async list(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Query(new ZodValidationPipe(ListLessonNotesQuerySchema)) query: ListLessonNotesQuery,
  ): Promise<PaginatedResult<LessonNote>> {
    return this.service.list(user.tenantId, user.id, lessonId, query);
  }

  @Patch(":noteId")
  @RequirePermission("notes.manage")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Param("noteId", new ParseUUIDPipe()) noteId: string,
    @Body(new ZodValidationPipe(UpdateLessonNoteRequestSchema)) body: UpdateLessonNoteRequest,
  ): Promise<LessonNote> {
    return this.service.update(user.tenantId, user.id, lessonId, noteId, body);
  }

  @Delete(":noteId")
  @HttpCode(204)
  @RequirePermission("notes.manage")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
    @Param("noteId", new ParseUUIDPipe()) noteId: string,
  ): Promise<void> {
    await this.service.remove(user.tenantId, user.id, lessonId, noteId);
  }
}
