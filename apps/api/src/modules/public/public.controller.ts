// apps/api/src/modules/public/public.controller.ts
//
// PUBLIC catalog + funnel HTTP endpoints (docs/04-trd-architecture.md §2.1).
//
// Two controller classes in this file, matching the PublicBookingsController pattern
// (ADR-0019: "unauthenticated public endpoints use a SEPARATE controller class with NO
// guards"). This pattern is the established codebase convention for public endpoints.
//
// ─── PublicCatalogController @Controller("public") ───────────────────────────
//   GET  /public/programs             P-1: public program listing (anonymous)
//   GET  /public/programs/:slug       P-2: public program detail (anonymous)
//
// ─── PublicFunnelController @Controller("public") ────────────────────────────
//   POST /public/leads                P-3: lead capture (anonymous, captcha-gated)
//   POST /public/coupons/validate     P-5: coupon validation (anonymous, captcha-gated)
//   POST /public/register             P-6: self-service registration (anonymous → session)
//   POST /public/enroll/orders        P-7: order creation (authenticated student)
//   POST /public/enroll/checkout      P-8: Razorpay checkout (authenticated student)
//   POST /public/enroll/verify        P-9: payment verify + enrollment (authenticated student)
//
// SECURITY:
//   - P-1, P-2: NO guards, NO auth (public reads). CSRF-excluded.
//   - P-3, P-5, P-6: NO guards, NO auth. CSRF-excluded. Captcha-gated. Rate-limited.
//     Honeypot check (_hp_email field must be absent/empty — bots that fill it → 422).
//   - P-7, P-8, P-9: JwtAuthGuard (authenticated student). NO PermissionsGuard (own-scope
//     enforced directly in the service: order.studentId === req.user.id → else 404).
//     CSRF protection via the existing CsrfMiddleware (these ARE authenticated).
//   - All inputs validated via ZodValidationPipe (.strict() schemas strip extra fields).
//   - Rate limiting via PublicBookingRateLimiter (Redis fixed-window per IP, fail-closed).
//   - Input sanitized in the service (resolves P2 M-4).
//
// CSRF EXCLUSIONS (app.module.ts):
//   anonymous public writes (P-3, P-5, P-6) have no session → must be excluded from
//   CsrfMiddleware. The enroll funnel endpoints (P-7, P-8, P-9) DO have a session →
//   NOT excluded (CSRF cookie is set at registration).

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type {
  PublicProgramSummary,
  PublicProgramDetail,
  PublicLessonPreviewUrlResponse,
  ListPublicProgramsQuery,
  ListPublicMentorsQuery,
  PublicMentorCard,
  PublicLeadCaptureDto,
  PublicLeadCaptureResponse,
  PublicValidateCouponDto,
  PublicCouponDiscountResponse,
  PublicRegisterDto,
  PublicCreateOrderDto,
  PublicOrderResponse,
  PublicCheckoutDto,
  PublicCheckoutResponse,
  PublicPayLinkOrder,
  PublicVerifyPaymentDto,
  PublicVerifyPaymentResponse,
  AuthSessionData,
  PaginationMeta,
} from "@repo/types";
import {
  ListPublicProgramsQuerySchema,
  ListPublicMentorsQuerySchema,
  PublicLeadCaptureDtoSchema,
  PublicValidateCouponDtoSchema,
  PublicRegisterDtoSchema,
  PublicCreateOrderDtoSchema,
  PublicCheckoutDtoSchema,
  PublicVerifyPaymentDtoSchema,
} from "@repo/types";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { PublicCatalogService } from "./public-catalog.service";
import { PublicFunnelService } from "./public-funnel.service";
import { setAuthCookies } from "../auth/lib/cookies";

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public reads — NO guards, NO auth, CSRF-excluded via app.module.ts
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public")
export class PublicCatalogController {
  constructor(private readonly catalogService: PublicCatalogService) {}

  /** P-1: GET /public/programs — SEO catalog list (published + is_public only) */
  @Get("programs")
  async listPrograms(
    @Query(new ZodValidationPipe(ListPublicProgramsQuerySchema)) query: ListPublicProgramsQuery,
  ): Promise<PaginatedResult<PublicProgramSummary, PaginationMeta>> {
    const { items, nextCursor } = await this.catalogService.listPrograms(query);
    // Envelope contract (docs/04 §2.14): cursor lists carry { nextCursor, hasMore }
    // in `meta`, with `data` as the bare items array — the shape the SDK's
    // requestCursorPaginated() consumes. Returning the raw service object here
    // nested it under `data` and broke every SDK consumer (web /programs crash).
    return new PaginatedResult(items, { nextCursor, hasMore: nextCursor !== null });
  }

  /** GET /public/mentors — public mentors directory (active CRM mentors only) */
  @Get("mentors")
  async listMentors(
    @Query(new ZodValidationPipe(ListPublicMentorsQuerySchema)) query: ListPublicMentorsQuery,
  ): Promise<PaginatedResult<PublicMentorCard, PaginationMeta>> {
    const { items, nextCursor } = await this.catalogService.listMentors(query);
    return new PaginatedResult(items, { nextCursor, hasMore: nextCursor !== null });
  }

  /** GET /public/mentors/:id — single active mentor's public profile (404 otherwise). */
  @Get("mentors/:id")
  async getMentorById(@Param("id", new ParseUUIDPipe()) id: string): Promise<PublicMentorCard> {
    return this.catalogService.getMentorById(id);
  }

  /** P-2: GET /public/programs/:slug — program detail (draft → 404, AC-25) */
  @Get("programs/:slug")
  async getProgramBySlug(@Param("slug") slug: string): Promise<PublicProgramDetail> {
    return this.catalogService.getProgramBySlug(slug);
  }

  /**
   * GET /public/programs/:slug/lessons/:lessonId/preview-url
   *
   * ANONYMOUS "watch before you enrol" playback. Every gate lives in the service /
   * repository query: public+published program, `is_preview` lesson, `ready` video.
   * Anything else → 404 (no existence disclosure). Returns a SHORT-TTL SIGNED url;
   * the provider asset id / storage key never leave the server.
   */
  @Get("programs/:slug/lessons/:lessonId/preview-url")
  async getLessonPreviewUrl(
    @Param("slug") slug: string,
    @Param("lessonId", new ParseUUIDPipe()) lessonId: string,
  ): Promise<PublicLessonPreviewUrlResponse> {
    return this.catalogService.getLessonPreviewUrl(slug, lessonId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public writes — NO guards, NO auth, CSRF-excluded via app.module.ts
// Captcha-gated + rate-limited + honeypot-checked + .strict() validated
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public")
export class PublicAnonymousWriteController {
  constructor(private readonly funnelService: PublicFunnelService) {}

  /** P-3: POST /public/leads — lead capture */
  @Post("leads")
  @HttpCode(HttpStatus.CREATED)
  async createLead(
    @Ip() ip: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(PublicLeadCaptureDtoSchema)) body: PublicLeadCaptureDto,
  ): Promise<PublicLeadCaptureResponse> {
    // Honeypot: reject if _hp_email is non-empty (AC-42).
    // The field is in the HTML form (hidden via CSS); bots populate it; humans don't.
    // .strict() ensures _hp_email is stripped from the validated body, but we check
    // the raw body before validation.
    const rawBody = req.body as Record<string, unknown>;
    if (rawBody["_hp_email"] && String(rawBody["_hp_email"]).trim().length > 0) {
      // Silent reject — no information leaks to the bot (AC-42)
      throw new UnprocessableEntityException({
        code: "public.validation_error",
        title: "Validation failed",
        detail: "Request could not be processed.",
      });
    }

    // Captcha verification (fail-closed in prod, AC-3, AC-44)
    await this.funnelService.verifyCaptcha(body.captchaToken, ip);

    // Rate limit per IP (fail-closed on Redis error, AC-4, AC-43)
    await this.funnelService.checkRateLimit(ip, "public.leads.rate_limited");

    return this.funnelService.createLead(body, ip);
  }

  // ─── Pay-link flow (lifecycle-redesign): token-authorized checkout ─────────
  //
  // NO captcha: the HMAC-signed token (minted by staff via POST /commerce/orders/
  // :id/payment-link) is a far stronger gate than a captcha — unguessable, expiring,
  // single-order-scoped. Rate-limited per IP as defense-in-depth against token
  // brute-force (a 256-bit HMAC makes that theoretical, but limits are cheap).

  /** GET /public/pay/:token — order summary for the public pay page. */
  @Get("pay/:token")
  async getPayLinkOrder(@Ip() ip: string, @Param("token") token: string): Promise<PublicPayLinkOrder> {
    await this.funnelService.checkRateLimit(ip, "public.pay.rate_limited");
    return this.funnelService.getPayLinkOrder(token);
  }

  /** POST /public/pay/:token/checkout — Razorpay checkout bootstrap (PUBLIC keyId only). */
  @Post("pay/:token/checkout")
  @HttpCode(HttpStatus.OK)
  async payLinkCheckout(@Ip() ip: string, @Param("token") token: string): Promise<PublicCheckoutResponse> {
    await this.funnelService.checkRateLimit(ip, "public.pay.rate_limited");
    return this.funnelService.initiateCheckoutByPayLink(token);
  }

  /** POST /public/pay/:token/verify — signature verify + atomic enrollment. */
  @Post("pay/:token/verify")
  @HttpCode(HttpStatus.OK)
  async payLinkVerify(
    @Ip() ip: string,
    @Param("token") token: string,
    @Body(new ZodValidationPipe(PublicVerifyPaymentDtoSchema)) body: PublicVerifyPaymentDto,
  ): Promise<PublicVerifyPaymentResponse> {
    await this.funnelService.checkRateLimit(ip, "public.pay.rate_limited");
    return this.funnelService.verifyPaymentByPayLink(token, body);
  }

  /** P-5: POST /public/coupons/validate — public coupon preview (no internals leaked) */
  @Post("coupons/validate")
  @HttpCode(HttpStatus.OK)
  async validateCoupon(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(PublicValidateCouponDtoSchema)) body: PublicValidateCouponDto,
  ): Promise<PublicCouponDiscountResponse> {
    // Captcha-gated to prevent coupon enumeration (AC-11, AC-44)
    await this.funnelService.verifyCaptcha(body.captchaToken, ip);

    // Rate limit per IP (AC-11, AC-43)
    await this.funnelService.checkRateLimit(ip, "public.coupons.rate_limited");

    return this.funnelService.validateCoupon(body, ip);
  }

  /** P-6: POST /public/register — self-service account creation */
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Ip() ip: string,
    @Req() req: Request,
    @Body(new ZodValidationPipe(PublicRegisterDtoSchema)) body: PublicRegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionData> {
    // Honeypot check (AC-42)
    const rawBody = req.body as Record<string, unknown>;
    if (rawBody["_hp_email"] && String(rawBody["_hp_email"]).trim().length > 0) {
      throw new UnprocessableEntityException({
        code: "public.validation_error",
        title: "Validation failed",
        detail: "Request could not be processed.",
      });
    }

    // Captcha-gated (AC-14, AC-44)
    await this.funnelService.verifyCaptcha(body.captchaToken, ip);

    // Rate limit (AC-15, AC-43)
    await this.funnelService.checkRateLimit(ip, "public.register.rate_limited");

    const { session, tokens } = await this.funnelService.register(body, ip);

    // Issue auth cookies ONLY for a genuinely new account (tokens present). For an
    // existing email the service returns NO tokens (C-1 account-takeover guard) — we set
    // no cookies, so the response is 201-shaped but grants no session.
    if (tokens) {
      // Registration creates a STUDENT session — store it in the "lms" cookie slot so
      // the web funnel and the LMS app (which declares X-App-Audience: lms) share it,
      // and it can coexist with a staff CRM session in the same browser (cookies.ts).
      setAuthCookies(res, tokens, "lms");
    }

    return session;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED self-service enroll funnel — JwtAuthGuard only (no PermissionsGuard).
// Own-scope enforced in the service layer (AC-22: IDOR→404).
// CSRF protection via CsrfMiddleware (NOT excluded — session is set at registration).
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/enroll")
@UseGuards(JwtAuthGuard)
export class PublicEnrollController {
  constructor(private readonly funnelService: PublicFunnelService) {}

  /** P-7: POST /public/enroll/orders — self-service order create (idempotent) */
  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  async createOrder(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Body(new ZodValidationPipe(PublicCreateOrderDtoSchema)) body: PublicCreateOrderDto,
  ): Promise<PublicOrderResponse> {
    // Idempotency-Key header (required for idempotent order creation, AC-17)
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new UnprocessableEntityException({
        code: "public.missing_idempotency_key",
        title: "Idempotency-Key header required",
        detail: "Please provide an Idempotency-Key header (e.g. a client-generated UUID).",
      });
    }

    return this.funnelService.createEnrollOrder(body, user.id, user.tenantId, idempotencyKey);
  }

  /** P-8: POST /public/enroll/checkout — Razorpay checkout (returns PUBLIC keyId only) */
  @Post("checkout")
  @HttpCode(HttpStatus.OK)
  async checkout(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(PublicCheckoutDtoSchema)) body: PublicCheckoutDto,
  ): Promise<PublicCheckoutResponse> {
    // Own-scope IDOR check is inside funnelService.initiateCheckout (AC-22)
    return this.funnelService.initiateCheckout(body, user.id, user.tenantId);
  }

  /** P-9: POST /public/enroll/verify — signature verify + atomic enrollment (AC-16..AC-20) */
  @Post("verify")
  @HttpCode(HttpStatus.OK)
  async verifyPayment(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(PublicVerifyPaymentDtoSchema)) body: PublicVerifyPaymentDto,
  ): Promise<PublicVerifyPaymentResponse> {
    // Own-scope IDOR check + idempotency is inside funnelService.verifyPayment (AC-22, AC-18)
    return this.funnelService.verifyPayment(body, user.id, user.tenantId);
  }
}
