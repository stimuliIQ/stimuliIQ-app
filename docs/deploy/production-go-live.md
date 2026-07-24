# Production Go-Live Runbook

> Authoritative sequence to take `web` + `lms` + `crm` + `api` from the current
> Phase-11 codebase to a **staging-first, then paid** production launch.
>
> Source of truth for env var names + per-vendor setup steps is the annotated
> [`.env.example`](../../.env.example). This runbook is the **order of operations** and the
> **decisions locked for this launch**. Do not treat any step as optional unless it says so.

---

## 0. Reality check — what is and isn't done

The code is at ~100% PRD coverage (Phase 11). A full audit (2026-07-24) confirms:

- **No dead code, no stray files, seeds/fixtures are load-bearing** — the "cleanup" is tiny (§7).
- **Every third-party integration is already implemented behind a provider interface** and
  **fails closed in production** — the API refuses to boot if a required provider is `noop`
  or missing credentials. Nothing serves fake data silently anymore.
- **Resend (email) and the S3/R2 storage adapter are fully built.** Nothing to write.
- **Razorpay test/live key-prefix guard is implemented** — a `rzp_test_` key cannot reach prod.

So the remaining work is **provisioning + verification**, not engineering. Realistic timeline:
a focused **2 days to a fully-wired staging** environment; **paid production** follows once the
verification gates in §6 pass (webhook round-trip, load, AV scan). Do not promise real paying
students on day 2 — promise a working staging on day 2 and paid launch on gate-pass.

---

## 1. Locked architecture decisions (this launch)

| Concern | Decision | Why |
|---|---|---|
| Postgres | **Supabase** (managed) | "Do the best" → managed, backups, no infra to run. Prisma points at it; zero code change. |
| Redis | **Upstash** (managed, TLS, `ap-south-1`, eviction OFF) | Managed = no Redis to run or back up on the VPS. `QUEUE_DRIVER=sync` at launch so Upstash's per-command billing isn't burned by BullMQ blocking polls. See §3.2. |
| Email | **Resend** | Adapter already built + tested. `MAIL_PROVIDER=resend`. |
| WhatsApp | **Meta WhatsApp Cloud API** on your WABA (**9177748321**) | Adapter already built. Direct = cheaper than Twilio, no middleman. Twilio kept as documented fallback (§8). |
| SMS / OTP | **MSG91** (unchanged) | India-first, TRAI DLT built in. Cheaper/more reliable into India than Twilio SMS. |
| Object storage | **Cloudflare R2** | Cheapest S3-compatible; adapter already handles it (`STORAGE_PROVIDER=r2`). |
| Payments | **Razorpay LIVE** | Primary provider, already wired. Live keys + webhook secret needed. |
| API host | **Hostinger KVM VPS** (Nginx + TLS + PM2) | User's choice. Runs the API process only; Postgres and Redis are remote managed services. See [hostinger-vps-setup.md](hostinger-vps-setup.md). |
| web + lms | **Vercel** | Next.js 15, already configured. |
| crm | **Cloudflare Pages** | Vite SPA. |
| Video (recorded lessons) | **Mux or Cloudflare Stream** — only if launching with recorded video | Adapter built; credential-gated. Can be deferred if launch is live-class-only. |

---

## 2. Prerequisite — clean tree, green build

Before any provisioning:

1. **Finish and commit the in-flight WIP.** The working tree currently has an uncommitted
   CRM UI-consistency pass (branch `ui/crm-consistency-pass`) plus untracked new files
   (`company-profile.service.ts`, `settings-catalog*`, `marketing-testimonials-route.tsx`).
   Do **not** start the deploy sequence on a dirty tree.
2. **Gate: `pnpm turbo run build lint test` is green** across all packages (CLAUDE.md §4).
   - Reminder (from project memory): **never run `next build` on an app while its `next dev`
     is running** — it corrupts `.next` and produces 500s. Verify with `tsc` + `eslint` if a
     dev server is up.
3. **CI is green on `main`.** The `dependency-audit` job hard-gates on HIGH/CRITICAL prod
   advisories; keep it clean.

---

## 3. Provisioning — the critical path

Work top to bottom. Each sub-section lists **what to create** and the **exact env vars** it sets.
All `[SERVER-ONLY]` vars go into the API host's secret store (Railway), never into any
`NEXT_PUBLIC_*` / `VITE_*` var. Generate every 32-char secret with:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### 3.1 Supabase (Postgres)

1. Create a Supabase project in the **`ap-south-1` (Mumbai)** region (closest to India users).
2. Get **two** connection strings from Project → Settings → Database:
   - **Direct** (port **5432**, "Session" / non-pooled) — used for **migrations only**.
   - **Pooled** (port **6543**, "Transaction" / PgBouncer) — used for **runtime**.
3. Bootstrap the schema **only** via `prisma migrate deploy` against the **direct** URL:
   ```bash
   DATABASE_URL="<supabase-direct-5432-url>?sslmode=require" pnpm db:migrate:deploy
   ```
   > **NEVER `prisma db push`.** ~half the real constraints — partial-unique indexes,
   > 8 materialized views, the `refresh_analytics_views()` procedure, tsvector generated
   > columns — live only in raw-SQL migrations and `db push` would silently drop them.
4. Seed reference data (RBAC roles, permission catalog, tenant, bootstrap admin):
   ```bash
   DATABASE_URL="<supabase-direct-5432-url>?sslmode=require" pnpm db:seed
   ```
   Capture the one-time random admin password it prints.
5. Runtime env: `DATABASE_URL=<supabase-pooled-6543-url>?sslmode=require&pgbouncer=true`
   - The advisory-lock invoice path and migrations need the **direct** connection; keep the
     direct URL in the CI migrate step's secret (`DATABASE_URL_STAGING_OR_PROD`), pooled at runtime.

### 3.2 Upstash Redis

1. Create an Upstash Redis DB, **`ap-south-1`**, TLS enabled, eviction **off** (BullMQ + rate
   limiting must not lose keys).
2. Set `REDIS_URL=rediss://…` (note `rediss://` for TLS).
3. The API pings Redis in its readiness probe — if this is wrong, `/api/v1/health/ready` never
   goes green and Railway will not route traffic.

### 3.3 Resend (email) — `MAIL_PROVIDER=resend`

1. Create a Resend account → **Domains → Add Domain** for your sending domain.
2. Add the **DKIM + SPF** DNS records it gives you; wait for "Verified".
3. **API Keys → Create** with **Sending access** (least privilege) → `RESEND_API_KEY=re_…`
4. `MAIL_FROM="StimuliiQ <noreply@yourdomain.com>"` (must be on the verified domain).
5. **Webhooks → Add Endpoint** → `https://<api-domain>/api/v1/notifications/webhooks/mail`
   subscribe to `email.delivered/bounced/complained/opened`; copy the signing secret →
   `MAIL_WEBHOOK_SECRET=whsec_…`

### 3.4 WhatsApp Cloud API (Meta) — `WHATSAPP_PROVIDER=whatsapp_cloud`

Using **your existing WhatsApp Business account on 9177748321**.

1. **Meta Business verification** — in Meta Business Manager, make sure the business behind the
   WABA is verified. *This is the long pole* (can take days). Start it first.
2. Add the **WhatsApp** product to a Meta App (Business type) at developers.facebook.com.
3. Business Manager → WhatsApp → **API Setup**:
   - `WHATSAPP_PHONE_NUMBER_ID` = the numeric Phone Number ID for 9177748321 (**not** the raw
     number — it's an ID Meta assigns).
   - Create a **System User** with a permanent token → `WHATSAPP_ACCESS_TOKEN=EAA…`
     (temporary tokens expire in 24h — do not use for prod).
4. App Settings → Basic → **App Secret** → `WHATSAPP_APP_SECRET=…` (verifies inbound webhook HMAC).
5. WhatsApp → Configuration → **Webhooks**:
   - Callback URL: `https://<api-domain>/api/v1/campaigns/webhooks/whatsapp`
   - Verify token: any random string → `WHATSAPP_VERIFY_TOKEN=…`
   - Subscribe to `messages`.
6. **Message templates**: submit your transactional templates (OTP, receipt, reminders) in
   Business Manager for approval. India DLT template IDs go in `campaign_templates.dlt_template_id`
   (the DB), **not** in env.
7. Click-to-chat deep link on the marketing site (`apps/web`):
   `NEXT_PUBLIC_WHATSAPP_NUMBER=919177748321` (country code + number, digits only — **confirm the
   full E.164 form of your number**; if 9177748321 is the 10-digit mobile, the international form
   is `91` + `9177748321` = `919177748321`).

> If Meta business verification stalls and you need WhatsApp live fast, use the **Twilio
> fallback in §8** — a small adapter, same WABA.

### 3.5 Razorpay — LIVE — (payments)

1. Complete Razorpay KYC / activation for **Live** mode.
2. Settings → API Keys → **generate Live keys**: `RAZORPAY_KEY_ID=rzp_live_…`,
   `RAZORPAY_KEY_SECRET=…`
   > The boot guard **throws** if a `rzp_test_` key is set in production, and if a `rzp_live_`
   > key is set outside production. This is intentional — respect it.
3. Settings → **Webhooks → Add New Webhook**:
   - URL: `https://<api-domain>/api/v1/commerce/payments/webhook`
   - Active events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`.
   - Copy the **Webhook Secret** → `RAZORPAY_WEBHOOK_SECRET=…`
   > Without this secret the webhook endpoint **rejects every webhook** → no payment ever
   > becomes an enrollment. This is the #1 silent-failure trap; verify it in §6.
4. The public key reaches the browser checkout via the API response, **not** an env var. Do not
   set `NEXT_PUBLIC_RAZORPAY_*`.

### 3.6 Cloudflare R2 (object storage) — `STORAGE_PROVIDER=r2`

1. Cloudflare → R2 → create a **private** bucket (no public access).
2. Create an R2 API token (S3 auth) with read/write to that bucket only.
3. Env:
   ```
   STORAGE_PROVIDER=r2
   STORAGE_BUCKET=<bucket>
   STORAGE_REGION=auto
   STORAGE_ACCESS_KEY_ID=<r2-access-key>
   STORAGE_SECRET_ACCESS_KEY=<r2-secret>
   STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com
   ```
4. Configure bucket CORS to allow presigned PUT/GET from your app origins.

### 3.7 MSG91 (SMS / OTP) — `SMS_PROVIDER=msg91`

1. MSG91 account + KYC.
2. **TRAI DLT** (required before any SMS in India): register Principal Entity ID with your
   operator's DLT portal, register a 6-char Sender ID (e.g. `STMLIQ`), and get your OTP +
   transactional **templates approved** (each yields a DLT Template ID).
3. Env: `MSG91_AUTH_KEY=…`, `MSG91_SENDER=STMLIQ`, `MSG91_TEMPLATE_ID=<OTP-template-id>`.

### 3.8 Video — Mux **or** Cloudflare Stream — only if launching recorded video

If day-1 launch is live-class + assessments only, you can leave `VIDEO_PROVIDER=noop` on
**staging** but **NOT in production** (it boot-throws). Decide: launch with recorded video → pick
a provider and set its keys (see `.env.example` §Video); otherwise, defer recorded-video features
behind a feature flag before prod. **Rotate the two exposed Cloudflare `cfat_` tokens (checklist
item B1) before using Cloudflare for anything** — they were shared in chat historically.

### 3.9 Remaining production-required secrets (boot-throws without them)

| Var | Purpose | How |
|---|---|---|
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | RS256 signing | Generate a **prod** keypair; mount as files/secret. Do not reuse dev keys. |
| `COOKIE_SECRET`, `CSRF_SECRET` | ≥32 chars each | random 32-byte hex |
| `CERT_SIGNING_SECRET` | Certificate HMAC | random 32-byte hex |
| `TWO_FACTOR_ENC_KEY` | TOTP-at-rest (AES-256-GCM) | random 32-byte hex |
| `NOTIFICATION_SIGNING_SECRET` | Unsubscribe HMAC | random 32-byte hex |
| `METRICS_TOKEN` | `/metrics` bearer (≥16 chars) | random 24-byte hex |
| `CAPTCHA_PROVIDER=turnstile` + `CAPTCHA_SECRET_KEY` (+ `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) | Bot protection on public forms | Cloudflare Turnstile |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Observability (boot-throws in prod if unset) | Sentry SaaS + hosted OTel |
| `COOKIE_SECURE=true`, `COOKIE_DOMAIN=<your-domain>` | HTTPS cookies | set per environment |
| `NODE_ENV=production`, `APP_ENV=production` | Enables all fail-closed gates | set on API host |

---

## 4. Frontend hosting + env

- **web + lms → Vercel**: set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_WHATSAPP_NUMBER=919177748321`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
  `NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID`/`_GTM_ID`. Mark nothing here Secret — these are public
  by design. **No server secret ever gets a `NEXT_PUBLIC_` prefix.**
- **crm → Cloudflare Pages**: set `VITE_API_URL`, `VITE_WEB_APP_URL`, `VITE_ASSET_BASE_URL`.
- CORS: the API allow-lists `WEB_APP_URL` / `LMS_APP_URL` / `CRM_APP_URL` — set these to the real
  deployed origins. Leave `EXTRA_CORS_ORIGINS` **unset** in production.

---

## 5. Deploy sequence (staging first)

1. Provision **staging** copies of everything in §3 (separate Supabase project / Upstash DB /
   Resend key / Razorpay **test** keys / R2 bucket). Staging may keep Razorpay in TEST.
2. Point CI secret `DATABASE_URL_STAGING_OR_PROD` at the staging Supabase **direct** URL.
   CI runs `prisma migrate deploy` **before** the container deploys (never in the entrypoint —
   avoids replica migration races).
3. Deploy API to Railway (staging) → confirm `/api/v1/health/ready` returns 200 (both Postgres
   **and** Redis `ok`). If it 503s, Redis or DB env is wrong.
4. Deploy web/lms to Vercel preview, crm to CF Pages preview.
5. Run the §6 verification gates against staging.
6. **Only then** provision production, flip Razorpay to **LIVE** keys + live webhook secret, and
   repeat the deploy against prod secrets.

---

## 6. Verification gates before paid production

Do not take real money until all of these pass **on staging** (then re-confirm on prod):

- [ ] **Payment round-trip**: complete a Razorpay **test** checkout → webhook received & signature
      verified → enrollment created → invoice PDF generated & stored in R2 → receipt email sent.
- [ ] **Webhook secret sanity**: temporarily send an unsigned webhook → confirm it is **rejected**
      (proves `RAZORPAY_WEBHOOK_SECRET` is wired, not silently open).
- [ ] **Auth**: login (all three app audiences), refresh rotation, password reset email, TOTP 2FA
      enroll/verify for an admin.
- [ ] **OTP**: MSG91 sends a real OTP to a real phone (requires DLT approval).
- [ ] **WhatsApp**: an approved template message delivers to a real number; inbound webhook verifies.
- [ ] **Storage**: assignment upload + certificate download via presigned R2 URLs (real bytes land).
- [ ] **k6 load test** (`R11`) run against staging at target concurrency — the last open input to
      any read-replica / scaling decision for the 100k-student target.
- [ ] **AV / malware scan on uploads** (`R8`) — still unbuilt; either build it or accept the risk
      in writing before faculty download student uploads.
- [ ] **Observability**: force a test exception → confirm it reaches Sentry; `/metrics` requires the
      token.
- [ ] **Fail-closed proof**: confirm a prod-config container with a missing provider key **refuses
      to boot** (it should) — this is the safety net, verify it's intact.

---

## 7. Conservative cleanup (audit-confirmed — this is the whole list)

The repo is already clean. Safe actions:

- **Untracked local junk** (not in git, just delete locally): `scripts/.dev-*.log`,
  `keys/*.pem` (regenerated by `pnpm gen:keys`).
- **`/asserts`** (repo-root, ~3.2 MB, **tracked**): 9 design source images whose runtime copies
  already live in `apps/web/public/images/**`. **Verify each has a `public/` counterpart, then**
  remove. It is not referenced at build/runtime (only a code comment mentions it). *Recommended
  but requires the counterpart check — do not delete blind.*
- **`prisma/seed-medical.ts`** (BiPC dataset, `pnpm db:seed:medical`): zero test references, but it
  may be **intended business seed data**, not throwaway. **Confirm intent before removing.**

**Do NOT remove:** `prisma/seed.ts` (integration tests throw "run pnpm db:seed first" without it),
anything under `apps/api/test/` (fixtures + specs are the merge gate), the `apps/web` page-builder
fallbacks, or the CRM-preferring showcase fallback arrays (they're resilience, not fake data).

---

## 8. Twilio fallback (only if Meta WhatsApp onboarding stalls)

Twilio WhatsApp onboarding is faster than Meta business verification. If you need WhatsApp live
before Meta verifies, add a Twilio adapter — it's a contained job because the seam already exists:

1. New adapter `apps/api/src/modules/notifications/providers/whatsapp/twilio-whatsapp.provider.ts`
   implementing `WhatsAppProvider` (`send`, `verifyWebhookSignature`).
2. Add `"twilio"` to the `WHATSAPP_PROVIDER` enum in `apps/api/src/config/env.ts` and a case in
   `whatsapp-provider.module.ts`'s factory.
3. New env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (`whatsapp:+…`),
   webhook signature via `X-Twilio-Signature`.
4. Register your **same WABA (9177748321)** in Twilio's WhatsApp sender.

Same pattern applies if you ever want Twilio SMS (implement `SmsProvider`, add `"twilio"` to
`SMS_PROVIDER`). Ask and I'll build either adapter — ~half a day each with tests.

---

## 9. Owner action list (what only you can do)

Everything below is credential/account work — I cannot do it for you:

1. Create Supabase project (ap-south-1) → capture direct + pooled URLs.
2. Create Upstash Redis (ap-south-1, TLS).
3. Resend: verify domain (DKIM/SPF), sending API key, webhook secret.
4. Meta: **start business verification now** (longest lead time), then Phone Number ID + system
   user token + app secret + webhook.
5. Razorpay: activate Live, generate live keys, create webhook + secret.
6. Cloudflare: R2 bucket + token; Turnstile site/secret keys; **rotate the exposed `cfat_` tokens**.
7. MSG91: account + **DLT registration** (entity, sender, templates) — has real lead time.
8. Generate all prod signing secrets + prod JWT keypair; load into Railway + Vercel + CF Pages.
9. Decide: launch with recorded video (→ Mux/Stream) or defer it.

Hand me the endpoints/config once created and I'll wire the env, run the staging deploy, and drive
the §6 verification.
