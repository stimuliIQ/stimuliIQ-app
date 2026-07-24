// apps/api/src/modules/tickets/canned-responses.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Mounted at /api/v1/crm/canned-responses —
// support-staff CRUD (all scope). Permission: canned_responses.manage (single key for
// every action, per prisma/seed.ts's P9 catalog).

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
import { CannedResponsesService } from "./canned-responses.service";
import {
  CreateCannedResponseRequestSchema,
  type CreateCannedResponseRequest,
  UpdateCannedResponseRequestSchema,
  type UpdateCannedResponseRequest,
  ListCannedResponsesQuerySchema,
  type ListCannedResponsesQuery,
  type CannedResponse,
} from "./dto";

@Controller("crm/canned-responses")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CannedResponsesController {
  constructor(private readonly service: CannedResponsesService) {}

  @Get()
  @RequirePermission("canned_responses.manage")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCannedResponsesQuerySchema)) query: ListCannedResponsesQuery,
  ): Promise<PaginatedResult<CannedResponse>> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("canned_responses.manage")
  @UsePipes(new ZodValidationPipe(CreateCannedResponseRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateCannedResponseRequest): Promise<CannedResponse> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("canned_responses.manage")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCannedResponseRequestSchema)) body: UpdateCannedResponseRequest,
  ): Promise<CannedResponse> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("canned_responses.manage")
  async remove(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}
