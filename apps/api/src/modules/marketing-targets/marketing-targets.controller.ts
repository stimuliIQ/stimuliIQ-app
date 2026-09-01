// apps/api/src/modules/marketing-targets/marketing-targets.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3) — validate, delegate, return a DTO.
//
// TWO controllers, split by AUDIENCE rather than by resource — the same shape as
// leave.controller.ts:
//
//   MyMarketingTargetController — what a marketing person sees: their own number and their
//       own progress. Gated on `marketing_targets.view`, which the marketing role holds at
//       scope `own`. The endpoint takes NO user id: the subject is always the session user,
//       so there is no parameter to tamper with and no IDOR surface at all.
//
//   MarketingTargetsAdminController — setting the numbers and reading the team report.
//       Gated on `marketing_targets.manage`, seeded to super_admin ALONE outside the
//       permission catalog the admin catch-all iterates (prisma/seed.ts). Deciding the
//       number somebody is judged against is the owner's call, not every operational
//       admin's — the same reasoning as `leave.approve`.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  MarketingTargetProgress,
  MarketingTargetsListDto,
  MarketingTargetsQuery,
  MyMarketingTargetDto,
  UpsertMarketingTargetRequest,
} from "@repo/types";
import { MarketingTargetsQuerySchema, UpsertMarketingTargetRequestSchema } from "@repo/types";

import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import type { RequestUser } from "../auth/lib/request-user";
import { MarketingTargetsService } from "./marketing-targets.service";

@Controller("crm/marketing-targets")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MyMarketingTargetController {
  constructor(private readonly service: MarketingTargetsService) {}

  /**
   * The signed-in person's own target and progress for a month (default: this month).
   *
   * Deliberately NOT `/crm/marketing-targets/:userId`. Reading somebody else's number is the
   * admin list endpoint's job, behind a different permission; keeping the subject implicit
   * here means the own-scope path has nothing to authorise beyond "are you signed in".
   */
  @Get("me")
  @RequirePermission("marketing_targets.view")
  async mine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(MarketingTargetsQuerySchema)) query: MarketingTargetsQuery,
  ): Promise<MyMarketingTargetDto> {
    return this.service.getMine(user.tenantId, user.id, query.month);
  }
}

@Controller("crm/marketing-targets")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MarketingTargetsAdminController {
  constructor(private readonly service: MarketingTargetsService) {}

  /** The whole team for one month: every targetable person, their number, their progress. */
  @Get()
  @RequirePermission("marketing_targets.manage")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(MarketingTargetsQuerySchema)) query: MarketingTargetsQuery,
  ): Promise<MarketingTargetsListDto> {
    return this.service.list(user.tenantId, query.month);
  }

  /**
   * PUT, not POST — "the target for Rahul in March" is one fact, so setting it is
   * idempotent. A create/edit split would make the caller check whether it exists first and
   * race with anyone else doing the same.
   */
  @Put()
  @RequirePermission("marketing_targets.manage")
  async upsert(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UpsertMarketingTargetRequestSchema)) body: UpsertMarketingTargetRequest,
  ): Promise<MarketingTargetProgress> {
    return this.service.upsert(user.tenantId, user.id, body);
  }

  @Delete(":id")
  @RequirePermission("marketing_targets.manage")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.remove(user.tenantId, id);
  }
}
