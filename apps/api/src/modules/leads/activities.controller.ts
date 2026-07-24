// apps/api/src/modules/leads/activities.controller.ts
//
// HTTP boundary only. Mounted at /api/v1/crm/activities (matches @repo/api-client's
// ActivitiesApi paths). Permission keys: activities.view/create (seeded — see
// prisma/seed.ts P2_MODULES). There is no `activities.delete`/`activities.edit` seeded —
// activities are an append-only log; the only mutation besides create is /complete,
// which is gated on `activities.create` (completing a task is "creating" the completion
// fact on an existing record, consistent with the seeded permission catalog).

import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors, UsePipes } from "@nestjs/common";
import type { ActivityDetail } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ActivitiesService } from "./activities.service";
import {
  CreateActivityRequestSchema,
  type CreateActivityRequest,
  CompleteTaskRequestSchema,
  type CompleteTaskRequest,
  ListActivitiesQuerySchema,
  type ListActivitiesQuery,
} from "./dto";

@Controller("crm/activities")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @RequirePermission("activities.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListActivitiesQuerySchema)) query: ListActivitiesQuery,
  ): Promise<PaginatedResult<ActivityDetail>> {
    return this.activitiesService.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("activities.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<ActivityDetail> {
    return this.activitiesService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("activities.create")
  @UsePipes(new ZodValidationPipe(CreateActivityRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateActivityRequest): Promise<ActivityDetail> {
    return this.activitiesService.create(user.tenantId, user.id, body);
  }

  @Post(":id/complete")
  @HttpCode(200)
  @RequirePermission("activities.create")
  async complete(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(CompleteTaskRequestSchema)) body: CompleteTaskRequest,
  ): Promise<ActivityDetail> {
    return this.activitiesService.completeTask(user.tenantId, id, body);
  }
}
