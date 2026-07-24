// apps/api/src/modules/students/students.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/students (matches @repo/api-client's StudentsApi paths exactly).
// Every mutating route requires `@RequirePermission` (matched to the exact seeded keys in
// prisma/seed.ts: students.view/create/edit/delete) + the ScopeInterceptor publishing the
// resolved scope for the repository layer to consume.

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
import type { StudentDetail } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { AuthIpRateLimitGuard } from "../auth/guards/auth-ip-rate-limit.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { StudentsService } from "./students.service";
import {
  CreateStudentRequestSchema,
  type CreateStudentRequest,
  UpdateStudentRequestSchema,
  type UpdateStudentRequest,
  ListStudentsQuerySchema,
  type ListStudentsQuery,
  type StudentSummary,
  type ResendCredentialsResponse,
} from "./dto";

@Controller("crm/students")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @RequirePermission("students.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListStudentsQuerySchema)) query: ListStudentsQuery,
  ): Promise<PaginatedResult<StudentSummary>> {
    return this.studentsService.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("students.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<StudentDetail> {
    return this.studentsService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("students.create")
  @UsePipes(new ZodValidationPipe(CreateStudentRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateStudentRequest): Promise<StudentDetail> {
    return this.studentsService.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("students.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateStudentRequestSchema)) body: UpdateStudentRequest,
  ): Promise<StudentDetail> {
    return this.studentsService.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @RequirePermission("students.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<StudentDetail> {
    return this.studentsService.softDelete(user.tenantId, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission("students.edit")
  async restore(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<StudentDetail> {
    return this.studentsService.restore(user.tenantId, id);
  }

  /**
   * POST /crm/students/:id/resend-credentials (gap-closing pass) — reissue a student's
   * LMS login when the welcome email bounced/was lost, or a credential needs rotating.
   * Reuses `students.edit` (the existing gate for "mutates a student's account state" —
   * same permission `restore` above uses) rather than a new one-off permission key.
   *
   * SECURITY (post-review fix): IP-rate-limited like every other credential-issuing route
   * in this codebase (login/refresh/otp/password-reset) — this one also triggers an
   * argon2 hash + an outbound email + a full session revocation per call, so an unthrottled
   * caller could cheaply mail-bomb a student and repeatedly kick them out of their account.
   */
  @Post(":id/resend-credentials")
  @HttpCode(200)
  @RequirePermission("students.edit")
  @UseGuards(AuthIpRateLimitGuard)
  async resendCredentials(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ResendCredentialsResponse> {
    return this.studentsService.resendCredentials(user.tenantId, id);
  }
}
