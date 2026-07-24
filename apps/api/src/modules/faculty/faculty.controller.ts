// apps/api/src/modules/faculty/faculty.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/faculty (matches @repo/api-client's FacultyApi paths exactly).
// Permission keys matched to prisma/seed.ts: faculty.view/create/edit/delete.

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
import type { FacultyDetail, FacultyResetPasswordResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { AuthIpRateLimitGuard } from "../auth/guards/auth-ip-rate-limit.guard";
import { FacultyService } from "./faculty.service";
import {
  CreateFacultyRequestSchema,
  type CreateFacultyRequest,
  UpdateFacultyRequestSchema,
  type UpdateFacultyRequest,
  ListFacultyQuerySchema,
  type ListFacultyQuery,
  type FacultySummary,
} from "./dto";

@Controller("crm/faculty")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class FacultyController {
  constructor(private readonly facultyService: FacultyService) {}

  @Get()
  @RequirePermission("faculty.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListFacultyQuerySchema)) query: ListFacultyQuery,
  ): Promise<PaginatedResult<FacultySummary>> {
    return this.facultyService.list(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("faculty.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<FacultyDetail> {
    return this.facultyService.getById(user.tenantId, user.id, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("faculty.create")
  @UsePipes(new ZodValidationPipe(CreateFacultyRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateFacultyRequest): Promise<FacultyDetail> {
    return this.facultyService.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("faculty.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateFacultyRequestSchema)) body: UpdateFacultyRequest,
  ): Promise<FacultyDetail> {
    return this.facultyService.update(user.tenantId, user.id, id, body);
  }

  @Delete(":id")
  @RequirePermission("faculty.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<FacultyDetail> {
    return this.facultyService.softDelete(user.tenantId, user.id, id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission("faculty.edit")
  async restore(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<FacultyDetail> {
    return this.facultyService.restore(user.tenantId, user.id, id);
  }

  /**
   * POST /crm/faculty/:id/reset-password — admin-triggered reset of a faculty member's CRM
   * login password, for a lost/forgotten/compromised credential. Reuses `faculty.edit` (the
   * existing gate for "mutates a faculty account state" — same permission `restore` above
   * uses) rather than a new one-off permission key. Mirrors
   * `POST /crm/students/:id/resend-credentials`.
   *
   * SECURITY: IP-rate-limited like every other credential-issuing route in this codebase
   * (login/refresh/otp/password-reset/student resend-credentials) — this one also triggers
   * an argon2 hash + an outbound email + a full session revocation per call.
   */
  @Post(":id/reset-password")
  @HttpCode(200)
  @RequirePermission("faculty.edit")
  @UseGuards(AuthIpRateLimitGuard)
  async resetPassword(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<FacultyResetPasswordResponse> {
    return this.facultyService.resetPassword(user.tenantId, user.id, id);
  }
}
