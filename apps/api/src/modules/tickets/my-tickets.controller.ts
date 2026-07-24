// apps/api/src/modules/tickets/my-tickets.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Mounted at /api/v1/me/tickets — the student-facing
// raise/view/reply/rate surface. Own-scope, IDOR->404 (never a broader 403 that would
// confirm another user's ticket exists). `isInternal` messages are NEVER returned here —
// TicketsService.getMine/addMyMessage always pass `includeInternal=false`.

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
import type { TicketDetail } from "@repo/types";
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
  CreateTicketRequestSchema,
  type CreateTicketRequest,
  ListMyTicketsQuerySchema,
  type ListMyTicketsQuery,
  AddTicketMessageRequestSchema,
  type AddTicketMessageRequest,
  RateTicketRequestSchema,
  type RateTicketRequest,
  type TicketSummary,
} from "./dto";

@Controller("me/tickets")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MyTicketsController {
  constructor(private readonly service: TicketsService) {}

  @Get()
  @RequirePermission("tickets.view")
  async listMine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListMyTicketsQuerySchema)) query: ListMyTicketsQuery,
  ): Promise<PaginatedResult<TicketSummary>> {
    return this.service.listMine(user.tenantId, user.id, query);
  }

  @Get(":id")
  @RequirePermission("tickets.view")
  async getMine(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<TicketDetail> {
    return this.service.getMine(user.tenantId, user.id, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("tickets.create")
  @UsePipes(new ZodValidationPipe(CreateTicketRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateTicketRequest): Promise<TicketDetail> {
    return this.service.create(user.tenantId, user.id, body);
  }

  @Post(":id/messages")
  @HttpCode(201)
  @RequirePermission("tickets.view")
  async addMessage(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AddTicketMessageRequestSchema)) body: AddTicketMessageRequest,
  ): Promise<TicketDetail> {
    return this.service.addMyMessage(user.tenantId, user.id, id, body);
  }

  @Post(":id/rate")
  @HttpCode(200)
  @RequirePermission("tickets.view")
  async rate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RateTicketRequestSchema)) body: RateTicketRequest,
  ): Promise<TicketDetail> {
    return this.service.rate(user.tenantId, user.id, id, body);
  }
}
