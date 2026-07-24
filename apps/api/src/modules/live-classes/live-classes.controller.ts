// apps/api/src/modules/live-classes/live-classes.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). No business logic, no Prisma. Mounted at
// /api/v1/crm/live-classes — staff-facing schedule/update/cancel/list/get/join.
// Permission keys match prisma/seed.ts's P9_PERMISSIONS catalog: liveclass.view/create/
// edit/cancel/join.

import {
  Body,
  Controller,
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
import type { JoinLiveClassResponse, LiveClassDetail } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { LiveClassesService } from "./live-classes.service";
import {
  CreateLiveClassRequestSchema,
  type CreateLiveClassRequest,
  UpdateLiveClassRequestSchema,
  type UpdateLiveClassRequest,
  ListLiveClassesQuerySchema,
  type ListLiveClassesQuery,
  type LiveClassSummary,
} from "./dto";

@Controller("crm/live-classes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class LiveClassesController {
  constructor(private readonly service: LiveClassesService) {}

  @Get()
  @RequirePermission("liveclass.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListLiveClassesQuerySchema)) query: ListLiveClassesQuery,
  ): Promise<PaginatedResult<LiveClassSummary>> {
    return this.service.list(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("liveclass.view")
  async getById(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<LiveClassDetail> {
    return this.service.getById(user.tenantId, user.id, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("liveclass.create")
  @UsePipes(new ZodValidationPipe(CreateLiveClassRequestSchema))
  async schedule(@CurrentUser() user: RequestUser, @Body() body: CreateLiveClassRequest): Promise<LiveClassDetail> {
    return this.service.schedule(user.tenantId, user.id, body);
  }

  @Patch(":id")
  @RequirePermission("liveclass.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateLiveClassRequestSchema)) body: UpdateLiveClassRequest,
  ): Promise<LiveClassDetail> {
    return this.service.update(user.tenantId, user.id, id, body);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("liveclass.cancel")
  async cancel(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<LiveClassDetail> {
    return this.service.cancel(user.tenantId, user.id, id);
  }

  @Post(":id/join")
  @HttpCode(200)
  @RequirePermission("liveclass.join")
  async join(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<JoinLiveClassResponse> {
    return this.service.join(user.tenantId, user.id, id);
  }
}
