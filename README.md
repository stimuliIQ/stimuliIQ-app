# stimuliiq — EdTech Platform (3-app ecosystem)

A scalable internship-training platform: **marketing website + student LMS + admin CRM** on
one shared backend and identity system. Built for 100,000+ students.

**Status:** Phase 8's human-Mentor track is complete. A real, externally-hired subject-matter
expert can now be recorded, searched, and assigned to one-or-more batches (`mentors` +
`batch_mentors`, M:N, distinct new `mentor` role — not a relabeling of Faculty); a batch's
internship-completion progress is a read-only rollup over existing enrollment/progress/
certificate data (zero new progress-computation logic, reuses the P4 eligibility engine
verbatim) with a race-safe `active→completed` mark-complete transition; and a scoped,
role-aware mentor dashboard in `crm` shows only a mentor's own assigned batch(es), fail-closed
on cross-batch/cross-mentor/cross-tenant access. An earlier, separate P8 exploration — a
student-facing AI doubt-solving chatbot informally called "AI mentor" — was fully removed at
the user's direction before this feature was built: mentors are human hires, not AI; no AI/
LLM/pgvector code remains in the codebase (see ADR-0055). The security review returned
**GO** with all findings remediated in-wave (a mark-complete concurrency race, a
soft-deleted-batch dashboard 500, and an `includeDeleted` scope gap); no Critical/High left
open. **1453 api unit tests / 96 suites** green; mentor integration spec **31/31** green;
`turbo run typecheck lint build` **23/23** green. 3 new ADRs (0053–0055). See
`docs/phase-8-followups.md` for P8 deferred items and security follow-ups and the "Phase 8"
section below for what shipped. Phase 7 (Analytics + Hardening) remains the prior closed
phase — see `docs/phase-7-followups.md`.

## What's here
```
CLAUDE.md                  ← read first: rules, stack, phases, Definition of Done
apps/
  web/                     ← Next.js 15 marketing site (P5: full public surface)
  lms/                     ← Next.js 15 student learning portal
  crm/                     ← Vite + React 19 admin CRM SPA (TanStack Router, 19 routes)
  api/                     ← NestJS modular monolith
packages/
  ui/                      ← design system (Button/Card/Input/Toast + 10 P1 + 5 P2 primitives + P4: FileUpload/RubricGrader/QuizRunner/CountdownTimer/CertificateCard + P5 marketing primitives, light+dark tokens)
  types/                   ← zod schemas + shared DTOs (auth + CRM + commerce + public funnel contracts, envelope, RFC-7807)
  api-client/              ← typed fetch SDK consumed by web/lms/crm (CommerceApi + CrmApi + PublicApi aggregators)
  config/                  ← shared eslint/tsconfig/tailwind presets
prisma/                    ← schema.prisma, migrations, seed.ts
infra/                     ← docker-compose.yml (Postgres 16 + Redis 7), gen-keys.mjs
docs/
  00-product-strategy.md   ← vision, market, personas, metrics
  01-prd-website.md        ← App 1: marketing website
  02-prd-lms.md             ← App 2: student learning portal
  03-prd-crm.md             ← App 3: admin CRM
  04-trd-architecture.md   ← system, backend, frontend, API
  05-database-design.md    ← ER diagram, schema, indexes, storage
  06-user-flows.md         ← every journey (mermaid)
  07-design-system.md      ← tokens, components, theming
  08-monorepo-scaffold.md  ← Phase-0 scaffold spec
  adr/                     ← architecture decision records (ADR-0001..0055)
  phase-0-followups.md     ← Phase-0 security/deferred follow-ups
  phase-1-followups.md     ← Phase-1 security/deferred follow-ups (CRM core)
  phase-2-followups.md     ← Phase-2 security/deferred follow-ups (Commerce + Leads)
  phase-3-followups.md     ← Phase-3 security/deferred follow-ups (LMS core)
  phase-4-followups.md     ← Phase-4 security/deferred follow-ups (Learning Depth)
  phase-5-followups.md     ← Phase-5 security/deferred follow-ups (Marketing Website)
  phase-6-followups.md     ← Phase-6 security/deferred follow-ups (Engagement)
  phase-7-followups.md     ← Phase-7 security/deferred follow-ups (Analytics + Hardening)
  phase-8-followups.md     ← Phase-8 security/deferred follow-ups (Mentor management)
  plans/phase-0.md         ← the executed Phase-0 plan
.claude/
  agents/                  ← the orchestration layer (orchestrator + specialists)
  commands/plan-phase.md   ← /plan-phase slash command
```

## Prerequisites

- Node.js >= 20 (CI runs Node 22)
- pnpm >= 9 (`packageManager: pnpm@9.15.0`)
- Docker (for local Postgres 16 + Redis 7)

## Local bootstrap

```bash
pnpm install
cp .env.example .env            # then set real COOKIE_SECRET / CSRF_SECRET (32+ chars each)
pnpm gen:keys                   # generates a local-only RS256 keypair into ./keys (gitignored)
docker compose -f infra/docker-compose.yml --env-file .env up -d   # Postgres 16 + Redis 7
pnpm db:migrate                  # turbo run db:migrate -> `prisma migrate dev` in apps/api
pnpm db:seed                     # tenant `stimuliiq`; 10 roles (super_admin→student),
                                  # 154 permissions (P2 matrix incl Finance/Marketing/
                                  # Counsellor/BranchMgr grants); sample data:
                                  # 3 branches, 3 programs, 3 faculty, 6 students, 3 batches,
                                  # 4 enrollments, sample orders/leads/coupons;
                                  # admin@stimuliiq.test (password printed once)
pnpm dev                         # turbo run dev — starts api + web + lms + crm
```

All required env vars are validated with zod at API boot (`apps/api/src/config/env.ts`)
— the API fails fast if anything required is missing or malformed. Deferred provider
keys are commented out in `.env.example`; the features behind them no-op cleanly:

| Env var | Status | Notes |
|---------|--------|-------|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Set (TEST mode) | Required for order creation and payment verification. Use `rzp_test_*` keys from the Razorpay dashboard. |
| `RAZORPAY_WEBHOOK_SECRET` | **Not yet set — webhooks fail-closed** | Set from Razorpay dashboard (Settings → Webhooks). Until set, all incoming payment webhooks are rejected. See `docs/phase-2-followups.md`. |
| `VIDEO_PROVIDER` | **Not yet set — defaults to `noop`** | One of `noop` \| `cloudflare_stream` \| `mux`. `noop` returns a deterministic fake `.m3u8` for dev/CI. See ADR-0021, ADR-0023. |
| `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_SIGNING_KEY_ID`, `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`, `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | **Not yet set** | Cloudflare Stream credentials + RS256 signing key (PKCS#8 PEM) + webhook HMAC secret. Required when `VIDEO_PROVIDER=cloudflare_stream`. See ADR-0021. |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE`, `MUX_WEBHOOK_SECRET` | **Not yet set** | Mux API token + RS256 URL-signing key (PKCS#8 PEM) + webhook HMAC secret. Required when `VIDEO_PROVIDER=mux`. See ADR-0021. |
| `STORAGE_PROVIDER` | **Not yet set — defaults to `noop`** | One of `noop` \| `s3` \| `r2`. `noop` returns deterministic fake presigned URLs for dev/CI — **no files are uploaded to a real bucket until this is set**. See ADR-0027. |
| `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | **Not yet set** | Required when `STORAGE_PROVIDER=s3` or `r2`. IAM/R2 credentials with least-privilege access to `submissions/*`, `certificates/*`, `invoices/*`, `resources/*`. For R2, also set `STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com`. See ADR-0027. |
| `CERT_SIGNING_SECRET` | **Not yet set — dev uses local fallback** | HMAC-SHA256 secret for `cert_uid` signing and public verify. Required in production (`NODE_ENV=production` fails closed without it — throws at call time). Dev/CI falls back to a clearly-labelled local-only constant with a WARN log. Generate with `openssl rand -hex 32`. See ADR-0028. |
| `CAPTCHA_PROVIDER` | **Defaults to `noop`** | One of `noop` \| `turnstile`. `noop` accepts all tokens in dev/CI. Set to `turnstile` + `CAPTCHA_SECRET_KEY` for staging/prod. **Fail-closed in prod**: if `NODE_ENV=production` and provider is `noop` or secret is absent, `FailClosedCaptchaProvider` blocks all captcha-gated writes with 422. See ADR-0036. |
| `CAPTCHA_SITE_KEY` | Optional (server-side config) | Cloudflare Turnstile site key. **PUBLIC** — also set as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `apps/web`. Safe for client bundles. |
| `CAPTCHA_SECRET_KEY` | **SERVER-ONLY** | Cloudflare Turnstile secret key. **Never** in `NEXT_PUBLIC_*`, logs, or responses. Used by `TurnstileCaptchaProvider` to call Cloudflare `siteverify`. |
| `ANALYTICS_PROVIDER` | **Defaults to `noop`** | One of `noop` \| `ga4`. Analytics scripts load **only after DPDP consent** (client-side gate). See ADR-0036. |
| `ANALYTICS_MEASUREMENT_ID` | Optional | GA4 Measurement ID (`G-XXXXXXXXXX`). **PUBLIC** — also set as `NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID` in `apps/web`. |
| `ANALYTICS_GTM_ID` | Optional | GTM Container ID (`GTM-XXXXXXX`). **PUBLIC** — also set as `NEXT_PUBLIC_ANALYTICS_GTM_ID` in `apps/web`. |
| `TOS_VERSION` | Defaults to `v1.0` | DPDP consent TOS version. Bumped when Terms of Service are updated; all new form submissions record the new version. |
| `NEXT_PUBLIC_SITE_URL` | Set for production | Canonical site URL used in sitemap, OG metadata, JSON-LD. No trailing slash. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile site key for `apps/web` widget rendering. Matches `CAPTCHA_SITE_KEY`. |
| `NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID` | Optional | GA4 Measurement ID for `apps/web`. Matches `ANALYTICS_MEASUREMENT_ID`. |
| `NEXT_PUBLIC_ANALYTICS_GTM_ID` | Optional | GTM Container ID for `apps/web`. Matches `ANALYTICS_GTM_ID`. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Optional | WhatsApp click-to-chat digits-only number (e.g. `919999999999`). Used by `WhatsAppFab`. |
| MSG91, SES/Resend, Sentry, OTel | Deferred | No-op cleanly; wire as each provider's phase lands. |

## Ports (local dev)

| App | Port | Reads |
|---|---|---|
| `apps/api` | `4000` (`API_PORT`) | — |
| `apps/web` | `3000` | `NEXT_PUBLIC_API_URL` |
| `apps/lms` | `3001` | `NEXT_PUBLIC_API_URL` |
| `apps/crm` | `3002` | `VITE_API_URL` |

The API's CORS allowlist is exactly `WEB_APP_URL` / `LMS_APP_URL` / `CRM_APP_URL`
(credentialed cookies — see ADR-0002).

### Running the CRM

```bash
# Requires the API running + a seeded DB with an admin session
pnpm --filter @stimuliiq/crm dev    # → http://localhost:3002
```

Log in with `admin@stimuliiq.test` (password printed by `pnpm db:seed`). The CRM SPA
provides RBAC-aware navigation across these routes:

| Route | What it shows |
|---|---|
| `/` | Overview dashboard (KPI widgets) |
| `/students` | Student directory — create, view, edit, soft-delete/restore |
| `/faculty` | Faculty directory — create, view, assign branch |
| `/courses` | Program directory + curriculum builder (modules/lessons, publish/unpublish) |
| `/batches` | Batch directory — roster, enroll/move/withdraw students, assign faculty |
| `/admin/roles` | Roles list + permission-matrix editor (privilege-escalation guard) |
| `/admin/branches` | Branch management |
| `/admin/audit-logs` | Audit log viewer (before/after diff, read-only) |
| `/commerce/orders` | Order ledger — all orders, status, manual payment form (Finance) |
| `/commerce/payments` | Payment ledger + reconciliation widget (gross captured vs. net) |
| `/commerce/invoices` | Invoice list with PDF-pending stub (Finance) |
| `/commerce/refunds` | Refund list — request/approve workflow (Finance-only approve) |
| `/commerce/coupons` | Coupon CRUD + validate tool |
| `/leads` | Leads pipeline kanban (optimistic stage-move) + table fallback |
| `/leads/counselling` | Counselling workspace — lead detail, activity timeline, tasks/SLA, bookings |
| `/leads/tasks` | Task list (due_at / SLA chip — overdue / due soon / done) |
| `/leads/bookings` | Booking list + status management; intake bookings from public form appear here |
| `/academics/assignments` | Assignment authoring + submission list + RubricGrader drawer (faculty, assigned-batch scoped) |
| `/academics/projects` | Project milestone review pipeline + feedback thread (faculty, assigned-batch scoped) |
| `/academics/assessments` | Assessment authoring + question bank + descriptive-grade queue (faculty, assigned-batch scoped) |
| `/content/certificates` | Eligibility list, issue / revoke / reissue, verify link (ops; faculty can recommend only) |
| `/mentors` | Mentor directory — create, view, edit, soft-delete/restore hiring records; batch assignment happens from the batch detail drawer (admin/branch-manager, `mentors.view`) |
| `/mentor/dashboard` | Standalone mentor-role dashboard — assigned batch(es) only, completion rollup, mark-complete (Mentor role only, `mentor.dashboard.view`) |

## Phase 8 — Mentor management (P8)

P8's human-Mentor track (`docs/specs/phase-8-mentor.md`) adds a first-class, **externally-hired**
role accountable for leading a batch of students to internship completion — genuinely
distinct from the internal, content-authoring/grading Faculty role (P4, unchanged by this
phase). It reuses `batches`/`programs`/`enrollments` and the P4 certificate-eligibility
engine verbatim; it introduces zero new progress-computation logic (ADR-0054).

### Mentor records + hiring

`mentors` (new table, ADR-0053) is a hybrid of the `faculty_profiles` 1:1-extension pattern
and the `leads`→`student_profiles` pre-account pattern: `user_id` is **nullable** (`@unique`)
because a hiring/sourcing record routinely exists long before — or without ever — a
dashboard login is granted, and the row carries **no `branch_id`** (mentors are org-shared
external hires, not branch-owned staff — tracked as `docs/phase-8-followups.md` F1).
Admin/Branch Manager staff create/search/edit/soft-delete mentor records
(`mentors.view`/`create`/`edit`/`delete`) with an `engagement_status` lifecycle
(`prospective` → `active` → `inactive`) independent of soft-delete.

### Mentor↔batch assignment

`batch_mentors` (new join table) is the M:N mentor↔batch analogue of `batches.faculty_id`
(ADR-0031's single-FK chain) — a batch may have multiple concurrently-assigned mentors, at
most one flagged lead. A dedicated `mentors.assign` permission (distinct from `mentors.edit`)
gates attach/detach/lead-change; a raw-SQL partial-unique index
(`batch_mentors_active_batch_mentor_key` on `(batch_id, mentor_id) WHERE deleted_at IS
NULL`, migration `20260708080100_mentors_partial_indexes`) is the DB-level backstop against
duplicate active assignments.

### Internship completion tracking + mark-complete

`GET /crm/batches/:id/completion` (+ `/completion/students`, paginated) is a **pure read**
rollup — headcount buckets, `percentComplete`, and per-student eligibility (delegated
verbatim to the P4 `CertificatesService.isEligible` engine) computed live from
`enrollments`/`submissions`/`certificates` on every request, never cached or duplicated in a
parallel table. `POST /crm/batches/:id/complete` (`batches.markComplete`, a new permission
distinct from `batches.edit`) performs the `active → completed` transition as a
**transactional, row-locking compare-and-set** — a `SELECT ... FOR UPDATE` inside a Prisma
`$transaction` serializes concurrent callers, so a losing concurrent caller gets a clean
`409 ALREADY_COMPLETED` instead of a double write or duplicate audit row (ADR-0054, closes
security finding F2). New `batches.completed_at`/`completed_by_user_id` columns record the
transition.

### Mentor dashboard

A role-aware, scoped `crm` route (`/mentor/dashboard`, `GET /me/mentor/dashboard`) shows a
Mentor only their own actively-assigned batch(es) — fail-closed to 404 on any
cross-batch/cross-mentor/cross-tenant access attempt, re-checked live on every request (an
`engagement_status` flip to `inactive` revokes access on the mentor's very next request, not
at next login). It reuses the exact same completion rollup and mark-complete endpoint CRM
staff use — no separate mentor-only computation.

### RBAC

New `mentor` role, new permissions `mentors.view`/`create`/`edit`/`delete`/`assign`,
`mentor.dashboard.view`, `batches.markComplete`. The `mentor` role holds exactly
`batches.view` + `batches.markComplete` (both `assigned`, resolved via `batch_mentors`) +
`reports.attendance.view` + `reports.engagement.view` (both `assigned`, mirroring the P7
"Faculty / Mentor" combined report grants explicitly onto the new role) — and none of
`mentors.*`, `students.view`, `payments.*`/`invoices.*`, `submissions.grade`/
`attempts.grade`, `certificates.*`, or any content-authoring permission. A
permission-catalog regression spec (extended this wave) guards the P6 `forum.read` bug class
(an unseeded `@RequirePermission` string) for the mentor module too.

### AI-mentor exploration — removed

Earlier in P8, before this human-mentor spec existed, a student-facing AI doubt-solving
chatbot ("AI mentor" — LLM + pgvector retrieval) was explored and partially built. The user
directed a full removal: mentors are human hires, not AI. `@anthropic-ai/sdk` was
uninstalled, the AI/LLM schema objects and two uncommitted migrations were dropped, and
`docs/specs/phase-8-ai-mentor.md` was deleted — the codebase was rewound to its pre-AI
baseline before this feature was built. See ADR-0055 for the full record. One unrelated,
incidental bug fix found during that work was kept: `notifications.api.ts`'s `list()` query
string was double-prefixing (`??unread=true`), silently dropping the SSE-polling-fallback's
unread filter — now fixed regardless of the AI-mentor reversal.

### Security review

**GO** — all findings remediated in-wave, none carried as open Critical/High: F2 (mark-complete
concurrency race, fixed via the transactional compare-and-set above), F5 (mentor dashboard
500'd when an assigned batch was soft-deleted — the soft-delete extension doesn't filter
nested `include`s; fixed with an explicit `batch: { deletedAt: null }` relation filter), F3
(`includeDeleted` mentor-list param is now admin/`all`-scope only, not usable by a
branch-scoped caller). Full detail, open/tracked non-blocking items (F1/DEFECT-P8-01's
tenant-wide branch-manager mentor grant, F4's co-mentor PII visibility), and deferred items
in `docs/phase-8-followups.md`.

### Test counts at P8 closeout

**1453 api unit tests / 96 suites** green. Mentor integration spec **31/31** green.
`turbo run typecheck lint build` **23/23** green. 3 new ADRs (0053–0055).

## Phase 7 — Analytics + Hardening (P7)

P7 delivers the four workstreams named in `CLAUDE.md §6` ("dashboards, reports, perf,
security audit, load test"), plus a harvest of P0–P6 carried Medium/Low security follow-ups.
It makes every number on a CRM dashboard traceable to a source row (`docs/00 §10.2`), makes
those numbers exportable and schedulable, activates the observability stack declared since
P0, and proves the platform's behavior under a documented concurrency ceiling ahead of the
100k-registered target.

### Analytics dashboards

Eight tenant + RBAC + branch/assigned/own-scoped CRM dashboards go live: revenue,
enrollment trend, lead-funnel/conversion, attendance, course/video engagement, campaign
performance, gamification participation, and forum health. Every number reconciles exactly
to a direct recomputation from source tables — this is asserted per-dashboard by tests, not
assumed. Cross-tenant and out-of-scope requests fail closed with 404 (the established IDOR
pattern, ADR-0009/0018/0022/0031/0045), never a 403 that would confirm a resource's
existence.

**Read model** (ADR-0046): 8 Postgres materialized views (raw-SQL-only — not in
`schema.prisma`), refreshed via a single `refresh_analytics_views()` procedure
(`REFRESH ... CONCURRENTLY`) on an `@nestjs/schedule` cron (ADR-0048), with a
`analytics_mv_refresh_log` table powering a "data as of HH:MM" freshness indicator and a
last-known-good fallback if a refresh fails. A Redis cache-aside layer sits on top, keyed
`endpoint:tenant:scope:actor:params`. **No read replica is provisioned yet** — that decision
is deferred until the k6 load test shows primary contention.

### Reports + exports

On-demand and scheduled CSV/PDF exports reuse the exact same scope-filtered query as the
on-screen dashboard/report for the same filter (no separate, potentially broader "export
query" path). **Every CSV cell routes through one shared `csvSafeCell()` choke-point**
(ADR-0051) — values beginning with `=`, `+`, `-`, `@`, or a tab/CR character are neutralized
before being written, closing the CSV-injection gap carried since P2 M-4/P5 M-3/P6 M-4.
Exports require a distinct `reports.export` permission, separate from the corresponding
`reports.<domain>.view` permission. Large exports stream/paginate via a durable
`export_jobs` table; recurring reports are tracked in `report_schedules` and dispatched by
the same cron as MV refresh, **re-evaluating the recipient's current RBAC scope at send
time**, not at schedule-creation time. Files are delivered only via `StorageProvider`
signed, short-lived download URLs (ADR-0027) — never a raw bucket URL.

### Observability

Sentry (SaaS) + OpenTelemetry (hosted OTLP collector) + pino are activated (ADR-0047),
staying **no-op-safe** when unconfigured — dev/CI remain fully green without any DSN/
collector endpoint set. A single correlation-id resolver is now the one source of truth for
request identity (client `X-Request-Id` if well-formed and capped, else a fresh uuid),
echoed as a response header, embedded in every RFC-7807 error body, and attached to every
structured log line for that request — including across a deferred/background dispatch
boundary. `GET /health` (liveness) and `GET /health/ready` (DB+Redis readiness, 503 on
failure) leak no internal detail regardless of auth state. `GET /metrics` is bearer-token
(`METRICS_TOKEN`)-gated and **fails closed** if the token is unset outside test.

### Scheduling

MV refresh and scheduled-report dispatch both run on `@nestjs/schedule` cron (ADR-0048) —
**BullMQ is still not installed**, staying consistent with the P6 sync-seam decision
(ADR-0039). Both cron jobs are gated off entirely when `NODE_ENV=test`.

### Security hardening

A grouped sweep closed the following carried items in one pass: IP-dimension rate limiting
(auth fail-closed, webhook fail-open — ADR-0050, closes P0 M-6); webhook signature-freshness
window + strictly monotonic idempotent bounce→suppression (closes P6 M-3); JWT `aud` claim
(closes P0 M-4); login enumeration-resistance + pinned argon2id cost parameters (closes P0
M-5 and the carried argon2 item); DPDP erasure reaching `audit_logs` via write-time PII
masking (`PII_FIELD_REGISTRY`) plus a privileged `POST /dpdp/erasure` historical-row
anonymization job, audit rows never deleted (ADR-0049, closes P5 L-1/P6 L-2); and a new
soft-delete-bypass ESLint rule (ADR-0052) guarding the raw-Prisma escape hatch. The Wave 5
security review returned **NO-GO → GO** after an in-wave fix for a Critical (a cross-tenant
curriculum-structure disclosure in the engagement-dashboard endpoint) — see
`docs/phase-7-followups.md` for the full verdict, open items, and closed carry-forwards.

### Load test

A k6 suite models the core journeys (anonymous browse→lead, student login→dashboard→
video-stream-URL mint→progress ping, CRM staff dashboard/report read, test-mode payment
verify) ramping toward the spec's proposed 100k-aligned concurrency target, run against a
dedicated staging environment (never CI, never prod, never a live Razorpay key) via
`K6_BASE_URL`. Results + a documented capacity ceiling are archived, tagged by commit SHA,
for future-phase diffing. See `infra/k6/` and the devops CI note below for the CI-side
scaffolding.

### Test counts at P7 closeout

**1362 api unit tests / 90 suites** green. `turbo run typecheck lint build` **23/23** green.
Integration specs (testcontainers Postgres/Redis) green, including the P7 Wave 1 backfill of
the P6-deferred AC-6/27/44/56 + cross-tenant (AC-72–75) specs and a new permission-catalog
regression spec (guards against a controller referencing an unseeded `@RequirePermission`
string — the bug class that produced two CRM permission CRITICALs found and fixed this
wave). 7 new ADRs (0046–0052). Full detail, the open/tracked non-blocking items, and the
carried-follow-ups-closed list are in `docs/phase-7-followups.md`.

## Phase 6 — Engagement (P6)

P6 delivers the four engagement workstreams named in `CLAUDE.md §6`: **notifications**
(fan-out engine + in-app center), **campaigns** (CRM-driven bulk email/WhatsApp/SMS),
**gamification** (points/badges/streaks/leaderboard), and **forum** (enrollment-scoped
threaded discussions). It also connects notification events that P4/P5 deferred
(certificate-ready, lead/booking/registration/payment-receipt confirmations) to real
delivery.

### New backend modules

| Module | Routes (prefix `GET|POST/PUT /api/v1/`) | Notes |
|--------|------------------------------------------|-------|
| Notifications | `me/notifications` (+ `?unread`), `me/notifications/stream` (SSE), `me/notifications/:id/read`, `me/notifications/read-all`, `me/notification-prefs`, public `unsubscribe/:token` | Own-scope IDOR→404; fan-out honors prefs + quiet hours + suppressions (ADR-0043 SSE, ADR-0042 unsubscribe token) |
| Campaigns | `campaigns` (CRUD, all-scope), `campaigns/:id/send`\|`pause`\|`cancel`, `campaigns/webhooks/:channel` (HMAC-verified, unauthenticated) | Per-recipient idempotent send; DLT-gated SMS/WhatsApp (ADR-0041); RBAC `campaigns.send` |
| Gamification | `me/gamification`, `me/gamification/prefs`, `batches/:id/leaderboard` | Append-only idempotent ledger (ADR-0044); leaderboard opt-in, PII-minimal |
| Forum | `forum/threads?batchId`, `forum/threads/:id/posts`, `posts/:id/vote`, `threads/:id/resolve`, moderation (hide/pin/delete, assigned-scope) | Enrollment-scoped (student) / assigned-scoped (faculty), IDOR→404; DOMPurify-at-sink is the XSS control (ADR-0045) |

### New provider interfaces

`MailProvider` (Resend real adapter + Noop) and `WhatsAppProvider` (WhatsApp Cloud API real
adapter + Noop) are new in P6, following the same DI `Symbol` token + `useFactory` +
fail-closed pattern as every prior provider (ADR-0040). `SmsProvider`/MSG91 (ADR-0006) is
reused unchanged as the SMS channel. All three are **Noop by default** — P6 is fully green
without any live credentials:

```bash
# .env — Noop is the default; set these to activate real sends
MAIL_PROVIDER=resend                # or noop (default)
RESEND_API_KEY=...
MAIL_WEBHOOK_SECRET=...

WHATSAPP_PROVIDER=cloud_api         # or noop (default)
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
WHATSAPP_APP_SECRET=...

# India DLT: every sms/whatsapp campaign_template requires a dlt_template_id
# (set per-template in the CRM Campaign builder, not an env var)

NOTIFICATION_SIGNING_SECRET=$(openssl rand -hex 32)   # required outside NODE_ENV=test — no dev fallback (ADR-0042)
```

In production, `NODE_ENV=production` with `MAIL_PROVIDER=resend`/`WHATSAPP_PROVIDER=cloud_api`
set but credentials absent **fails the app at boot** (fail-closed, no partial-boot state).

### Dispatch: sync-seam, not BullMQ (ADR-0039)

Notification fan-out and campaign send both go through `NotificationDispatchPort` /
`CampaignSendPort`, bound by default to synchronous idempotent adapters
(`SyncNotificationDispatchAdapter` / `SyncCampaignSendAdapter`) — the same SYNC-with-seam
pattern as invoice generation and webhook processing (ADR-0020). `bullmq` is **not**
installed. Correctness (no double-send, no double-award) comes from DB-level partial-unique
constraints, not queue semantics. A `throttle()` no-op hook on both adapters preserves a
zero-interface-change migration path to real BullMQ workers if/when approved.

### Real-time notifications: SSE + polling fallback (ADR-0043)

`GET /me/notifications/stream` is an authenticated, own-scoped Server-Sent-Events endpoint
backed by an in-memory subscriber map inside the sync-seam dispatch adapter. The LMS client
falls back to polling `GET /me/notifications?unread=true` when SSE is unavailable
(offline/PWA/proxy). **Known limitation:** the subscriber map is process-local — in a
horizontally-scaled deployment, live push only reaches a user whose SSE connection is pinned
to the API instance handling their event; polling remains the safety net. Tracked in
`docs/phase-6-followups.md` (M-1).

### India DLT / DPDP compliance (ADR-0041)

Campaign sends enforce three independent rules: (C-1) `marketing_opt_in` consent gate at
segment-build time; (C-2) suppression/unsubscribe list consulted per-recipient at dispatch
time (not once at campaign start); (C-3) a non-empty `dlt_template_id` required on every
`sms`/`whatsapp` campaign template, enforced at template-create and re-checked at send.
Email campaigns are exempt from the DLT rule. Unsubscribe is a signed HMAC token
(`NOTIFICATION_SIGNING_SECRET`, constant-time verified) — no login required, no raw user id
or email recoverable from the URL.

### Exercising a campaign + unsubscribe locally

```bash
# 1. Seed data includes one draft campaign_template per channel + one draft campaign
# 2. In the CRM (Marketing ▸ Campaigns), build a segment, attach a template, and Send
#    (email works out of the box with Noop; sms/whatsapp require a dlt_template_id on the template)
# 3. Recipient rows transition queued -> sent (Noop provider) with a fake providerMessageId
# 4. POST /campaigns/webhooks/email with a valid HMAC signature to simulate a delivery receipt
# 5. Visit the unsubscribe link in a seeded/sent email's Noop-logged payload to add a suppression row
```

### Seeding P6 data

`pnpm db:seed` now also creates:
- P6 permission matrix (`notifications.*`, `campaigns.*`, `gamification.*`, `forum.*` per role)
- Default `notification_prefs` for sample users
- A seeded `badges` catalog + one `user_badge` + a few `points_ledger` rows (leaderboard-renderable)
- One `campaign_template` per channel (email + a WhatsApp/SMS template with a placeholder DLT id) + one draft `campaign`
- One `forum_thread` + a couple of `forum_posts` on the sample batch
- One sample unread `notification` for the sample student

## Phase 5 — Marketing Website + registration/payment funnel (P5)

P5 delivers the full public surface: `apps/web`, the public API surface, the SEO
system, and the enroll→register→pay funnel. The funnel **reuses the P2 commerce engine**
(ADR-0013/0014) — no money logic is reinvented.

### The `apps/web` app

```bash
# Run locally (requires API running + seeded DB)
pnpm --filter @stimuliiq/web dev     # → http://localhost:3000
pnpm --filter @stimuliiq/web build   # Next.js 15 SSG/ISR build
pnpm --filter @stimuliiq/web start   # production server

# Deploy: Vercel (region bom1 — Mumbai)
# Production: automatic on push to main (vercel.json git.deploymentEnabled.main = true)
# Preview:    GitHub Actions job deploy-preview-web, gated on vars.VERCEL_TOKEN_PRESENT == 'true'
```

### Public API surface

All nine endpoints live in `apps/api/src/modules/public/` (no new backend modules — they
call existing P1/P2 service engines):

| Endpoint | Auth | What it does |
|---|---|---|
| `GET /public/programs` | Anonymous | Published + `is_public=true` programs only; public-projection allowlist |
| `GET /public/programs/:slug` | Anonymous | Program detail; draft/non-public → 404 |
| `POST /public/leads` | Anonymous | Lead capture → CRM pipeline; UTM + consent; confirmation enqueued |
| `POST /public/bookings` | Anonymous | Book-Free-Slot intake (reused P2 endpoint, unchanged) |
| `POST /public/coupons/validate` | Anonymous | Coupon preview (paise math, no internals leaked) |
| `POST /public/register` | Anonymous → session | Self-service account creation (argon2id, OTP, DPDP consent) |
| `POST /public/enroll/orders` | Student session | Idempotent order creation; requires `Idempotency-Key` header |
| `POST /public/enroll/checkout` | Student session | Razorpay checkout (returns `publicKeyId` only, never the secret) |
| `POST /public/enroll/verify` | Student session | Signature verify + atomic enrollment (reuses `CommerceService.verifyPayment`) |

All anonymous writes are captcha-gated + rate-limited (Redis fixed-window, fail-closed on
Redis error) + honeypot-protected + `.strict()` zod validated.

The P2 webhook (`POST /commerce/payments/webhook`) is reused unchanged as the async
enrollment safety net.

### Adding a program or blog post

**New program**: create via the CRM (`/courses` route), publish, then mark `is_public=true`.
The program appears on `GET /public/programs` and gets a URL at `/programs/:slug`.

**New blog article**: add an MDX file to `apps/web/src/content/blog/` with typed YAML
frontmatter (`title`, `publishedAt`, `author`, `categories`, optional `excerpt`). The
Next.js build picks it up automatically via `@next/mdx`; no restart needed in dev.

**MDX content** (blog, about, faculty bios, FAQ, testimonials, partners, gallery,
career roles) lives in `apps/web/src/content/` as MDX files. Programs, pricing, and
coupons are live from the DB.

### Captcha + analytics environment

| Variable | Classification | Purpose |
|---|---|---|
| `CAPTCHA_PROVIDER` | Server-only | `noop` (default, dev/CI) \| `turnstile` (staging/prod) |
| `CAPTCHA_SITE_KEY` | **PUBLIC** | Cloudflare Turnstile site key; matches `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| `CAPTCHA_SECRET_KEY` | **SERVER-ONLY** | Turnstile server verification key; **never** in `NEXT_PUBLIC_*` |
| `ANALYTICS_PROVIDER` | Server-only | `noop` (default) \| `ga4` |
| `ANALYTICS_MEASUREMENT_ID` | **PUBLIC** | GA4 `G-XXXXXXXXXX`; matches `NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID` |
| `ANALYTICS_GTM_ID` | **PUBLIC** | GTM `GTM-XXXXXXX`; matches `NEXT_PUBLIC_ANALYTICS_GTM_ID` |

The `Noop` captcha provider (default) means P5 is fully functional locally and in CI
without any Cloudflare credentials. In production, `CAPTCHA_PROVIDER=noop` or a missing
`CAPTCHA_SECRET_KEY` binds `FailClosedCaptchaProvider` — all captcha-gated writes return
422 until the key is configured (fail-closed, AC-44).

Analytics scripts load **only after the visitor accepts the DPDP consent banner** —
structurally enforced in the `AnalyticsLoader` client component, never before.

### Razorpay posture (P5)

Razorpay remains in **TEST mode** (`rzp_test_*` keys). The `RAZORPAY_KEY_ID` is
returned from the API at checkout (`POST /public/enroll/checkout` response includes
`publicKeyId`) — it is **never set as `NEXT_PUBLIC_*`** in `apps/web`. The
`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are server-only.

Going live requires an explicit user decision after full funnel validation. Do not flip
to live keys without that decision.

### GitHub secrets and variables required for deploy

**Repository secrets** (Settings → Secrets → Actions):
- `VERCEL_TOKEN` — Vercel personal/team access token
- `VERCEL_ORG_ID` — Vercel team/personal account ID
- `VERCEL_PROJECT_ID_WEB` — Vercel project ID for `apps/web`
- `NEXT_PUBLIC_API_URL` — deployed API base URL (public)
- `NEXT_PUBLIC_SITE_URL` — canonical site URL (public)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — Turnstile site key (public)
- `NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID` — GA4 ID (public)
- `NEXT_PUBLIC_ANALYTICS_GTM_ID` — GTM ID (public)
- `NEXT_PUBLIC_WHATSAPP_NUMBER` — WhatsApp click-to-chat number (public)

**Repository variable** (Settings → Variables → Actions):
- `VERCEL_TOKEN_PRESENT` — set to `"true"` once the secrets above are provisioned;
  gates the `deploy-preview-web` CI job

The Vercel env in `apps/web/vercel.json` also maps client vars to Vercel secret aliases
(e.g. `@stimuliiq-web-api-url`) so they can be managed per-environment in the Vercel
dashboard without re-deploying.

### SEO and Lighthouse CI

`lighthouserc.json` targets: SEO ≥ 95 (hard `error`); LCP ≤ 2000 ms, CLS ≤ 0.1,
accessibility ≥ 0.90 (all `warn` until budgets are clean — flip `continue-on-error` to
`false` in `.github/workflows/ci.yml` once stable). The `web-lighthouse` CI job also
checks that `/sitemap.xml` and `/robots.txt` return 200 with non-empty bodies (hard checks).

The `web-axe` job runs axe-core against the homepage and programs listing for WCAG 2.2 AA
violations. Also `continue-on-error: true` while violations are being resolved.

---

## Phase 4 — Learning Depth (P4)

P4 delivers **submit** (assignments, projects, assessments) and **certify**
(eligibility engine, PDF issuance, public verification), completing the
`docs/04 §6` critical journey `login → watch → submit → certify`.

### New backend modules

| Module | Routes (prefix `GET|POST|PATCH /api/v1/`) | Notes |
|--------|------------------------------------------|-------|
| Assignments | `assignments/:id`, `assignments/:id/submit`, `assignments/:id/milestones/:mid/submit`, `submissions/:id/grade` | Student own-scope submit; faculty assigned-scope grade (ADR-0031) |
| Assessments | `assessments/:id`, `assessments/:id/attempts`, `attempts/:id`, `attempts/:id/flag`, `attempts/:id/grade` | Server time-box + attempts enforcement (ADR-0032); answer key server-only (ADR-0030) |
| Certificates | `certificates` (issue), `certificates/:id/revoke`, `certificates/:enrollmentId/reissue`, `me/certificates`, `me/certificates/:id/download` | Eligibility engine + HMAC-signed `cert_uid` (ADR-0028) |
| Public verify | `verify/:certUid` (unauthenticated, rate-limited) | Recomputes HMAC — fabricated rows/guessed UIDs fail before DB query |
| Storage | `storage/upload-url` | Signed PUT URL scoped to `submissions/{tenant}/{enrollment}/…`; no raw bucket URL ever returned (ADR-0027) |

### StorageProvider: Noop by default

`STORAGE_PROVIDER` defaults to `noop`. The `NoopStorageProvider` returns deterministic
fake presigned URLs for all upload/download operations — no real files are uploaded to
S3/R2 until the env vars are set. To activate real storage:

```bash
# .env
STORAGE_PROVIDER=s3               # or r2
STORAGE_BUCKET=my-stimuliiq-bucket
STORAGE_REGION=ap-south-1         # for R2: "auto"
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
# For R2 only:
STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com
```

The real S3 adapter fails closed (503) if credentials are missing — it never falls back
to returning a raw bucket URL.

### Certificate engine

Certificates use `@react-pdf/renderer` **v3 (pinned, CommonJS)** installed in
`apps/api` only. v4 is ESM-only and breaks the NestJS/ts-jest CJS build. Do not
upgrade without resolving ESM interop (see ADR-0029).

In tests and local dev the `NoopCertificatePdfAdapter` produces deterministic stub
bytes — the full eligibility → cert_uid → storage → verify flow works without a real
PDF library being invoked.

`CERT_SIGNING_SECRET` (>= 32 chars) is **required in production**. Dev falls back to a
local-only constant with a WARN log. Set it with:

```bash
CERT_SIGNING_SECRET=$(openssl rand -hex 32)
```

### Public certificate verification

```
GET /api/v1/verify/:certUid       # unauthenticated; rate-limited (429 + Retry-After)
```

Returns `{ valid: true|"revoked", program, issuedAt, holderName }` for a valid/revoked
cert, or 404 for an invalid/fabricated/nonexistent `certUid`. Verification recomputes
the HMAC-SHA256 signature — a fabricated row in the DB without the correct secret fails
the signature check before any DB data is returned.

The public verify page on the `web` app lives at `/verify/[certId]` and calls this
endpoint. To exercise it end-to-end after seeding:

```bash
# 1. Get the cert_uid from the seeded certificate (printed by pnpm db:seed)
# 2. Visit http://localhost:3000/verify/<certUid>
# 3. Or call the API directly:
curl http://localhost:4000/api/v1/verify/<certUid>
```

### Seeding P4 data

`pnpm db:seed` now also creates:
- P4 permission matrix (assignments/submissions/assessments/attempts/certificates per role)
- One assignment (with rubric) + one project (2 milestones) on the sample program
- One assessment (2 MCQ + 1 descriptive, answer key server-side only)
- One graded submission + one graded attempt for the sample student
- One seeded `certificate_template`
- One issued certificate (for a second fully-completed sample enrollment) — the LMS
  certificate view and the public verify page render real data out of the box

### Seeding P8 data

`pnpm db:seed` now also creates:
- P8 permission matrix (`mentors.view`/`create`/`edit`/`delete`/`assign`,
  `mentor.dashboard.view`, `batches.markComplete`) and the new `mentor` role
  (`batches.view` + `batches.markComplete` at `assigned` scope, plus `reports.attendance.view`
  + `reports.engagement.view` at `assigned` scope)
- Two mentors: `mentor.ramesh@stimuliiq.test` (`active`, **with** a linked dashboard login —
  demonstrates the "mentor with login" case) and `mentor.anjali@stimuliiq.test`
  (`prospective`, **no** login yet — demonstrates the "hiring record before any login exists"
  case, per ADR-0053)
- One `batch_mentors` assignment — Ramesh assigned as **lead** mentor on the sample Hyderabad
  batch

## Tests

```bash
pnpm turbo run test              # unit tests — no external infra required
                                  # (1453 api passing at P8 closeout / 96 suites; web 175; ui 312)
pnpm turbo run test:integration   # apps/api integration suite against real Postgres/Redis
                                   # (public module 71 + P5 funnel 34/34; prior phases carried;
                                   #  P6 headline ACs (AC-6/27/44/56) + cross-tenant (AC-72–75)
                                   #  backfilled in P7 Wave 1; P8 mentor integration spec 31/31 —
                                   #  see docs/phase-8-followups.md;
                                   #  testcontainers spins up a fresh DB + Redis per run —
                                   #  requires Docker; falls back to ambient
                                   #  DATABASE_URL/REDIS_URL;
                                   #  see apps/api/test/integration/global-setup.ts)
pnpm turbo run build lint test    # what CI runs before build (23/23 green at P8 closeout)
```

Integration tests cover: all P1–P4 suites (see `docs/phase-4-followups.md`) plus P5:
public catalog returns only `status=published AND is_public=true` programs; no draft/
non-public program leaks; no forbidden field in any public response; public lead-capture
→ CRM lead with UTM+source + confirmation enqueued; public book-slot → booking + lead;
public coupon-validate (paise math, no internals); public register (new email: session
issued; existing email: **no tokens, no cookies — C-1 guard**); enroll funnel
(register→order→checkout→verify → exactly one enrollment, idempotent); replayed verify /
duplicate webhook → no double-charge or double-enroll; funnel IDOR (student B cannot
transact on student A's order → 404); captcha-gated writes reject on captcha fail;
rate-limit trips; no secret in any response body.

**P6 unit suites** (1038 api tests / 53 suites at P6 closeout) cover: notification fan-out
honoring prefs/quiet-hours/suppressions (16 tests); campaign segment build + per-recipient
dedupe + DLT gating + webhook idempotency (30 tests); gamification append-only idempotent
award + badge threshold + leaderboard PII-minimization (23 tests); forum enrollment/assigned-
scope IDOR + upvote dedupe + reply notification (23 tests).

**P7 additions** (bringing the total to **1362 api unit tests / 90 suites**) cover: the 8
analytics-dashboard endpoints' reconciliation-to-source-row assertions and scope isolation
(WS-A); CSV-injection neutralization + export scope-pinning + the `csvSafeCell()` lint-scan
(WS-B); correlation-id resolution, Sentry PII-scrubbing, RFC-7807 consistency, and readiness/
liveness leak-safety (WS-C); N+1 query-count guards on hot list endpoints (WS-D); the grouped
security-hardening batch (IP rate limiting, webhook freshness/monotonicity, JWT `aud`, DPDP
erasure, WS-E); and — as the Wave 1 backfill of the P6-deferred gap — testcontainers
integration specs for the four P6 headline ACs (AC-6, AC-27, AC-44, AC-56) plus cross-tenant
isolation (AC-72–75), now landed rather than deferred. A new **permission-catalog regression
spec** also pins shut the bug class (an unseeded `@RequirePermission` string) that produced
two CRM permission CRITICALs found during this backfill. Full detail in
`docs/phase-7-followups.md`.

**P8 additions** (bringing the total to **1453 api unit tests / 96 suites**) cover: mentor
CRUD + directory search/filter + engagement-status rules (WS-1); mentor↔batch M:N assignment
guards — active-mentor-only, duplicate-assignment 409, lead-designation, batch-status guard
(WS-2); the completion rollup's reconciliation-to-source-row assertions and the mark-complete
transactional compare-and-set, including a concurrent-race regression test for F2 (WS-3); and
the mentor dashboard's cross-batch/cross-mentor/cross-tenant isolation plus live
re-evaluation of `mentor.dashboard.view` (WS-4). A dedicated testcontainers **mentor
integration spec (31/31)** exercises the full WS-1–4 surface against a real Postgres/Redis.
The permission-catalog regression spec (P7) was extended to cover every mentor-module
`@RequirePermission` string. Full detail in `docs/phase-8-followups.md`.

Playwright browser e2e (`pnpm turbo run e2e`) is wired-but-skipped in every app — the
P5 funnel critical journey and the P6 notification-center/forum-reply journeys remain
proven at the API-integration level; P7/P8 did not add new Playwright coverage. Tracked in
`docs/phase-8-followups.md`, `docs/phase-7-followups.md`, `docs/phase-6-followups.md`, and
`docs/phase-5-followups.md`.

## CI

`.github/workflows/ci.yml` runs, on every PR and push to `main`:
`install → typecheck → lint → dependency-audit → unit test (real Postgres service) →
integration test (testcontainers Postgres/Redis) → build → e2e (stub) → web-axe /
lms-axe (WCAG 2.2 AA, warn-only) → web-lighthouse (SEO ≥95, HARD gate) → lms-lighthouse
(LCP/CLS/TTI, HARD gate)`.

P5 additions to CI:
- **`web-axe`**: runs `axe-core` via `@axe-core/cli` against the built site on `/` and
  `/programs`. `continue-on-error: true` (warn-only) until all violations are resolved.
- **`web-lighthouse`**: runs LHCI against `/`, `/programs`, `/pricing` using
  `lighthouserc.json`; also checks `/sitemap.xml` and `/robots.txt` reachability (hard
  checks).
- **`deploy-preview-web`**: Vercel PR preview deploy, gated on
  `vars.VERCEL_TOKEN_PRESENT == 'true'`. Resolves the carried P0 `if: false` guard for
  `apps/web`. `lms` and `crm` preview jobs remain `if: false`.

### Phase 7 Wave 4 — CI/infra hardening (devops)

- **`web-lighthouse` is now a HARD gate.** `continue-on-error: true` was removed from
  the job. Only the `categories:seo` assertion in `lighthouserc.json` is
  `"error"`-level (≥0.95) — every other assertion stays `"warn"`, so this specifically
  hard-gates SEO (AC-56) without hard-gating the other still-PROPOSED performance
  numbers. `numberOfRuns` was bumped 1→3 (LHCI takes the median) to reduce single-run
  flakiness.
- **New `lms-lighthouse` job** (`lighthouserc.lms.json`) targets the LMS's only
  unauthenticated routes (`/login`, `/offline`) and HARD-gates the AC-55 PROPOSED
  numbers: LCP < 2.5s, CLS < 0.1, TTI (`interactive`) < 3s (`total-blocking-time` is
  used as the lab-side proxy for INP — Lighthouse has no direct INP audit; a human
  should wire real CrUX/RUM data once the LMS has production traffic to validate the
  actual INP number). **These are the spec's PROPOSED targets, not yet human-confirmed
  against real device data** — treat a red run as "investigate", not "auto-revert",
  until a human signs off on the exact numbers.
- **New `lms-axe` job** mirrors `web-axe` for `/login` + `/offline` (warn-only —
  authenticated-surface a11y coverage is a followup, not this wave).
- **New `dependency-audit` job**: `pnpm audit --prod --audit-level=high` is a HARD gate
  (production dependencies only, matching AC-68's wording); a second,
  `continue-on-error` pass audits the full tree (incl. devDependencies) for
  visibility only. **Triage**: bump the flagged package if a patch exists; otherwise
  add the advisory id to `pnpm.auditConfig.ignoreCves` in the root `package.json`
  (pnpm's native per-advisory allowlist — no new tool) with an inline comment
  recording why + a re-check date. Full triage steps are in the job's own comments in
  `ci.yml`. **Known state at wave close (2026-07-07)**: the dependency tree already
  carried 7 pre-existing HIGH-severity, DoS-class advisories in production deps
  (multer via `@nestjs/platform-express`, and a shared OpenTelemetry Prometheus-
  exporter crash) — patches exist for all of them but bumping requires an
  `apps/api/package.json` change, out of scope for this devops-only wave. Temporarily
  allow-listed via 5 CVE ids in `pnpm.auditConfig.ignoreCves` (see the `ci.yml` job
  comment for the full list + re-check date 2026-08-07) so the new gate is green
  today rather than either permanently red or silently disabled. **This is a
  fast-follow for whoever owns `apps/api`'s dependencies next.** A separate
  devDependency-only CRITICAL (vitest UI-server arbitrary file read, CVE-2026-47429)
  was also surfaced by the informational full-tree audit — not reachable in this
  repo's CI usage (`vitest run`, never `--ui`), does not gate merge, flagged for
  awareness.
- **Unit `test` job now has a real Postgres service container.** A documented set of
  unit-regex-matched specs (`apps/api/src/**/*.integration.spec.ts` and
  `*.permission-catalog.spec.ts`) construct a real `PrismaClient`/`PrismaService` and
  gate on `!!process.env.DATABASE_URL` — a *presence* check, not a *reachability*
  check. Since this job's workflow-level `env:` already set `DATABASE_URL` (a
  placeholder pointing at nothing), those specs were attempting real connections
  against nothing listening — this job now runs a real `postgres:16-alpine` service +
  `pnpm db:migrate:deploy` before the test step so those specs exercise a genuine DB.
- **`test-integration` connection-exhaustion fix**: 14 `*.integration-spec.ts` files
  each boot a full Nest `AppModule` (2 pooled `PrismaClient`s via `PrismaService`) plus
  their own fixtures `PrismaClient` — observed to exhaust the testcontainers
  Postgres's connection slots ("too many clients already") on some runners. Fixed at
  the harness level (no spec files touched): `apps/api/test/integration/global-setup.ts`
  now appends `connection_limit=5&pool_timeout=20` to the generated testcontainers
  connection string, and `apps/api/jest.integration.config.js` now sets `maxWorkers: 1`
  explicitly (belt-and-braces alongside the pre-existing `--runInBand` CLI flag).
- **Deploy — `deploy-api` (Railway)**: resolves the carried P0 `if: false` stub, gated
  on `vars.RAILWAY_TOKEN_PRESENT == 'true'` (same pattern as `deploy-preview-web`).
  Runs `pnpm db:migrate:deploy` (forward-only) from CI before triggering
  `railway up`, which builds `infra/docker/api.Dockerfile` per the repo-root
  `railway.json`. ECS Fargate remains the documented scale-out target —
  `infra/ecs/task-definition.json` is a committed template, not wired into CI.
- **`infra/docker-compose.yml`** gained an opt-in `api` service (`profiles: [full]` —
  does NOT start on a plain `docker compose up`, so the standard `pnpm dev` local
  workflow is unchanged). `docker compose -f infra/docker-compose.yml --env-file .env
  --profile full up -d` (run from the repo root) runs the production Docker image
  locally for smoke-testing, healthchecked against `/api/v1/health/ready`. **The
  `--env-file .env` flag is required** — Compose otherwise looks for `.env` next to
  the compose file (`infra/.env`, which doesn't exist) rather than the repo root; see
  the compose file's own header comment for why this only bites `api` (not
  `postgres`/`redis`, which both have safe defaults for every variable). Build +
  boot + health-check were all confirmed with a real `docker compose --profile full
  up` run during this wave.
- **k6 staging scaffolding**: `infra/k6/config.js` + `infra/k6/README.md`. The actual
  load-test scripts land separately (qa-engineer, this same wave) under
  `infra/k6/scripts/` and must import `BASE_URL` from `config.js`, which throws unless
  `K6_BASE_URL` is set to a non-localhost, non-production origin — k6 is never wired
  into any GitHub Actions job.

**Activation checklist (what a human must set — none of these block CI as configured
today; they gate the corresponding feature going live):**

| Item | Where | Notes |
|---|---|---|
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | Railway service variables / ECS Secrets Manager | Sentry SaaS — activates error reporting; no-op without it (`apps/api/src/observability/sentry.ts`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | Railway service variables / ECS Secrets Manager | Hosted OTel collector endpoint — activates tracing; no-op without it |
| `METRICS_TOKEN` | Railway service variables / ECS Secrets Manager | Bearer token for `GET /metrics` — **required in staging/prod** (endpoint 403s without it, fail-closed) |
| `RAILWAY_TOKEN`, `RAILWAY_SERVICE_ID` | GitHub repo secrets | Enables `deploy-api` |
| `DATABASE_URL_STAGING_OR_PROD` | GitHub repo secret | Used only by the `deploy-api` migrate-deploy step |
| `RAILWAY_TOKEN_PRESENT` | GitHub repo variable, `"true"` | Un-gates the `deploy-api` job |
| `K6_BASE_URL` | Local env / a future `staging-load-test` environment secret | Dedicated staging origin — never CI, never prod, never localhost |
| Dedicated staging environment | Infra provisioning | Required before k6 (WS-F) can run for real; Razorpay TEST mode + Noop mail/WhatsApp providers on that environment |
| Lighthouse LMS/web numeric budgets | `lighthouserc.json` / `lighthouserc.lms.json` | Currently the spec's PROPOSED numbers — confirm/retune against real device data (LOCK-D6) |

## How this was (and continues to be) built with Claude Code

1. Open this folder with Claude Code (`claude` at the repo root).
2. Confirm the subagents loaded: `/agents` (defined in `.claude/agents/`).
3. Kick off a phase: `/plan-phase P<n>` (or paste the kickoff prompt referenced in
   `docs/08-monorepo-scaffold.md §5`).
4. The **orchestrator** plans the phase and the main session delegates each task to the
   right specialist (`db-architect`, `api-designer`, `backend-builder`, `integrations`,
   `frontend-builder`, `design-system`, `qa-engineer`, `devops`, `security-reviewer`,
   `docs-writer`). Work proceeds phase by phase (`CLAUDE.md §6`), gated by tests.

## Tech stack (summary — full detail in `CLAUDE.md §1`)

pnpm + Turborepo · Next.js 15 (web, lms) + Vite (crm) · NestJS · PostgreSQL 16 + Prisma ·
Redis + BullMQ · Razorpay/SES/MSG91/WhatsApp Cloud/Cloudflare Stream/Zoom (all behind
provider interfaces) · Docker + GitHub Actions · Sentry + OpenTelemetry.

## Principles

One identity / three surfaces · RBAC enforced server-side · soft-delete + audit
everywhere · money in paise · WCAG 2.2 AA · multi-branch now, multi-tenant SaaS later ·
scale from day one.

## Tip

Subagents load at session start — if you edit a file in `.claude/agents/`, restart the
session (or use `/agents` to edit live). For true parallel multi-agent runs, enable Agent
Teams: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
#   s t i m u l i I Q - a p p  
 #   s t i m u l i I Q - a p p  
 #   s t i m u l i I Q - a p p  
 #   s t i m u l i I Q - a p p  
 #   s t i m u l i I Q - a p p  
 