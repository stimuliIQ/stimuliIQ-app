// apps/api/src/modules/tickets/tickets.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Mounted at /api/v1/crm/tickets — staff-facing
// queue management. Three independently-gated mutation routes (see tickets.service.ts
// file header for why): PATCH (tickets.edit, status/priority), POST :id/assign
// (tickets.assign, assigneeId), POST :id/close (tickets.close, unconditional close).

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
} from "@nestjs/common";
import type { TicketDetail, TicketMessage } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { TicketsService } from "./tickets.service";
import {
  UpdateTicketRequestSchema,
  type UpdateTicketRequest,
  ListTicketsQuerySchema,
  type ListTicketsQuery,
  AddTicketMessageRequestSchema,
  type AddTicketMessageRequest,
  type TicketSummary,
} from "./dto";

@Controller("crm/tickets")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  @Get()
  @RequirePermission("tickets.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListTicketsQuerySchema)) query: ListTicketsQuery,
  ): Promise<PaginatedResult<TicketSummary>> {
    return this.service.list(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("tickets.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<TicketDetail> {
    return this.service.getById(user.tenantId, user.id, id, true);
  }

  @Patch(":id")
  @RequirePermission("tickets.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateTicketRequestSchema)) body: UpdateTicketRequest,
  ): Promise<TicketDetail> {
    return this.service.update(user.tenantId, user.id, id, body);
  }

  @Post(":id/assign")
  @HttpCode(200)
  @RequirePermission("tickets.assign")
  async assign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateTicketRequestSchema)) body: UpdateTicketRequest,
  ): Promise<TicketDetail> {
    return this.service.assign(user.tenantId, user.id, id, body.assigneeId ?? null);
  }

  @Post(":id/close")
  @HttpCode(200)
  @RequirePermission("tickets.close")
  async close(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<TicketDetail> {
    return this.service.close(user.tenantId, user.id, id);
  }

  @Post(":id/messages")
  @HttpCode(201)
  @RequirePermission("tickets.edit")
  async addMessage(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AddTicketMessageRequestSchema)) body: AddTicketMessageRequest,
  ): Promise<TicketMessage> {
    return this.service.addStaffMessage(user.tenantId, user.id, id, body);
  }
}
