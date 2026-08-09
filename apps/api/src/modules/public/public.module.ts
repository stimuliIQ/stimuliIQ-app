// apps/api/src/modules/public/public.module.ts
//
// Wires the PUBLIC catalog + funnel feature module (docs/04-trd-architecture.md §2.2 template).
//
// THREE controller classes in this module (ADR-0019 pattern):
//   PublicCatalogController       — anonymous reads (GET /public/programs, /public/programs/:slug)
//   PublicAnonymousWriteController — anonymous writes (leads, coupons/validate, register)
//   PublicEnrollController        — authenticated self-service funnel (JwtAuthGuard, no PermissionsGuard)
//
// CSRF EXCLUSIONS: anonymous endpoints (catalog reads + anonymous writes + register) are
//   excluded from CsrfMiddleware in app.module.ts (they have no session to protect).
//   The enroll funnel endpoints (P-7, P-8, P-9) ARE authenticated → NOT excluded → CSRF
//   cookie is issued at registration.
//
// CAPTCHA: PublicFunnelService injects CAPTCHA_PROVIDER via CaptchaProviderModule.
//   In dev/test: CAPTCHA_PROVIDER=noop → NoopCaptchaProvider (always passes).
//   In prod: CAPTCHA_PROVIDER=turnstile (fail-closed when CAPTCHA_SECRET_KEY absent).
//
// RATE LIMITING: PublicBookingRateLimiter is imported from LeadsModule's lib — same
//   Redis fixed-window pattern as PublicBookingsController (ADR-0019). All public
//   write endpoints share this limiter (keyed by IP + endpoint prefix).
//
// COMMERCE REUSE: CommerceService is imported (not re-instantiated) via CommerceModule.
//   CommerceService.createOrder / initiateRazorpayCheckout / verifyPayment are called
//   within scopeContextStorage.run() to set up the ALS scope context (own-scoped).
//   No money logic is duplicated here (ADR-0014, Risk #1 from phase-5.md).
//
// AUTH REUSE: AuthRepository + TokenService + OtpStore from AuthModule are imported
//   for the P-6 registration path (argon2id, OTP verify, session issuance).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommerceModule } from "../commerce/commerce.module";
import { CaptchaProviderModule } from "../captcha/providers/captcha/captcha-provider.module";
import { PublicCatalogController, PublicAnonymousWriteController, PublicEnrollController } from "./public.controller";
import { PublicCatalogService } from "./public-catalog.service";
import { PublicFunnelService } from "./public-funnel.service";
import { PublicRepository } from "./public.repository";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import { LeadsRepository } from "../leads/leads.repository";
import { VideoProviderModule } from "../lms/providers/video/video-provider.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    // AuthModule exports: AuthRepository, TokenService, JwtAuthGuard, PermissionsGuard
    AuthModule,
    // CommerceModule exports: CommerceService (reused for order/checkout/verify funnel)
    CommerceModule,
    // CaptchaProviderModule: binds CAPTCHA_PROVIDER token (Noop/Turnstile/FailClosed)
    CaptchaProviderModule,
    // VideoProviderModule: binds VIDEO_PROVIDER — the anonymous marketing-site
    // lesson preview mints signed playback URLs through the same provider seam the
    // enrolled LMS path uses (no second, weaker media path).
    VideoProviderModule,
    // NotificationsModule exports NotificationsService — PublicFunnelService rings the
    // bell of whichever rep the round-robin just handed an inbound website lead to.
    // Staff-facing only; no public visitor is ever notified through this seam.
    NotificationsModule,
  ],
  controllers: [
    PublicCatalogController,
    PublicAnonymousWriteController,
    PublicEnrollController,
  ],
  providers: [
    PublicCatalogService,
    PublicFunnelService,
    PublicRepository,
    // Rate limiter — same Redis fixed-window pattern as PublicBookingsController (ADR-0019)
    PublicBookingRateLimiter,
    // LeadsRepository — used for round-robin owner assignment in lead capture (P-3)
    LeadsRepository,
    // OtpStore is exported from AuthModule (imported above) — injectable here
  ],
  // Phase-9 Completion T30: exported so GrowthModule (per-city SEO + bundles/tracks
  // pricing) can reuse the SAME public-projection query/mapping (`getTenantIdBySlug`,
  // `listPublicPrograms` + `toSummary`'s forbidden-field discipline) instead of a
  // second, divergent public-projection implementation.
  exports: [PublicRepository, PublicCatalogService],
})
export class PublicModule {}
