// apps/api/src/modules/leads/bookings.controller.ts
//
// HTTP boundary only. TWO controllers in this file, matching the commerce module's
// WebhookController split (docs/04 §2.1 + commerce.controller.ts precedent):
//   - BookingsController  @Controller("crm/bookings")   — AUTHENTICATED, JwtAuthGuard +
//     PermissionsGuard + ScopeInterceptor. Permission keys: bookings.view/create/edit
//     (seeded — prisma/seed.ts P2_MODULES).
//   - PublicBookingsController @Controller("public/bookings") — UNAUTHENTICATED. There
//     is NO `@Public()` decorator in this codebase (confirmed: grep found no such
//     decorator anywhere) — the only existing precedent for an unguarded route is a
//     SEPARATE controller class with no `@UseGuards()` at all (commerce.controller.ts's
//     `WebhookController`). This controller follows that exact pattern. It is excluded
//     from CsrfMiddleware in app.module.ts (alongside the webhook route) since it has no
//     session/cookie to protect against CSRF in the first place, and is rate-limited per
//     IP via `PublicBookingRateLimiter` (Redis fixed-window, mirrors LoginRateLimiter).

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import type { BookingDetail, PublicBookingResponse } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { BookingsService } from "./bookings.service";
import { PublicBookingRateLimiter } from "./lib/public-booking-rate-limiter";
import {
  CreateBookingRequestSchema,
  type CreateBookingRequest,
  UpdateBookingRequestSchema,
  type UpdateBookingRequest,
  MoveBookingStatusRequestSchema,
  type MoveBookingStatusRequest,
  ListBookingsQuerySchema,
  type ListBookingsQuery,
  CreatePublicBookingRequestSchema,
  type CreatePublicBookingRequest,
} from "./dto";

@Controller("crm/bookings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @RequirePermission("bookings.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListBookingsQuerySchema)) query: ListBookingsQuery,
  ): Promise<PaginatedResult<BookingDetail>> {
    return this.bookingsService.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("bookings.view")
  async getById(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<BookingDetail> {
    return this.bookingsService.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("bookings.create")
  @UsePipes(new ZodValidationPipe(CreateBookingRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateBookingRequest): Promise<BookingDetail> {
    return this.bookingsService.create(user.tenantId, user.id, body);
  }

  @Patch(":id")
  @RequirePermission("bookings.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBookingRequestSchema)) body: UpdateBookingRequest,
  ): Promise<BookingDetail> {
    return this.bookingsService.update(user.tenantId, id, body);
  }

  @Patch(":id/status")
  @RequirePermission("bookings.edit")
  async moveStatus(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(MoveBookingStatusRequestSchema)) body: MoveBookingStatusRequest,
  ): Promise<BookingDetail> {
    return this.bookingsService.moveStatus(user.tenantId, user.id, id, body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC, UNAUTHENTICATED intake — separate controller, NO guards (see file header).
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/bookings")
export class PublicBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly rateLimiter: PublicBookingRateLimiter,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreatePublicBookingRequestSchema)) body: CreatePublicBookingRequest,
  ): Promise<PublicBookingResponse> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      throw new HttpException(
        { code: "public_bookings.rate_limited", title: "Too many requests", detail: "Please try again in a minute." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.bookingsService.createPublicBooking(body, ip);
  }
}
