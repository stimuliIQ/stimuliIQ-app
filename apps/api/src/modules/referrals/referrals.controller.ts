// apps/api/src/modules/referrals/referrals.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Three controller classes (ADR-0019 pattern,
// mirrors content-intake.controller.ts):
//   MyReferralsController     — own-scope (/me/referrals), JwtAuthGuard + PermissionsGuard.
//   PublicReferralsController — anonymous redeem (/public/referrals/redeem), NO guards.
//   CrmReferralsController    — staff oversight (/crm/referrals), JwtAuthGuard + PermissionsGuard.

import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Referral, RedeemReferralResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ReferralsService } from "./referrals.service";
import {
  CreateReferralRequestSchema,
  type CreateReferralRequest,
  ListReferralsQuerySchema,
  type ListReferralsQuery,
  RedeemReferralRequestSchema,
  type RedeemReferralRequest,
  UpdateReferralStatusRequestSchema,
  type UpdateReferralStatusRequest,
} from "./dto";

@Controller("me/referrals")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class MyReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Get()
  @RequirePermission("referrals.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListReferralsQuerySchema)) query: ListReferralsQuery,
  ): Promise<PaginatedResult<Referral>> {
    return this.service.listOwn(user.tenantId, user.id, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("referrals.create")
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateReferralRequestSchema)) body: CreateReferralRequest,
  ): Promise<Referral> {
    return this.service.createOwn(user.tenantId, user.id, body);
  }
}

@Controller("public/referrals")
export class PublicReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Post("redeem")
  @HttpCode(200)
  async redeem(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(RedeemReferralRequestSchema)) body: RedeemReferralRequest,
  ): Promise<RedeemReferralResponse> {
    return this.service.redeem(body, ip);
  }
}

@Controller("crm/referrals")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CrmReferralsController {
  constructor(private readonly service: ReferralsService) {}

  @Get()
  @RequirePermission("referrals.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListReferralsQuerySchema)) query: ListReferralsQuery,
  ): Promise<PaginatedResult<Referral>> {
    return this.service.listAll(user.tenantId, query);
  }

  @Patch(":id")
  @RequirePermission("referrals.approve")
  async updateStatus(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateReferralStatusRequestSchema)) body: UpdateReferralStatusRequest,
  ): Promise<Referral> {
    return this.service.updateStatus(user.tenantId, id, body);
  }
}
