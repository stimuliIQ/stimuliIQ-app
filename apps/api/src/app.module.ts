// apps/api/src/app.module.ts
//
// Root module. Wires (in addition to observability/health, which already existed):
//   - PrismaModule / RedisModule — global infra modules (data access, cache/session/OTP).
//   - AuthModule — login/refresh/logout/otp/me, guards, decorators (docs/plans/phase-0.md #8).
//   - OpenApiModule — serves the live OpenAPI 3.1 document at GET /api-docs.json.
//   - AuditContextMiddleware + CsrfMiddleware — registered via `configure()` below, in
//     that order, across every route. AuditContextMiddleware resolves req.user itself
//     (see common/middleware/audit-context.middleware.ts) so by the time CsrfMiddleware
//     and any guard/controller code runs, the AsyncLocalStorage audit context already
//     carries actorId/tenantId for any Prisma mutation fired downstream.
//   - MustChangePasswordGuard — registered as a GLOBAL `APP_GUARD` (gap-closing pass,
//     see that guard's own header). Reads `req.user.mustChangePassword` (populated by
//     AuditContextMiddleware, same as above) so it works on every route without touching
//     the ~66 existing per-controller `@UseGuards(JwtAuthGuard, ...)` lists.

import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { loggerModuleOptions } from "./observability/logger";
import { HealthModule } from "./modules/health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./modules/auth/auth.module";
import { OpenApiModule } from "./modules/openapi/openapi.module";
import { StudentsModule } from "./modules/students/students.module";
import { FacultyModule } from "./modules/faculty/faculty.module";
import { CoursesModule } from "./modules/courses/courses.module";
import { BatchesModule } from "./modules/batches/batches.module";
import { EnrollmentsModule } from "./modules/enrollments/enrollments.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CommonScopeModule } from "./modules/common-scope/common-scope.module";
import { AuditContextMiddleware } from "./common/middleware/audit-context.middleware";
import { CsrfMiddleware } from "./common/middleware/csrf.middleware";
import { MustChangePasswordGuard } from "./modules/auth/guards/must-change-password.guard";
import { CommerceModule } from "./modules/commerce/commerce.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { LmsModule } from "./modules/lms/lms.module";
import { AssignmentsModule } from "./modules/assignments/assignments.module";
import { AssessmentsModule } from "./modules/assessments/assessments.module";
import { CertificatesModule } from "./modules/certificates/certificates.module";
import { PublicModule } from "./modules/public/public.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { GamificationModule } from "./modules/gamification/gamification.module";
import { ForumModule } from "./modules/forum/forum.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { ExportsModule } from "./modules/exports/exports.module";
import { ReportSchedulesModule } from "./modules/exports/report-schedules/report-schedules.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { DpdpModule } from "./modules/dpdp/dpdp.module";
import { MentorsModule } from "./modules/mentors/mentors.module";
import { StorageModule } from "./modules/storage/storage.module";
import { LiveClassesModule } from "./modules/live-classes/live-classes.module";
import { TicketsModule } from "./modules/tickets/tickets.module";
import { ContentModule } from "./modules/content/content.module";
// Hiring (ADR-0066): CRM-managed job openings, the public apply flow and the four-verb
// application review. Split out of ContentModule because it holds candidate PII and has its
// own permission boundary — see careers.module.ts.
import { CareersModule } from "./modules/careers/careers.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { ReferralsModule } from "./modules/referrals/referrals.module";
import { EmiModule } from "./modules/emi/emi.module";
import { BookmarksModule } from "./modules/bookmarks/bookmarks.module";
import { LessonNotesModule } from "./modules/lesson-notes/lesson-notes.module";
import { SearchModule } from "./modules/search/search.module";
import { BulkActionsModule } from "./modules/bulk-actions/bulk-actions.module";
import { GrowthModule } from "./modules/growth/growth.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { LeaveModule } from "./modules/leave/leave.module";
import { MarketingTargetsModule } from "./modules/marketing-targets/marketing-targets.module";
import { CourseTypesModule } from "./modules/course-types/course-types.module";
import { OrgModule } from "./modules/org/org.module";

@Module({
  imports: [
    LoggerModule.forRoot(loggerModuleOptions),
    // `ScheduleModule.forRoot()` is `global: true` (provides `SchedulerRegistry`
    // tenant-wide) — registered ONCE here for every Phase-7 Wave-2 cron consumer
    // (AnalyticsMvRefreshScheduler, ReportScheduleDispatchScheduler). Registering the
    // module does NOT itself start any timer — each consumer's own `onModuleInit()`
    // decides whether to call `SchedulerRegistry.addInterval()`, gated by
    // `isSchedulerEnabled()` (config/scheduler.ts) so cron NEVER fires during unit tests.
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthModule,
    OpenApiModule,
    HealthModule,
    StudentsModule,
    FacultyModule,
    CoursesModule,
    BatchesModule,
    EnrollmentsModule,
    AdminModule,
    AuditModule,
    CommonScopeModule,
    CommerceModule,
    LeadsModule,
    LmsModule,
    AssignmentsModule,
    AssessmentsModule,
    CertificatesModule,
    PublicModule,
    // P6 WS-1: Notifications core (fan-out engine, SSE stream, prefs, unsubscribe)
    NotificationsModule,
    // P6 WS-2: Campaigns (CRM bulk email/WhatsApp/SMS, consent-gated, HMAC webhook)
    CampaignsModule,
    // P6 WS-3: Gamification (points/badges/streaks, opt-in PII-minimal leaderboard)
    GamificationModule,
    // P6 WS-4: Forum / Community (enrollment-scoped threads/posts, moderation, reply-notify)
    ForumModule,
    // P7 WS-A: Analytics KPI dashboards (revenue/enrollment/funnel/attendance/engagement/
    // campaigns/gamification/forum-health), materialized-view-backed, RBAC + scope enforced.
    AnalyticsModule,
    // P7 WS-B: on-demand CSV/PDF exports (reports/entity-list), signed download links,
    // CSV-injection-safe shared csvSafeCell() choke-point, export audit logging.
    ExportsModule,
    // P7 Wave 2 task #11: recurring report-email schedules (CRUD) + the dispatch cron
    // that re-evaluates the creator's CURRENT scope at send time (AC-37).
    ReportSchedulesModule,
    // P7 WS-C: Prometheus RED/USE metrics scrape endpoint (GET /metrics, token-gated,
    // excluded from the api/v1 prefix and the envelope — see main.ts).
    MetricsModule,
    // P7 Wave 2 security hardening batch B, item 13: DPDP erasure — admin-only, audited
    // redaction of a subject's PII inside existing audit_logs snapshots (AC-64/65/66).
    DpdpModule,
    // Phase-8 Mentor (human, externally-hired batch lead — docs/specs/phase-8-mentor.md):
    // mentor hiring-record CRUD, batch<->mentor M:N assignment, internship-completion
    // rollup (reuses the P4 certificate-eligibility engine verbatim) + mark-complete
    // transition, and the scoped mentor-facing dashboard (GET /me/mentor/dashboard).
    MentorsModule,
    StorageModule,
    // Phase-9 Completion T20: Live Class scheduling/join (CRM + LMS) + provider webhook
    // (recording/attendance events) + BullMQ-gated reminders.
    LiveClassesModule,
    // Phase-9 Completion T21: Support desk — tickets/SLA/canned responses/knowledge base
    // (CRM + LMS + public read).
    TicketsModule,
    // Phase-9 Completion T22: Headless content API — blog/testimonials/partners/faculty
    // bios/pages (CRM CRUD + public published-only read) + intake forms (newsletter/
    // contact/careers).
    ContentModule,
    CareersModule,
    // Phase-9 Completion T23: Feature flags (admin CRUD + any-authenticated cached
    // evaluate) + system/company settings (admin CRUD).
    PlatformModule,
    // Phase-9 Completion T25: Referrals/affiliate program (own-scope link generation,
    // anonymous redeem, CRM oversight + reward-status transitions).
    ReferralsModule,
    // Phase-9 Completion T24: EMI plans + dunning (server-computed installment
    // schedule, Razorpay TEST charge per installment, BullMQ-gated dunning reminders
    // + auto-dunning scheduler).
    EmiModule,
    // Phase-9 Completion T29: own-scope LMS bookmarks (polymorphic ref_type/ref_id).
    BookmarksModule,
    // Phase-9 Completion T29: own-scope LMS lesson notes (enrollment-gated).
    LessonNotesModule,
    // Phase-9 Completion T29: global search (lessons/resources/forum threads),
    // own-enrolled scope, Postgres tsvector-backed.
    SearchModule,
    // Phase-9 Completion T30: bulk actions (leads/students, per-row scope-checked +
    // audited) + saved views (own-scope, Setting-table backed).
    BulkActionsModule,
    // Phase-9 Completion T30: per-city SEO data + bundles/tracks pricing — public
    // read endpoints derived from existing Program/Branch data (no new schema).
    GrowthModule,
    // Student onboarding form (stimuliiq.com/onboarding): a CRM-authored question set
    // (staff add/edit/reorder fields — no deploy) and the anonymous submissions it
    // collects, surfaced in the CRM under Onboarding.
    OnboardingModule,
    LeaveModule,
    MarketingTargetsModule,
    CourseTypesModule,
    OrgModule,
  ],
  providers: [
    AuditContextMiddleware,
    CsrfMiddleware,
    // Depends only on `Reflector` (a globally-available @nestjs/core provider), so no
    // module import is needed here beyond the class itself.
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // AuditContextMiddleware runs on all routes — populates ALS context for audit logs.
    consumer.apply(AuditContextMiddleware).forRoutes("*");

    // CsrfMiddleware runs on all routes EXCEPT the Razorpay webhook and the public
    // booking intake. Both are called by parties with no browser session/CSRF cookie:
    // the webhook is authenticated via HMAC-SHA256 signature, and the public booking
    // intake is an intentionally unauthenticated anonymous-visitor endpoint (rate-limited
    // per IP instead — see PublicBookingRateLimiter). The exclusion uses `exclude()`
    // which matches against the full route path pattern.
    consumer
      .apply(CsrfMiddleware)
      .exclude(
        "commerce/payments/webhook",
        "public/bookings",
        // DEV "local" storage provider upload: PUT is authenticated by the HMAC signature
        // in the signed URL (a bearer credential), not a browser session — same posture as
        // the webhooks below. Inert unless STORAGE_PROVIDER=local.
        "storage/local/(.*)",
        // LMS transcode-status webhook: authenticated via HMAC signature, not browser session.
        "lms/videos/webhook",
        // Phase-9 T20: live-class provider webhook (recording/attendance events) —
        // authenticated via HMAC signature, not browser session.
        "live-classes/webhook",
        // P5 public catalog reads — no session, no CSRF needed.
        "public/programs",
        { path: "public/programs/:slug", method: 0 /* RequestMethod.GET */ },
        // P5 anonymous writes — no browser session pre-auth; captcha + rate-limit instead.
        // POST /public/leads (lead capture)
        // POST /public/coupons/validate (coupon preview)
        // POST /public/register (registration → issues session, but the initial POST has none)
        "public/leads",
        "public/coupons/validate",
        "public/register",
        // Pay-link flow (lifecycle-redesign): called from an email/WhatsApp link with
        // no browser session — the HMAC-signed pay token IS the auth (same posture as
        // unsubscribe/:token below). GET pay/:token needs no exclusion (safe method);
        // the checkout/verify POSTs do.
        "public/pay/:token/checkout",
        "public/pay/:token/verify",
        // Phase-9 T22: anonymous content-intake writes — no browser session pre-auth;
        // captcha + rate-limit instead (same posture as public/leads).
        "public/newsletter/subscribe",
        { path: "public/newsletter/unsubscribe", method: 0 /* RequestMethod.GET */ },
        "public/contact",
        "public/careers/apply",
        // Phase-9-completion gap #3: anonymous resume-upload-url mint — same posture
        // as public/careers/apply (no browser session pre-auth; captcha + rate-limit).
        "public/careers/resume-upload-url",
        // Student onboarding form (stimuliiq.com/onboarding): anonymous submit + the
        // signed-upload mint for its file answers (the payment receipt). Same posture as
        // public/careers/* — no browser session exists, so captcha + per-IP rate limiting
        // are the gate. GET public/onboarding/form needs no exclusion (safe method).
        "public/onboarding/submit",
        "public/onboarding/upload-url",
        // Phase-9-completion gap #1: anonymous landing-page render + lead-form config
        // read are GET-only (no CSRF exclusion needed — CsrfMiddleware only guards
        // unsafe methods), included here only as a documentation anchor.
        // "public/landing-pages/:slug", "public/lead-forms/:key" — GET, no exclusion needed.
        // NOTE: public/enroll/* (P-7, P-8, P-9) are NOT excluded — they are authenticated
        // (JwtAuthGuard) and the CSRF cookie is issued at registration.
        //
        // P6 WS-1: Public unsubscribe endpoints — no browser session; HMAC-token protected.
        // GET /unsubscribe/:token  — preview page (safe GET, state-read only)
        // POST /unsubscribe/:token — submit unsubscribe (state change; authenticated via HMAC)
        // These are called from email links with no CSRF cookie. The HMAC token is the auth.
        { path: "unsubscribe/:token", method: 0 /* RequestMethod.GET */ },
        "unsubscribe/:token",
        // P6 WS-2: Campaign provider webhooks (Resend/Meta) — no browser session;
        // HMAC-verified (fail-closed) in CampaignWebhookController. POST only.
        "campaigns/webhooks/:channel",
        // Phase-9 T25: anonymous referral-code redemption — no browser session
        // pre-auth (called right after public/leads); rate-limited instead.
        "public/referrals/redeem",
        // Phase-9 T28 (B9): password-reset — no session exists yet (same posture as
        // public/register); rate-limited instead.
        "auth/password-reset/request",
        "auth/password-reset/confirm",
        // Phase-9 T28: 2FA login-verify — the second step of a 2FA login, no session
        // exists yet either (mirrors POST /auth/login itself, which is also
        // pre-session — CSRF only protects routes a browser ALREADY has a session
        // cookie for; IP-rate-limited instead, same as /auth/login).
        "auth/2fa/login-verify",
        // 2FA recovery ("lost my authenticator") — same pre-session posture as the two
        // password-reset routes above: the caller cannot complete a login, so no CSRF
        // cookie exists to check. Both are IP-rate-limited (AuthIpRateLimitGuard) AND
        // per-email rate-limited inside TwoFactorRecoveryService.
        "auth/2fa/recovery/request",
        "auth/2fa/recovery/confirm",
      )
      .forRoutes("*");
  }
}
