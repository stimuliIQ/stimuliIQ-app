// apps/api/src/modules/course-types/course-types.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). `/api/v1/crm/course-types`.
//
// PERMISSION SPLIT, deliberately asymmetric (docs/specs/course-types.md):
//   - READ is gated on `students.view`. Everyone who can open the student directory or the
//     add-student dialog needs this list to render a dropdown; giving it its own view key
//     would mean every counsellor role has to be granted a second permission just to see a
//     picker, and the list of qualifications a company offers is not sensitive.
//   - WRITE is gated on `course_types.manage` (admin + super_admin). Renaming an option
//     changes what every screen, export and report says about existing students, which is
//     an administrative act, not part of day-to-day student data entry.

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

import { CourseTypesService } from "./course-types.service";
import {
  CreateCourseTypeRequestSchema,
  type CreateCourseTypeRequest,
  UpdateCourseTypeRequestSchema,
  type UpdateCourseTypeRequest,
  ListCourseTypesQuerySchema,
  type ListCourseTypesQuery,
  type CourseTypeOption,
} from "./dto";

@Controller("crm/course-types")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CourseTypesController {
  constructor(private readonly service: CourseTypesService) {}

  @Get()
  @RequirePermission("students.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCourseTypesQuerySchema)) query: ListCourseTypesQuery,
  ): Promise<PaginatedResult<CourseTypeOption>> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("course_types.manage")
  @UsePipes(new ZodValidationPipe(CreateCourseTypeRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateCourseTypeRequest): Promise<CourseTypeOption> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("course_types.manage")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCourseTypeRequestSchema)) body: UpdateCourseTypeRequest,
  ): Promise<CourseTypeOption> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("course_types.manage")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.remove(user.tenantId, id);
    return { deleted: true };
  }
}
