// apps/api/src/modules/enrollments/enrollments.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1). No business logic, no Prisma.
// Mounted at /api/v1/crm/enrollments (matches @repo/api-client's EnrollmentsApi paths
// exactly). Permission keys matched to prisma/seed.ts: enrollments.view/create/edit
// (no enrollments.delete is seeded in P1 — withdraw uses enrollments.edit).

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import type { Enrollment } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { EnrollmentsService } from "./enrollments.service";
import {
  CreateEnrollmentRequestSchema,
  type CreateEnrollmentRequest,
  MoveEnrollmentRequestSchema,
  type MoveEnrollmentRequest,
  WithdrawEnrollmentRequestSchema,
  type WithdrawEnrollmentRequest,
  ListEnrollmentsQuerySchema,
  type ListEnrollmentsQuery,
} from "./dto";

@Controller("crm/enrollments")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get()
  @RequirePermission("enrollments.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListEnrollmentsQuerySchema)) query: ListEnrollmentsQuery,
  ): Promise<PaginatedResult<Enrollment>> {
    return this.enrollmentsService.list(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("enrollments.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<Enrollment> {
    return this.enrollmentsService.getById(user.tenantId, user.id, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("enrollments.create")
  @UsePipes(new ZodValidationPipe(CreateEnrollmentRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateEnrollmentRequest): Promise<Enrollment> {
    return this.enrollmentsService.enroll(user.tenantId, user.id, body);
  }

  @Post(":id/move")
  @HttpCode(200)
  @RequirePermission("enrollments.edit")
  async move(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(MoveEnrollmentRequestSchema)) body: MoveEnrollmentRequest,
  ): Promise<Enrollment> {
    return this.enrollmentsService.move(user.tenantId, user.id, id, body);
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @RequirePermission("enrollments.edit")
  async withdraw(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(WithdrawEnrollmentRequestSchema)) body: WithdrawEnrollmentRequest,
  ): Promise<Enrollment> {
    return this.enrollmentsService.withdraw(user.tenantId, user.id, id, body);
  }
}
