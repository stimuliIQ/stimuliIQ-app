# 04 — TRD: System, Backend & Frontend Architecture

*The technical contract. Pair with `05-database-design.md`. Stack is fixed in `CLAUDE.md §1`.*

---

## 1. System architecture (high level)

```
                         ┌────────────────────────────────────────────┐
        Anonymous ─────▶ │  web (Next.js, SSR/SSG)  — CDN / Edge        │
                         └───────────────┬────────────────────────────┘
        Students ──────▶ │  lms (Next.js PWA)        │     │  crm (Vite SPA)  │ ◀── Staff
                         └───────────────┴─────┬─────┴─────┴──────────────────┘
                                               │ HTTPS (typed @repo/api-client)
                                       ┌───────▼────────┐
                                       │  API Gateway    │  (NestJS, REST + OpenAPI)
                                       │  Auth · RBAC    │
                                       └───────┬────────┘
        ┌──────────────────────────────────────┼───────────────────────────────────┐
        │  Modular monolith (NestJS) — clean module boundaries                       │
        │  auth · users · students · faculty · courses · batches · enrollments ·     │
        │  payments · certificates · attendance · assignments · projects ·          │
        │  assessments · video · live · leads/crm · marketing · notifications ·      │
        │  support · reports · admin/rbac · audit                                    │
        └───┬─────────────┬──────────────┬───────────────┬──────────────┬──────────┘
            │             │              │               │              │
      ┌─────▼────┐  ┌─────▼─────┐  ┌─────▼─────┐   ┌─────▼─────┐  ┌─────▼──────┐
      │ Postgres │  │  Redis     │  │  BullMQ    │   │  S3/R2     │  │  Read       │
      │ (Prisma) │  │ cache/sess │  │  workers   │   │  storage   │  │  replica    │
      └──────────┘  └───────────┘  └─────┬─────┘   └───────────┘  └────────────┘
                                          │ async jobs
   Providers (behind interfaces): Razorpay/Stripe · SES/Resend · MSG91 · WhatsApp Cloud ·
   Cloudflare Stream/Mux · Zoom/Meet · Sentry/OTel
```

**Why modular monolith first:** one deploy, one DB, fast iteration, strong module
boundaries → extract `video`, `notifications`, `payments`, `reports` into services only
when load demands it. No premature microservices.

---

## 2. Backend architecture (NestJS)

### 2.1 Layering (per module)
```
controller  → HTTP boundary: validates DTO (zod), maps to service, returns DTO
service     → business logic, transactions, orchestrates repositories + providers
repository  → data access only (Prisma), no business rules
provider    → external vendor adapter behind an interface
guard       → auth + RBAC + data-scope enforcement
event       → domain events → queue (notifications, audit, analytics)
```
**Rule:** controllers never touch Prisma; services never touch vendor SDKs directly;
repositories never contain business logic.

### 2.2 Module template
```
src/modules/<name>/
├── <name>.controller.ts
├── <name>.service.ts
├── <name>.repository.ts
├── <name>.module.ts
├── dto/            # zod schemas (re-exported from @repo/types)
├── events/         # domain events + handlers
└── <name>.spec.ts  # unit/integration tests
```

### 2.3 Authentication
- **JWT access token** (15 min, signed RS256) + **rotating refresh token** (7 d, stored
  hashed in DB, single-use, family-revocation on reuse detection).
- Login methods: email+password (argon2id), **OTP via MSG91** (phone), Google OAuth (opt).
- Tokens carry `sub`, `tenant_id`, `roles`, `scope`. Access token in memory / httpOnly
  cookie; refresh in httpOnly secure cookie. CSRF protection for cookie flows.
- Sessions tracked in Redis for revocation + device list.

### 2.4 Authorization (RBAC + permissions + scope)
- `roles` ↔ `permissions` (many-to-many) ↔ `users` (many-to-many, per tenant).
- Permission = `module.action` (e.g. `students.edit`, `certificates.issue`).
- **Data scope** dimension: `all | branch | assigned | own`, enforced in repository queries
  (e.g. counsellor sees only `assigned` leads).
- `@RequirePermission('students.edit')` guard + a `ScopeInterceptor` that injects scope
  filters into queries. **Never trust the client.**

### 2.5 Validation
zod schemas in `@repo/types`, shared by FE + BE. A global `ZodValidationPipe` validates all
inputs. Outputs serialized through response DTOs (no entity leakage, no over-fetching).

### 2.6 Service layer patterns
Transactions via Prisma `$transaction`; idempotency keys for payments/enrollment;
optimistic concurrency where needed; domain events emitted post-commit; soft delete via
`deleted_at` + global Prisma middleware that filters it out by default.

### 2.7 Caching
Redis: hot reads (program catalog, course curriculum, dashboards aggregates), session
store, rate-limit counters, idempotency keys. Cache-aside with explicit invalidation on
write. CDN caches public `web` content + media.

### 2.8 Queue system (BullMQ)
Queues: `email`, `sms`, `whatsapp`, `notifications`, `certificate-gen`, `video-webhook`,
`invoice-gen`, `report-export`, `campaign-send`, `dunning`. Workers are idempotent, retried
with backoff, dead-letter on exhaustion, observable. Heavy/bulk ops always go async.

**Implementation status:** P0–P8 built every one of these as a documented, seam-only
"BullMQ MIGRATION PATH" running **synchronously** on the request path (ADR-0020/0039) —
this section was aspirational, not actual, until Phase 9. `docs/plans/phase-9-completion.md`
T18 installed `bullmq` and wired a `QUEUE_DRIVER=bullmq` adapter alongside the existing
sync adapter for every port (notification/campaign dispatch, invoice-gen, webhook
processing, certificate/report PDF rendering, dunning reminders) — this section is now
**actually true** in a deployment that sets `QUEUE_DRIVER=bullmq` and runs the separate
worker process (`apps/api/src/worker.ts`). See ADR-0056 for the full adapter table and
the `QUEUE_DRIVER=sync` default that keeps local dev/CI Redis-free.

### 2.9 Notification system
Unified `NotificationService` → fans out to channels (in-app, push, email, SMS, WhatsApp)
based on user **preferences** + event type. Template registry per channel. Delivery + read
tracking. Triggered by domain events (deadline, grade, payment, certificate, live reminder).

### 2.10 Providers (adapters)
| Interface | Default impl | Swap target |
|-----------|-------------|-------------|
| `PaymentProvider` | Razorpay | Stripe / PayU |
| `MailProvider` | AWS SES | Resend / SendGrid |
| `SmsProvider` | MSG91 | Twilio |
| `WhatsAppProvider` | WhatsApp Cloud API | Gupshup |
| `VideoProvider` | Cloudflare Stream | Mux |
| `LiveClassProvider` | Zoom SDK | Google Meet / 100ms |
| `StorageProvider` | S3/R2 | any S3-compatible |

### 2.11 Certificate engine
Eligibility rules engine (completion + assessments + project) → render template (HTML→PDF
via headless or PDF lib) → assign **verifiable ID** = signed hash of (student, program,
issued_at, nonce) → store PDF in storage + row in `certificates` → public verify resolves
ID → status (valid/revoked). Revocation flips status; verify reflects instantly.

### 2.12 Video streaming architecture
Upload → `VideoProvider` transcode → **HLS adaptive** renditions → on play, backend mints a
**short-lived signed URL** scoped to (user, lesson) after an enrollment + RBAC check →
player overlays **per-user watermark** → no raw object URL ever reaches the client →
optional DRM (provider) for premium content. Webhooks update transcode status via queue.

### 2.13 Logging / monitoring / observability
Structured logs (pino, request id, tenant, user), **Sentry** (errors), **OpenTelemetry**
traces across modules + providers, metrics (Prometheus/Grafana): latency, queue depth,
payment success, video start time. Audit log is separate from app logs (immutable-ish,
append-only).

### 2.14 API structure
- REST, versioned `/api/v1`, resource-oriented, consistent envelope
  `{ data, meta, error }`, cursor pagination for large lists, RFC-7807 errors.
- **OpenAPI** generated → `@repo/api-client` typed SDK (FE never hand-writes fetches).
- Rate limiting per IP + per user; idempotency-key header on unsafe mutations.

Example surface (non-exhaustive):
```
POST /api/v1/auth/login            POST /api/v1/auth/refresh
GET  /api/v1/programs              GET  /api/v1/programs/:slug
POST /api/v1/leads                 POST /api/v1/bookings
POST /api/v1/orders                POST /api/v1/payments/verify   (webhook)
GET  /api/v1/me/enrollments        GET  /api/v1/lessons/:id/stream-url
POST /api/v1/assignments/:id/submit
GET  /api/v1/me/certificates       GET  /api/v1/verify/:certId    (public)
GET  /api/v1/crm/leads             PATCH /api/v1/crm/leads/:id
GET  /api/v1/crm/reports/revenue
```

---

## 3. Frontend architecture

### 3.1 Shared design system (`packages/ui`)
shadcn/ui + Radix primitives + Tailwind, themed by tokens (`07-design-system.md`). Exports
Button, Input, Select, Card, Table (with server-pagination + virtualization), Dialog,
Drawer, Tabs, Toast, Chart wrappers, StatusChip, EmptyState, Skeleton, FormField. One
component library → consistent across `web`/`lms`/`crm`. Dark mode via CSS variables.

### 3.2 `web` (Next.js App Router)
```
apps/web/src/
├── app/                 # routes (SSG/ISR), metadata per route
│   ├── (marketing)/     # home, programs, program/[slug], pricing, about, blog...
│   └── enroll/          # auth + payment funnel
├── components/          # page sections (Hero, ProgramCard, ...)
├── lib/                 # api-client, seo, analytics
└── content/             # MDX/blog (or fetched from CMS API)
```
SEO: per-route `generateMetadata`, structured data, sitemap route, ISR revalidation.

### 3.3 `lms` (Next.js PWA)
```
apps/lms/src/
├── app/                 # dashboard, courses, lesson/[id], live, assignments, certs...
├── features/            # course-player, progress, assignments, forum (feature-sliced)
├── components/          # shared LMS UI
├── hooks/               # data hooks (TanStack Query), player, offline
└── lib/                 # api-client, service-worker, watermark
```
Data via TanStack Query (cache, optimistic), PWA service worker for offline downloads.

### 3.4 `crm` (Vite SPA)
```
apps/crm/src/
├── routes/              # TanStack Router (leads, students, academics, commerce, admin...)
├── features/            # pipeline, students, payments, reports, rbac, audit
├── components/          # tables, drawers, charts, command-palette
├── hooks/ lib/          # query, rbac-aware UI, exports
```
Heavy tables: server pagination + virtualization. RBAC-aware rendering (hide what API
forbids). Command palette (⌘K). Drawer-based detail views.

### 3.5 State & data
- Server state: **TanStack Query** (all three apps) over the typed SDK.
- Local UI state: React state/Zustand for ephemeral UI only.
- Forms: react-hook-form + zod resolver (schemas from `@repo/types`).
- Auth: token refresh interceptor in the SDK; route guards by role.

### 3.6 Cross-cutting FE rules
Every async view has **loading / empty / error** states. No business logic in components
(hooks/services). Accessibility built into `packages/ui`. i18n-ready (string catalog).
Feature flags via a provider. Analytics events centralized.

---

## 4. Environments & config
`.env` validated at boot (zod). Envs: local (docker-compose: postgres, redis), staging,
prod. Feature flags + provider keys per env. No secret in any client bundle.

## 5. CI/CD
GitHub Actions: install → typecheck → lint → unit/integration (testcontainers) → build →
e2e (Playwright on critical journeys) → deploy (frontends to Vercel/CF Pages, API to ECS/
Railway). Prisma migrate on deploy (forward-only). Preview deploys per PR.

## 6. Testing strategy
| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest/Jest | services, utils, guards, components |
| Integration | Jest + testcontainers | API + real Postgres/Redis |
| E2E | Playwright | enroll→pay, login→watch→submit→certify, lead→convert |
| Load | k6 | 10k concurrent learners, 1k streams, payment spikes |
| a11y | axe | every shared component + key pages |

## 7. Security checklist (build-time gate)
OWASP Top 10, server-side RBAC + scope, signed media, argon2id passwords, JWT rotation +
reuse detection, rate limiting, input validation everywhere, output encoding, CSP/HSTS,
secrets in env, audit log on mutations, soft delete, PII access logging, DPDP consent +
export/delete, dependency scanning, idempotent payments.

## 8. Scalability levers (in priority order)
1. Stateless apps + CDN for `web`/media.  2. Read replica + materialized views for reports.
3. Redis cache for hot reads.  4. Queue all heavy/bulk work.  5. Offload video to provider.
6. Partition by `tenant_id`/`batch`.  7. Extract hot modules to services when justified.
