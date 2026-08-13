// apps/api/src/config/env.ts
//
// Boots-fails-fast env validation (CLAUDE.md §3.12, docs/04-trd-architecture.md §4).
// Required vars are blocking (DATABASE_URL, REDIS_URL, JWT key paths, cookie/CSRF
// secrets, app URLs). Vendor/provider keys are DEFERRED in Phase 0 — they are optional
// here and consumed by provider adapters later (CLAUDE.md §1, docs/plans/phase-0.md
// "Secrets the user must supply").

import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const rawEnvSchema = z.object({
  // --- App ---
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
  API_PORT: z.coerce.number().int().positive().default(4000),

  // --- CORS / app URLs (web, lms, crm) ---
  WEB_APP_URL: z.string().url().default("http://localhost:3000"),
  LMS_APP_URL: z.string().url().default("http://localhost:3001"),
  CRM_APP_URL: z.string().url().default("http://localhost:3002"),

  /**
   * Comma-separated EXTRA browser origins allowed by CORS, beyond the three app URLs.
   * Used by the e2e suites, which serve the apps on their own ports (see main.ts).
   * Leave UNSET in production.
   */
  EXTRA_CORS_ORIGINS: z.string().optional(),

  // --- Database (Postgres 16 via Prisma) ---
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // --- Redis (cache + sessions + BullMQ) ---
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // --- JWT (RS256 access 15m + rotating refresh 7d, CLAUDE.md §1) ---
  JWT_PRIVATE_KEY_PATH: z.string().min(1, "JWT_PRIVATE_KEY_PATH is required"),
  JWT_PUBLIC_KEY_PATH: z.string().min(1, "JWT_PUBLIC_KEY_PATH is required"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  // JWT_AUDIENCE — Phase-0 followups M-4 / Phase-7 Wave 2 security hardening batch A:
  // "JWT access tokens have no `aud` (audience) claim." Every RS256 access + refresh
  // token now carries `aud: JWT_AUDIENCE`; TokenService.verifyAccessToken/
  // verifyRefreshToken REQUIRE the same audience on verify (jose's `audience` option) —
  // a token signed for a different audience (or missing `aud` entirely) is rejected.
  // Defaults to "stimuliiq-clients" so existing deployments/tests need no config change;
  // override per-environment once a second consumer of these tokens exists that should
  // NOT accept tokens meant for a different audience (docs/phase-0-followups.md M-4).
  JWT_AUDIENCE: z.string().min(1).default("stimuliiq-clients"),

  // ─── IP-dimension rate limiting (P0 M-6 / Phase-7 Wave 2 security hardening batch A) ───
  // Generalizes the existing account-keyed limiters (LoginRateLimiter/OtpStore) with a
  // second, IP-keyed dimension so a single attacking IP spreading attempts across many
  // DIFFERENT accounts/phones cannot evade the per-account limiter. See
  // modules/auth/guards/auth-ip-rate-limit.guard.ts (FAIL CLOSED) and
  // common/rate-limit/webhook-ip-rate-limit.guard.ts (FAIL OPEN) for the fail-mode
  // rationale documented per route group.
  AUTH_IP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Deliberately higher than the per-account limit (10/60s, login-rate-limiter.ts) —
  // legitimate shared-IP traffic (office NAT, campus Wi-Fi) must not be penalized for
  // the sum of many different students' independent login attempts.
  AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
  WEBHOOK_IP_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Generous default: legitimate bulk-campaign sends can generate a burst of delivery
  // webhooks from the provider's own outbound IP(s) in a short window.
  WEBHOOK_IP_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(300),

  // ─── Webhook signature freshness window (P6 M-3 / Phase-7 Wave 2 batch A, AC-59) ───
  // A validly-HMAC-signed webhook payload whose OWN signed timestamp is older than this
  // many seconds is rejected (401 STALE_SIGNATURE) even though the signature itself
  // verifies — closes the indefinite-replay window a stolen/logged webhook payload would
  // otherwise have forever. See common/webhook/signature-freshness.ts for exactly which
  // channels can enforce this (Resend/Svix `svix-timestamp`, Razorpay `payload.created_at`
  // when present) and which cannot (WhatsApp Cloud API webhooks carry no signed timestamp).
  WEBHOOK_SIGNATURE_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300), // 5 minutes

  // --- Cookies / CSRF (httpOnly cookie auth + CSRF, per locked decision) ---
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 chars"),
  CSRF_SECRET: z.string().min(32, "CSRF_SECRET must be at least 32 chars"),
  COOKIE_DOMAIN: z.string().default("localhost"),
  COOKIE_SECURE: booleanFromString.default("false"),

  // --- DEFERRED PROVIDER KEYS (Phase 0: optional, features no-op without them) ---
  //
  // ─── Observability (Sentry SaaS + hosted OTel collector) — Phase 7 WS-C ───
  // (docs/plans/phase-7.md task #9, docs/specs/phase-7-analytics-hardening.md WS-C).
  // ALL optional — the app boots and runs fully functional with none of these set
  // (dev/test); Sentry/OTel activate ONLY once the corresponding var is present, and
  // ONLY outside NODE_ENV=test (see observability/sentry.ts, observability/otel.ts).
  //
  // SENTRY_DSN             — the project DSN from Sentry (Settings → Client Keys).
  //                          Server-side only; safe-ish but treat as a secret anyway
  //                          (do not commit a real value).
  // SENTRY_ENVIRONMENT     — tag sent with every event (e.g. "staging"/"production").
  //                          Falls back to APP_ENV when unset.
  // OTEL_EXPORTER_OTLP_ENDPOINT — the hosted OTel collector's OTLP/HTTP endpoint
  //                          (e.g. "https://otel-collector.example.com:4318"). Tracing
  //                          is a complete no-op until this is set.
  // OTEL_SERVICE_NAME      — service name attached to every span/trace. Defaults to
  //                          "stimuliiq-api".
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("stimuliiq-api"),

  // ─── Scheduler (cron) — Phase 7 Wave 2 task #11 ──────────────────────────
  // (docs/plans/phase-7.md task #11: "scheduled MV-refresh + recurring report
  // scheduling", docs/specs/phase-7-analytics-hardening.md LOCK-D2 — `@nestjs/schedule`
  // cron, not BullMQ).
  //
  // SCHEDULER_ENABLED gates registration of EVERY P7 cron job (the MV-refresh interval
  // AND the report-schedule dispatch interval) — CRITICAL test-safety rule: cron jobs
  // must NEVER fire during unit tests or block CI. Left unset, the EFFECTIVE value is
  // resolved by `isSchedulerEnabled()` (below) as `false` when NODE_ENV==='test'
  // (Jest sets this automatically) and `true` otherwise (dev/staging/prod) — so no
  // module needs its own ad hoc NODE_ENV check. An explicit "true"/"false" here always
  // wins over that default (e.g. to force-disable in a specific staging box, or to
  // exercise the scheduler in a dedicated integration test that explicitly opts in).
  SCHEDULER_ENABLED: booleanFromString.optional(),

  // ANALYTICS_MV_REFRESH_INTERVAL_MS — cadence for `CALL refresh_analytics_views()`
  // (the 8 Phase-7 materialized views). Default: 300_000 (5 minutes), per
  // docs/plans/phase-7.md Decision 1 "refresh cadence (e.g. 5 min)".
  ANALYTICS_MV_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),

  // REPORT_SCHEDULE_DISPATCH_INTERVAL_MS — how often the dispatch cron scans for due
  // report_schedules rows. Default: 60_000 (1 minute) — cheap (indexed) scan; the actual
  // send cadence is governed by each schedule's own daily/weekly/monthly `next_run_at`,
  // not by this poll interval.
  REPORT_SCHEDULE_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  // EMI_DUNNING_SCAN_INTERVAL_MS — how often EmiDunningScheduler (T24,
  // docs/plans/phase-9-completion.md) scans for overdue EMI installments and
  // auto-triggers a dunning reminder (in addition to the manual
  // POST .../installments/:id/dunning trigger). Gated by the SAME
  // isSchedulerEnabled()/SCHEDULER_ENABLED flag as every other P7+ cron job — never
  // fires during unit tests. Default: 21_600_000 (6 hours) — dunning is a
  // once/twice-daily cadence, not a tight poll like the report-schedule dispatcher.
  EMI_DUNNING_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(21_600_000),

  // DEADLINE_REMINDER_INTERVAL_MS — how often DeadlineRemindersScheduler (T31 / R3,
  // docs/plans/phase-9-completion.md) scans `assignments.due_at` for a reminder-eligible
  // 1-hour bucket. Gated by the SAME isSchedulerEnabled()/SCHEDULER_ENABLED flag as every
  // other cron job — never fires during unit tests. Default: 3_600_000 (1 hour) — the
  // scheduler's own "notify only when due_at falls in the [now+23h, now+24h) bucket"
  // window design (see that file's header) means an hourly cadence naturally sends each
  // reminder ~once, without a persisted per-recipient dedup flag.
  DEADLINE_REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),

  // DEADLINE_REMINDER_LEAD_HOURS — how far ahead of `due_at` the reminder fires.
  // Default: 24 (send a reminder ~1 day before the deadline).
  DEADLINE_REMINDER_LEAD_HOURS: z.coerce.number().int().positive().default(24),

  // ─── Campaign send batch cap (docs/plans/phase-9-completion.md T5 / R2) ───
  // POST /campaigns/:id/send dispatches queued recipients SYNCHRONOUSLY within the
  // request (P6/P7 sync-seam decision — no BullMQ yet, see memory p6-decisions). Without
  // a cap, `findQueuedRecipients` fetched EVERY queued row for the campaign and the
  // service looped over all of them in a single HTTP request — a large campaign (tens of
  // thousands of recipients) could hold the request open for minutes and risk a gateway
  // timeout mid-send. CAMPAIGN_SEND_BATCH_SIZE bounds a single /send invocation to at
  // most this many recipients (`take:` in the repository query); any remainder stays
  // `queued` and is logged, to be picked up by a subsequent call to the same endpoint
  // (the campaign stays in `sending` status until no queued recipients remain — see
  // CampaignsService.sendCampaign). Default: 500 — generous enough for most campaigns to
  // complete in a single call, small enough to bound worst-case request latency.
  CAMPAIGN_SEND_BATCH_SIZE: z.coerce.number().int().positive().default(500),

  // ─── Metrics scrape endpoint (GET /metrics) — Phase 7 WS-C ───
  // Static bearer token gating the Prometheus scrape endpoint (an infra/ops surface,
  // not a product RBAC permission — see modules/metrics/metrics-auth.guard.ts).
  // Optional in dev/test (endpoint stays open with no token so local/CI runs need no
  // setup); FAILS CLOSED (403, endpoint unreachable) in staging/production when unset,
  // so /metrics is never publicly reachable by accident once deployed. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
  METRICS_TOKEN: z.string().min(16).optional(), // SERVER-ONLY — never log

  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  // PAYMENT_PROVIDER selects the payment adapter bound at boot.
  //   razorpay  (default) → RazorpayPaymentProvider (requires the RAZORPAY_* keys below;
  //                         fail-closed boot-throw in production if any are missing).
  //   disabled            → NoopPaymentProvider, bound WITHOUT the production boot-throw
  //                         (mirrors LIVE_CLASS/VIDEO=disabled). The online checkout/enroll
  //                         funnel is OFF — enrol students manually via the CRM. Use ONLY
  //                         when you are not taking online payments yet; flip to razorpay
  //                         (with live keys) to enable checkout.
  PAYMENT_PROVIDER: z.enum(["razorpay", "disabled"]).default("razorpay"),

  // Razorpay payment keys (docs/04 §2.10, docs/plans/phase-2.md task #4).
  // KEY_ID is the public Razorpay key (safe to send to the checkout client).
  // KEY_SECRET is used for HMAC-SHA256 payment signature verification — never expose.
  // WEBHOOK_SECRET is optional: when absent, verifyWebhookSignature FAILS CLOSED
  // (rejects all incoming webhooks) and logs a warning. Provide it via the Razorpay
  // dashboard and add to .env (see .env.example) before using the webhook endpoint.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  SES_REGION: z.string().optional(),
  SES_ACCESS_KEY_ID: z.string().optional(),
  SES_SECRET_ACCESS_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  // ─── Mail provider (P6 — MailProvider interface, docs/plans/phase-6.md §2) ───
  // MAIL_PROVIDER selects the adapter bound at boot (MailProviderModule).
  // Default: "noop" — no emails sent (dev + CI). Set to "resend" for staging/prod.
  //
  // FAIL CLOSED in production: in production (NODE_ENV=production or APP_ENV=production),
  // MAIL_PROVIDER=noop OR missing RESEND_API_KEY/MAIL_FROM causes a boot-time throw.
  // The application will NOT start until properly configured.
  //
  // MAIL_PROVIDER=noop            → NoopMailProvider (dev/test — no network)
  // MAIL_PROVIDER=resend          → ResendMailProvider (requires RESEND_API_KEY + MAIL_FROM)
  // (future) MAIL_PROVIDER=ses    → SesMailProvider (slot: SES_REGION + SES_ACCESS_KEY_ID + SES_SECRET_ACCESS_KEY)
  //
  // RESEND_API_KEY      — SERVER-ONLY. Resend API key from https://resend.com/api-keys.
  //                       Never log, never return to client. Prefix "re_" for prod keys.
  // MAIL_FROM           — SERVER-ONLY. Verified sender address, e.g. "noreply@yourdomain.com"
  //                       or "StimuliiQ <noreply@yourdomain.com>". Domain must be verified
  //                       in the Resend dashboard (Settings → Domains).
  // MAIL_WEBHOOK_SECRET — SERVER-ONLY. The webhook signing secret from the Resend dashboard
  //                       (Webhooks → your endpoint → Signing Secret). Used by
  //                       MailProvider.verifyWebhookSignature() to authenticate delivery/
  //                       bounce/complaint receipts. Fail-closed when absent (rejects all
  //                       incoming webhooks). Format: "whsec_..." (Svix scheme).
  MAIL_PROVIDER: z.enum(["noop", "resend"]).default("noop"),
  MAIL_FROM: z.string().optional(),
  MAIL_WEBHOOK_SECRET: z.string().optional(), // SERVER-ONLY — never log

  // ─── WhatsApp provider (P6 — WhatsAppProvider interface, docs/plans/phase-6.md §2) ───
  // WHATSAPP_PROVIDER selects the adapter bound at boot (WhatsAppProviderModule).
  // Default: "noop" — no messages sent (dev + CI).
  //
  // FAIL CLOSED in production: WHATSAPP_PROVIDER=noop OR missing required keys
  // in production (NODE_ENV=production or APP_ENV=production) causes a boot-time throw.
  //
  // WHATSAPP_PROVIDER=noop            → NoopWhatsAppProvider (dev/test — no network)
  // WHATSAPP_PROVIDER=whatsapp_cloud  → WhatsAppCloudProvider (Meta Cloud API — direct fetch)
  //
  // WHATSAPP_PHONE_NUMBER_ID — SERVER-ONLY. The WhatsApp Phone Number ID from
  //                            Meta Business Manager → WhatsApp → API Setup.
  //                            Used as the path param in Graph API calls:
  //                            https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages
  // WHATSAPP_ACCESS_TOKEN    — SERVER-ONLY. System User access token from Meta Business Manager.
  //                            PERMANENT tokens are recommended for production.
  //                            Never log, never return to client. Keep in a secrets manager.
  // WHATSAPP_APP_SECRET      — SERVER-ONLY. Your Meta App's App Secret (from
  //                            developers.facebook.com → your app → App Settings → Basic).
  //                            Used to verify the X-Hub-Signature-256 header on
  //                            inbound delivery/read webhooks. Fail-closed when absent.
  // WHATSAPP_VERIFY_TOKEN    — The webhook hub.verify_token used during Meta webhook
  //                            subscription verification (GET challenge from Meta).
  //                            Not a secret per se, but treat it as one. Choose a random
  //                            string and set it in both Meta's webhook config and here.
  // "disabled" turns outbound WhatsApp OFF (mirrors LIVE_CLASS/VIDEO=disabled): binds
  // Noop WITHOUT the production boot-throw, so no Meta credentials are required. Use ONLY
  // when WhatsApp messaging is not live yet. Flip to whatsapp_cloud (with keys) to enable.
  WHATSAPP_PROVIDER: z.enum(["noop", "whatsapp_cloud", "disabled"]).default("noop"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(), // SERVER-ONLY
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),    // SERVER-ONLY — never log
  WHATSAPP_APP_SECRET: z.string().optional(),      // SERVER-ONLY — never log
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),    // webhook subscription verify token

  // ─── Notification signing secret (P6 — unsubscribe HMAC tokens, AC-21/24/77) ───
  // Used to sign unsubscribe link tokens: HMAC(NOTIFICATION_SIGNING_SECRET, userId+channel+nonce)
  // so recipients cannot guess or enumerate unsubscribe tokens (AC-21, AC-77).
  // Optional in dev/CI (a well-known dev fallback is used with a loud warning).
  // REQUIRED in production (>= 32 chars) — enforced by the superRefine below, so a
  // missing key FAILS AT BOOT, not the first time an unsubscribe link is signed.
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  NOTIFICATION_SIGNING_SECRET: z.string().min(32).optional(), // SERVER-ONLY — never log

  // ─── Video (Cloudflare Stream / Mux) — behind VideoProvider (docs/04 §2.10/§2.12) ───
  // VIDEO_PROVIDER selects the adapter bound at boot (VideoProviderModule).
  // Default: "noop" — deterministic fake signed URLs for local dev + tests.
  // Set to "cloudflare_stream" or "mux" with the corresponding keys for staging/prod.
  // Fail-closed: the real adapters throw at call time if their keys are absent;
  // the app NEVER emits a raw/unsigned fallback URL.
  //
  // Cloudflare Stream (VIDEO_PROVIDER=cloudflare_stream):
  //   CLOUDFLARE_ACCOUNT_ID       — your Cloudflare account ID (also used as CDN subdomain).
  //   CLOUDFLARE_STREAM_API_TOKEN — Bearer token with Stream:Edit permission.
  //   CLOUDFLARE_STREAM_SIGNING_KEY_ID  — kid of the RS256 signing key.
  //   CLOUDFLARE_STREAM_SIGNING_KEY_PEM — PKCS#8 PEM (raw, or base64-encoded as CF returns).
  //   CLOUDFLARE_STREAM_WEBHOOK_SECRET  — secret for HMAC-SHA256 webhook verification.
  //     FAIL CLOSED when absent: verifyWebhookSignature returns false (rejects all webhooks).
  //
  // Mux (VIDEO_PROVIDER=mux):
  //   MUX_TOKEN_ID          — Mux API access token ID.
  //   MUX_TOKEN_SECRET      — Mux API access token secret (Basic auth; never logged).
  //   MUX_SIGNING_KEY_ID    — kid of the RS256 URL signing key.
  //   MUX_SIGNING_KEY_PRIVATE — PKCS#8 PEM private key (raw or base64 as Mux provides).
  //   MUX_WEBHOOK_SECRET    — secret for HMAC-SHA256 Mux-Signature header verification.
  //     FAIL CLOSED when absent: verifyWebhookSignature returns false (rejects all webhooks).
  //
  // "disabled" turns the recorded-video feature OFF (mirrors LIVE_CLASS_PROVIDER=disabled):
  // binds Noop WITHOUT the production boot-throw, so no Mux/Cloudflare Stream account is
  // required. Signed-HLS endpoints stay registered but dormant — use this ONLY when no
  // recorded video is served yet. Flip to cloudflare_stream|mux (with keys) to enable it.
  VIDEO_PROVIDER: z.enum(["noop", "cloudflare_stream", "mux", "disabled"]).default("noop"),

  // Cloudflare Stream keys (all optional — provider is noop/fail-closed without them)
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_STREAM_API_TOKEN: z.string().optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: z.string().optional(),
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: z.string().optional(),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().optional(),

  // Mux keys (all optional — provider is noop/fail-closed without them)
  MUX_TOKEN_ID: z.string().optional(),
  MUX_TOKEN_SECRET: z.string().optional(),
  MUX_SIGNING_KEY_ID: z.string().optional(),
  MUX_SIGNING_KEY_PRIVATE: z.string().optional(),
  MUX_WEBHOOK_SECRET: z.string().optional(),

  // ─── Object storage (S3 / R2) — behind StorageProvider (docs/04 §2.10, docs/plans/phase-4.md §3) ───
  // STORAGE_PROVIDER selects the adapter bound at boot (StorageProviderModule).
  // Default: "noop" — deterministic fake presigned URLs for local dev + tests.
  // Set to "s3" (AWS S3) or "r2" (Cloudflare R2 / S3-compatible) with the keys below.
  //
  // Fail-closed: the S3StorageProvider logs a warning at construction when keys are
  // absent and throws at call time — the app NEVER returns a raw/public bucket URL.
  //
  // S3 (STORAGE_PROVIDER=s3):
  //   STORAGE_BUCKET      — bucket name (never returned to the client).
  //   STORAGE_REGION      — AWS region, e.g. "ap-south-1" for India.
  //   STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY — IAM credentials with least
  //     privilege: s3:GetObject, s3:PutObject, s3:DeleteObject, s3:HeadObject on
  //     arn:aws:s3:::<BUCKET>/submissions/* + /certificates/* + /invoices/* + /resources/*.
  //   STORAGE_ENDPOINT    — leave empty for AWS; set for R2 / S3-compatible services.
  //
  // R2 (STORAGE_PROVIDER=r2):
  //   Same keys as above; STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com.
  //   STORAGE_REGION=auto (R2 ignores region but the SDK requires a value).
  // "local" (dev/local): files are stored on the API server's disk and served back
  //   through the API itself (LocalStorageProvider + LocalStorageController) — no cloud
  //   credentials, no CDN. Uploads and public images work end-to-end on localhost.
  STORAGE_PROVIDER: z.enum(["noop", "local", "s3", "r2"]).default("noop"),
  STORAGE_BUCKET: z.string().optional(),
  // OPTIONAL second bucket holding ONLY the publicly-served image namespaces
  // (program_images/, marketing_images/, mentor_photos/, college_logos/ — see
  // PUBLIC_ASSET_PREFIXES in s3-storage.provider.ts). Everything else — student
  // submissions, CSV exports, invoices, receipts, certificates, lesson resources,
  // career resumes — stays in STORAGE_BUCKET and is only ever reachable through a
  // short-lived signed URL.
  //
  // WHY: a CDN needs the image bucket to be publicly readable, and R2 grants public
  // access per BUCKET, not per prefix. With one shared bucket the only way to serve
  // course thumbnails over a CDN is to make assignment submissions and PII exports
  // world-readable too. Splitting the buckets keeps "public" and "private" from
  // sharing a blast radius.
  //
  // Unset (the default) = single-bucket behaviour, unchanged: every key goes to
  // STORAGE_BUCKET.
  STORAGE_PUBLIC_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  // Directory the "local" storage provider writes uploaded objects to (dev only).
  // Default: `<api cwd>/.local-storage`.
  LOCAL_STORAGE_DIR: z.string().optional(),
  // The API's own externally-reachable base URL, used by the "local" provider to build
  // absolute signed upload/download URLs. Default: `http://localhost:<API_PORT>`.
  API_PUBLIC_URL: z.string().url().optional(),
  // Base URL public asset (image) keys are minted against — mentor/faculty photos, blog
  // covers, etc. (`mintCdnUrl`). Default: the production CDN `https://cdn.stimuliiq.com`.
  // For local dev with STORAGE_PROVIDER=local, set to `http://localhost:4000/api/v1/assets`.
  PUBLIC_ASSET_BASE_URL: z.string().url().optional(),

  // ─── Captcha / bot-protection (Cloudflare Turnstile) — behind CaptchaProvider ───
  // (docs/plans/phase-5.md §3 task #3, §5, §6 Risk #4, §7)
  //
  // CAPTCHA_PROVIDER selects the adapter bound at boot (CaptchaProviderModule).
  // Default: "noop" — all captcha tokens accepted unconditionally (dev + CI).
  // Set to "turnstile" with CAPTCHA_SECRET_KEY for staging/prod.
  //
  // FAIL CLOSED: in production (NODE_ENV=production or APP_ENV=production) with
  // CAPTCHA_PROVIDER=noop OR a missing CAPTCHA_SECRET_KEY, the factory binds
  // FailClosedCaptchaProvider — every captcha-gated write returns 422 until the
  // key is supplied and the app reboots. This prevents a misconfigured deployment
  // from silently accepting all tokens.
  //
  // CAPTCHA_SITE_KEY  — PUBLIC (safe for the client bundle / NEXT_PUBLIC_* env).
  //                     The browser widget uses this to render the challenge.
  //                     Get it from: Cloudflare Dashboard → Turnstile → your site.
  // CAPTCHA_SECRET_KEY — SERVER-ONLY. Never log, never return to client, never
  //                      put in NEXT_PUBLIC_* or VITE_*. Used by the server to
  //                      verify the token against Cloudflare's siteverify endpoint.
  //                      Get it from: Cloudflare Dashboard → Turnstile → your site.
  CAPTCHA_PROVIDER: z.enum(["noop", "turnstile"]).default("noop"),
  CAPTCHA_SITE_KEY: z.string().optional(),   // PUBLIC — client-safe
  CAPTCHA_SECRET_KEY: z.string().optional(), // SERVER-ONLY — never log or return

  // ─── Analytics (GA4 + GTM) — consent-gated, client-side only ─────────────
  // (docs/plans/phase-5.md §3 task #3, §7; docs/specs/phase-5-website.md §consent)
  //
  // CONSENT INVARIANT: analytics scripts MUST ONLY load AFTER the visitor
  // explicitly accepts the DPDP consent banner in apps/web. The ConsentBanner
  // component's onAccept callback is the ONLY place scripts may be initialised.
  // These env vars configure WHAT to load, not WHEN — the WHEN is enforced
  // client-side in the ConsentBanner.
  //
  // All analytics env vars below are PUBLIC (safe for NEXT_PUBLIC_* / client
  // bundle). GA4/GTM do NOT involve a server-side secret for tag loading.
  // If a Measurement Protocol API secret is ever needed for server-side GA4
  // events, add it as a SEPARATE, non-exported env var NOT in this type.
  //
  // ANALYTICS_PROVIDER        — "noop" (default, no scripts) | "ga4".
  // ANALYTICS_MEASUREMENT_ID  — GA4 Measurement ID (G-XXXXXXXXXX). PUBLIC.
  //                             Get from: Google Analytics → Admin → Data Streams.
  // ANALYTICS_GTM_ID          — GTM Container ID (GTM-XXXXXXX). PUBLIC. Optional.
  //                             Get from: Google Tag Manager → Container Settings.
  ANALYTICS_PROVIDER: z.enum(["noop", "ga4"]).default("noop"),
  ANALYTICS_MEASUREMENT_ID: z.string().optional(), // PUBLIC — client-safe
  ANALYTICS_GTM_ID: z.string().optional(),         // PUBLIC — client-safe

  // ─── P5: DPDP Consent / TOS version (docs/specs/phase-5-website.md §Consent) ───
  // The TOS version string that public forms must report in their consent payload.
  // When the TOS is updated, bump this value; all future submissions record the new version.
  // Optional: defaults to "v1.0" in code. Change requires a redeployment.
  TOS_VERSION: z.string().min(1).max(20).default("v1.0"),

  // ─── P5: LMS base URL for enrollment handoff (AC-23) ─────────────────────
  // Already present as LMS_APP_URL above — used in PublicFunnelService for lmsRedirectUrl.

  // ─── SSE connection cap (P6 M-1 / Phase-7 Wave 2 security hardening batch B) ───
  // Caps the number of CONCURRENT SSE connections a single (tenantId, userId) pair may
  // hold open at once (GET /me/notifications/stream). Without a cap, a client that opens
  // many tabs or reconnects rapidly (e.g. a flaky network retrying) accumulates unbounded
  // entries in the in-memory subscriber map (see notifications.service.ts). When the cap
  // is reached, the OLDEST connection for that user is force-closed (its async iterator
  // completes, so the client's EventSource sees a clean stream end) before the new
  // connection is registered — never rejected with an error, since a reconnect storm
  // should self-heal rather than surface a hard failure to the client.
  SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().default(3),

  // ─── Certificate signing (docs/plans/phase-4.md task #4, §6 Risk #2) ───
  // Secret used to HMAC-SHA256-sign the `cert_uid` embedded in every issued
  // certificate. Public verification (GET /verify/:certUid) RECOMPUTES this
  // signature — a fabricated `certificates` row or a guessed uid without a valid
  // signature FAILS verification. The secret is server-only and must NEVER be
  // logged or returned in any response.
  //
  // Optional here so local dev / CI can boot without it: when absent AND
  // NODE_ENV !== "production" the signer uses a clearly-marked, well-known LOCAL
  // dev secret (see cert-uid.util.ts) and logs a warning. REQUIRED in production
  // (>= 32 chars, e.g. `openssl rand -hex 32`) — enforced by the superRefine below,
  // so a missing key FAILS AT BOOT rather than the first time a certificate is signed
  // (the signer's own lazy fail-closed throw in cert-uid.util.ts is now a second,
  // redundant line of defense — unreachable in practice once boot validation passes).
  CERT_SIGNING_SECRET: z.string().min(32, "CERT_SIGNING_SECRET must be at least 32 chars").optional(),

  // ─── 2FA (TOTP) secret encryption-at-rest (Wave 6 security audit M4) ───
  // AES-256-GCM key used to envelope-encrypt every stored TOTP secret in
  // `two_factor_credentials.secret`. A DB dump alone must NOT yield usable 2FA secrets.
  // Mirrors CERT_SIGNING_SECRET's posture exactly: OPTIONAL here so local dev / CI boot
  // without it (a clearly-marked, well-known LOCAL dev key is used with a loud warning —
  // see auth/lib/two-factor-crypto.ts). REQUIRED in production (>= 32 chars) — enforced
  // by the superRefine below, so a missing key FAILS AT BOOT rather than the first time
  // a user completes 2FA enrolment (the crypto layer's own lazy fail-closed throw in
  // two-factor-crypto.ts is now a second, redundant line of defense). Generate a real
  // value with: `openssl rand -hex 32`.
  // SERVER-ONLY — never log, never return in any response.
  TWO_FACTOR_ENC_KEY: z.string().min(32, "TWO_FACTOR_ENC_KEY must be at least 32 chars").optional(),

  // ─── Live class (Zoom / Google Meet) — behind LiveClassProvider (docs/plans/phase-9-completion.md T15) ───
  // LIVE_CLASS_PROVIDER selects the adapter bound at boot (LiveClassProviderModule).
  // Default: "noop" — deterministic fake meetings/join-urls for local dev + tests.
  // Set to "zoom" or "google_meet" with the corresponding keys for staging/prod.
  // FAIL CLOSED: noop or missing keys in production causes a boot-time throw
  // (mirrors VideoProviderModule/StorageProviderModule exactly).
  //
  // Zoom (LIVE_CLASS_PROVIDER=zoom) — Server-to-Server OAuth app:
  //   ZOOM_ACCOUNT_ID     — Zoom account id (Server-to-Server OAuth app credentials page).
  //   ZOOM_CLIENT_ID      — S2S OAuth app Client ID.
  //   ZOOM_CLIENT_SECRET  — S2S OAuth app Client Secret. NEVER logged/returned.
  //   ZOOM_WEBHOOK_SECRET_TOKEN — Feature > Event Subscriptions > Secret Token, used to
  //     verify the `x-zm-signature` header (HMAC-SHA256). FAIL CLOSED when absent.
  //
  // Google Meet (LIVE_CLASS_PROVIDER=google_meet) — Workspace service account with
  // domain-wide delegation (Calendar API, conferenceData):
  //   GOOGLE_SERVICE_ACCOUNT_EMAIL       — service account client_email.
  //   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — service account PKCS#8 private key (PEM,
  //     literal "\n" sequences are unescaped by the adapter).
  //   GOOGLE_MEET_IMPERSONATE_USER_EMAIL — Workspace user the service account
  //     impersonates via domain-wide delegation (must own the calendar events).
  //   GOOGLE_MEET_CALENDAR_ID — calendar id to create events on. Default "primary".
  // "disabled" turns the Live Classes feature off entirely (removed from LMS/CRM UIs);
  // binds Noop WITHOUT the production boot-throw, so no Zoom/Meet account is required.
  LIVE_CLASS_PROVIDER: z.enum(["noop", "zoom", "google_meet", "disabled"]).default("noop"),
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(), // SERVER-ONLY — never log
  ZOOM_WEBHOOK_SECRET_TOKEN: z.string().optional(), // SERVER-ONLY — never log
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(), // SERVER-ONLY — never log
  GOOGLE_MEET_IMPERSONATE_USER_EMAIL: z.string().optional(),
  GOOGLE_MEET_CALENDAR_ID: z.string().default("primary"),

  // ─── SMS provider (B3 — behind SmsProvider, docs/plans/phase-9-completion.md T16) ───
  // SMS_PROVIDER selects the adapter bound at boot (SmsProviderModule).
  // Default: "noop" — no SMS sent, OTP never logged (dev + CI).
  // Set to "msg91" with MSG91_AUTH_KEY + MSG91_SENDER + MSG91_TEMPLATE_ID for staging/prod.
  // FAIL CLOSED: noop or missing keys in production causes a boot-time throw.
  // MSG91_TEMPLATE_ID here is the DEFAULT/OTP DLT template; sendSms() callers may pass a
  // more specific per-message dltTemplateId (Rule C-3) which takes precedence.
  //
  // "disabled" turns outbound SMS OFF (mirrors LIVE_CLASS/VIDEO=disabled): binds Noop
  // WITHOUT the production boot-throw, so no MSG91 credentials are required. Use ONLY when
  // SMS is not live yet — this ALSO disables phone-OTP login (email/password login still
  // works). Flip to msg91 (with keys) to enable SMS.
  SMS_PROVIDER: z.enum(["noop", "msg91", "disabled"]).default("noop"),

  // ─── Queue driver (R1 — BullMQ, docs/plans/phase-9-completion.md T18) ───
  // QUEUE_DRIVER selects whether the dispatch/invoice-gen/webhook/PDF seams run
  // synchronously in-request (default — required for the Jest unit suite to stay
  // synchronous and Redis-free) or via BullMQ-backed queues + a separate worker
  // process (apps/api/src/worker.ts). Default: "sync". Set "bullmq" in staging/prod.
  QUEUE_DRIVER: z.enum(["sync", "bullmq"]).default("sync"),
});

// ─── Signing/encryption secrets REQUIRED in production, boot-throw (not lazy-throw) ───
// TWO_FACTOR_ENC_KEY, CERT_SIGNING_SECRET, NOTIFICATION_SIGNING_SECRET are all declared
// `.optional()` above (so local/dev/CI/test boot without them — each consumer falls back
// to a well-known LOCAL dev value with a loud warning, see two-factor-crypto.ts /
// cert-uid.util.ts / the notification unsubscribe-token signer). Left at that, a
// production deployment missing one of these boots GREEN and the failure only surfaces
// the first time the corresponding code path runs (e.g. confirming a 2FA enrolment) —
// which is exactly the incident this closes: TWO_FACTOR_ENC_KEY was unset in production,
// the app booted fine, and 2FA confirmation 500'd for every user who tried to enable it.
// This mirrors the SAME production-required pattern the provider modules already use
// (mail/whatsapp/sms/video/storage/captcha — see e.g. mail-provider.module.ts), applied
// at the env-validation layer instead of a factory, since these three have no dedicated
// provider module to gate them.
const PRODUCTION_REQUIRED_SECRETS = [
  ["TWO_FACTOR_ENC_KEY", "encrypts 2FA (TOTP) secrets at rest — see auth/lib/two-factor-crypto.ts"],
  ["CERT_SIGNING_SECRET", "signs the cert_uid embedded in every issued certificate — see cert-uid.util.ts"],
  ["NOTIFICATION_SIGNING_SECRET", "signs unsubscribe link tokens — see notifications AC-21/24/77"],
] as const;

const envSchema = rawEnvSchema.superRefine((data, ctx) => {
  const isProd = data.NODE_ENV === "production" || data.APP_ENV === "production";
  if (!isProd) return;

  for (const [key, purpose] of PRODUCTION_REQUIRED_SECRETS) {
    if (!data[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required in production (${purpose}). Generate one with ` +
          `\`openssl rand -hex 32\` and set it in the environment.`,
      });
    }
  }
});

export type Env = z.infer<typeof rawEnvSchema>;

let cachedEnv: Env | undefined;

/**
 * Validates `process.env` against the schema above. Throws (and crashes boot) on any
 * missing/invalid REQUIRED variable — "fail fast", per CLAUDE.md §3.12 and
 * docs/08-monorepo-scaffold.md §3-#2. Safe to call multiple times; result is memoized.
 */
export function validateEnv(rawEnv: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    // pino is not bootstrapped yet at this point in boot, so use console directly.
    console.error(`\n[env] Invalid environment configuration:\n${formatted}\n`);
    throw new Error("Invalid environment configuration. See errors above.");
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/**
 * True when this process serves production traffic.
 *
 * Provider factories (mail, whatsapp, captcha, video, storage, payment) use this to
 * FAIL CLOSED at boot — a Noop adapter in production silently discards emails, serves
 * fake signed video URLs, or writes uploads nowhere, all behind a green healthcheck.
 * Outside production the same factories bind Noop with a loud warning, so local dev
 * and CI need no vendor credentials.
 *
 * Previously copy-pasted into each provider module, which is precisely why three of
 * the six modules never adopted the fail-closed guard. Single definition now.
 */
export function isProductionEnv(env: Env = validateEnv()): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

/**
 * Names of the entries whose value is absent/empty. Provider factories pass the
 * credentials a selected adapter needs, then either throw (production) or warn and
 * fall back to Noop (everywhere else).
 *
 *   const missing = missingEnvVars({ STORAGE_BUCKET: env.STORAGE_BUCKET, ... });
 */
export function missingEnvVars(required: Record<string, unknown>): string[] {
  return Object.entries(required)
    .filter(([, value]) => value === undefined || value === null || value === "")
    .map(([name]) => name);
}

/** Test-only helper to reset the memoized env (avoids cross-test leakage). */
export function __resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
