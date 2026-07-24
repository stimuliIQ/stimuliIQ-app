// apps/api/src/main.ts
//
// Boot order matters:
//   1. OTel SDK starts first (must patch modules before they're required elsewhere).
//   2. Env validation runs and fails fast on missing/invalid required vars.
//   3. Sentry initializes (no-op without SENTRY_DSN).
//   4. Nest app boots with pino structured logging (see AppModule).
//   5. `correlationIdMiddleware` is the FIRST `app.use()` call below (Phase 7 WS-C,
//      docs/plans/phase-7.md task #9) — every `app.use()` call made here attaches to
//      the underlying Express stack immediately, before Nest's own module-registered
//      middleware (AuditContextMiddleware/CsrfMiddleware, and nestjs-pino's own
//      pino-http middleware) which is wired later during `app.listen()` → `init()`.
//      This guarantees `req.id` is already resolved by the time pino-http's `genReqId`
//      runs (see observability/logger.ts), so the response header, every log line, and
//      the RFC-7807 `traceId` for a request are always the same id (AC-44).
//
// Process-level Sentry capture: `uncaughtException`/`unhandledRejection` handlers are
// registered right after Sentry initializes so any truly unhandled error is reported
// (no-op when SENTRY_DSN is unset) before Node's default handling runs. Neither handler
// forcibly exits the process — this service's existing 5xx/exception path already
// recovers per-request; these are a last-resort observability net, not a crash policy
// change.
import "reflect-metadata";
import { startOtel } from "./observability/otel";

async function bootstrap(): Promise<void> {
  await startOtel();

  const { initSentry, captureException } = await import("./observability/sentry");
  initSentry();

  process.on("unhandledRejection", (reason: unknown) => {
    captureException(reason);
    console.error("[api] unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error: Error) => {
    captureException(error);
    console.error("[api] uncaught exception:", error);
  });

  const { validateEnv } = await import("./config/env");
  const env = validateEnv();

  const { NestFactory, Reflector } = await import("@nestjs/core");
  const { Logger } = await import("nestjs-pino");
  const { AppModule } = await import("./app.module");
  const cookieParser = (await import("cookie-parser")).default;
  const { HttpExceptionFilter } = await import("./common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = await import("./common/interceptors/envelope.interceptor");
  const { MetricsInterceptor } = await import("./common/interceptors/metrics.interceptor");
  const { correlationIdMiddleware } = await import("./common/middleware/correlation-id.middleware");

  const helmet = (await import("helmet")).default;

  // rawBody: true — required for POST /commerce/payments/webhook to receive
  // req.rawBody (Buffer) for Razorpay HMAC-SHA256 signature verification.
  // Without this, the raw body is consumed by JSON parsing before the webhook
  // controller can compute the signature (verifyWebhookSignature would always fail).
  // See: https://docs.nestjs.com/faq/raw-body
  // See: apps/api/src/modules/commerce/providers/payment/payment-provider.module.ts
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));

  // H-1 FIX: trust proxy — set to 1 (one trusted proxy hop) so Express/NestJS correctly
  // extracts req.ip from X-Forwarded-For when running behind a single ALB, Cloudflare
  // reverse proxy, or Vercel edge. Without this, req.ip is the proxy's IP rather than the
  // true client IP, making IP-keyed rate limiting (PublicBookingRateLimiter, login RL, etc.)
  // ineffective — all requests appear to come from the same proxy address.
  //
  // DEPLOYMENT NOTE: This value (1) assumes a single trusted proxy hop in front of this
  // service (e.g. one ALB, one Cloudflare entry, one Vercel edge). If your topology adds
  // another load-balancer hop, increment this to match the exact number of trusted hops so
  // X-Forwarded-For isn't spoofable by a client injecting extra entries.
  // Ref: https://expressjs.com/en/guide/behind-proxies.html
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  // Phase 7 WS-C (AC-44): MUST be the first `app.use()` call — see boot-order comment
  // at the top of this file for why this guarantees a single, consistent request id
  // across the response header, every log line, and the RFC-7807 error body.
  app.use(correlationIdMiddleware);

  app.use(
    // Wave 6 security audit M-2: baseline security headers (HSTS, X-Content-Type-Options:
    // nosniff, frame-ancestors, etc). This is a JSON API, not an HTML-rendering surface —
    // `web`/`lms`/`crm` own their own page CSP — so we keep `contentSecurityPolicy` on
    // with a minimal, non-breaking default (helmet's default directives are safe for a
    // pure-JSON API: no inline scripts/styles are ever served from here) rather than
    // disabling CSP outright.
    helmet({
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  // Order matters: MetricsInterceptor must see the FULL request lifecycle (including
  // whatever EnvelopeInterceptor/route handling does) to time it accurately, so it
  // wraps outermost; EnvelopeInterceptor (env-checked via `@SkipEnvelope()`) runs
  // innermost, closest to the handler's return value.
  app.useGlobalInterceptors(new MetricsInterceptor(), new EnvelopeInterceptor(new Reflector()));
  // /api-docs.json and /metrics are meta/infra endpoints — never versioned under
  // /api/v1. `/health` and `/health/ready` MOVED under /api/v1 in Phase 7 (WS-C,
  // docs/plans/phase-7.md task #9) to match the api-designer's OpenAPI registration and
  // typed SDK (packages/api-client/src/health/health.api.ts calls "/api/v1/health").
  app.setGlobalPrefix("api/v1", { exclude: ["metrics", "api-docs.json"] });

  // Wave 6 security audit M-1: credentialed CORS needs an EXPLICIT origin allowlist —
  // `origin: "*"` is rejected by browsers anyway when `credentials: true`, but more
  // importantly an explicit allowlist is the only safe pattern with cookie-based auth
  // (CLAUDE.md §1: "httpOnly cookie auth + CSRF"). Sourced from the three known first-
  // party app URLs already validated at boot (config/env.ts); any env var left at its
  // localhost default in non-local envs is the operator's problem, not this layer's —
  // we only filter out `undefined`/empty entries here, never widen to a wildcard.
  // EXTRA_CORS_ORIGINS: a comma-separated escape hatch for origins that aren't one of the
  // three first-party app URLs. It exists because the e2e suites serve the apps on their
  // OWN ports (apps/web/playwright.config.ts uses :3100 so it never collides with a dev
  // server on :3000) — without this, every BROWSER-side API call in those runs is
  // CORS-rejected, so client-island features (like the certificate Download button) could
  // not be tested at all. Still an explicit allowlist: unset in production, never a
  // wildcard, and each entry must be a full origin.
  const extraOrigins = (env.EXTRA_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const allowedOrigins = [env.WEB_APP_URL, env.LMS_APP_URL, env.CRM_APP_URL, ...extraOrigins].filter(
    (origin): origin is string => typeof origin === "string" && origin.length > 0,
  );
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // `Idempotency-Key` MUST be here — orders, payments, LMS progress mark-complete,
    // public enroll, and EMI mark-paid all send it from the browser on unsafe mutations
    // (grep "Idempotency-Key" packages/api-client/src). Omitting it CORS-preflight-rejects
    // every idempotent cross-origin mutation (QA defect: main.ts allowedHeaders).
    // `X-App-Audience` — each frontend declares which per-app session cookie slot its
    // requests use (auth/lib/cookies.ts dual-login fix); omitting it here would
    // CORS-preflight-reject every cross-origin request from the apps.
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-CSRF-Token", "Idempotency-Key", "X-App-Audience"],
  });

  await app.listen(env.API_PORT);
}

bootstrap().catch((error: unknown) => {
  // The Nest logger may not be available if bootstrap failed early, so use console directly.
  console.error("[api] fatal error during bootstrap:", error);
  process.exit(1);
});
