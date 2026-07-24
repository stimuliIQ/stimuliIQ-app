# Plan: Phase 0 — Foundation ("G0")

> Scope boundary: ONLY the Phase-0 Definition of Done in `docs/08-monorepo-scaffold.md §3`,
> executed via the six-wave backbone in `docs/08 §4`. No P1+ feature work (no
> students/faculty/courses CRUD, no commerce, no LMS depth). Each task's DoD references
> `CLAUDE.md §4` and the specific `docs/08 §3` checkbox(es) it satisfies.

---

## Goal & success criteria

**Goal:** Stand up the stimuliiq monorepo skeleton end-to-end: install + build + test wired,
local infra (Postgres + Redis), the **core** identity/catalog schema with seed, a working
**auth + RBAC + data-scope** vertical slice proven on one protected route (`/me`), the
4-primitive design system, generated typed API client, and three app shells that call a
real route with loading/empty/error states — with CI green and docs/ADRs synced.

**Success criteria (the `docs/08 §3` checklist):**
1. `pnpm i` installs the whole workspace; `turbo run build lint test` green (empty-but-wired). — **FULL**
2. `docker-compose up` starts Postgres + Redis; `.env.example` documented + zod-validated. — **FULL**
3. `prisma migrate dev` applies the **core** schema (tenants, branches, users, roles,
   permissions, role_permissions, user_roles, sessions, programs, modules, lessons);
   `seed.ts` creates a tenant + default roles + permission matrix + admin user. — **FULL**
4. `apps/api` boots with **auth** (email+password argon2id, OTP stub, JWT access+refresh
   rotation) and **RBAC guard + scope interceptor** working e2e on one protected route. — **FULL** (OTP send = stub)
5. `packages/ui` exports themed Button + Card + Input + Toast (light/dark tokens). — **FULL**
6. `packages/types` exports auth zod schemas; `packages/api-client` generated from auth OpenAPI. — **FULL**
7. `apps/web`, `apps/lms`, `apps/crm` each render a shell calling one real route via
   `@repo/api-client` with loading/empty/error states. — **FULL**
8. CI runs typecheck → lint → unit/integration → build on every PR; preview deploys wired. — **PARTIAL** (CI full; preview deploys = config stubbed, see §Stubs)
9. Sentry + pino logging + OTel tracing initialized in `apps/api`. — **PARTIAL** (pino FULL; Sentry + OTel = init wiring behind env, no-op without DSN, see §Stubs)

---

## Preconditions (what must already exist)

- `CLAUDE.md`, `docs/00`–`08`, and `.claude/agents/*` are present (verified — they are).
- No application code exists yet (verified greenfield: only `docs/`, `.claude/`, `CLAUDE.md`,
  `README.md`). Phase 0 creates the entire tree in `docs/08 §1`.
- User supplies the Phase-0 secrets (see **§Secrets the user must supply**). The hard blockers
  for Wave 4+ are the **JWT RS256 keypair** and that `DATABASE_URL` / `REDIS_URL` resolve to
  the docker-compose services. All vendor keys (Razorpay/MSG91/SES/Cloudflare/Sentry) are
  **deferrable** in Phase 0.

---

## Task graph

| # | Task | Owner agent | Depends on | Parallel group | DoD (refs `CLAUDE.md §4` + `docs/08 §3`) |
|---|------|-------------|------------|----------------|------|
| 1 | Scaffold target tree (`apps/{web,lms,crm,api}`, `packages/{ui,types,api-client,config}`, `prisma/`, `infra/`), `pnpm-workspace.yaml`, root `package.json`, `turbo.json` pipelines (build/lint/test/e2e/dev/db:migrate/db:seed). Shared `@repo/config` (tsconfig strict base, eslint, tailwind preset). | devops | — | **W1** | §4: no lint/type errors, `turbo run build lint test` green (empty wired). §3-#1. |
| 2 | `infra/docker-compose.yml` (Postgres 16 + Redis), `.env.example` fully documented, zod env-validation module loaded at API boot (fail-fast). | devops | 1 | **W1** | §4: secrets via env, validated at boot. §3-#2. |
| 3 | GitHub Actions `ci.yml`: install → typecheck → lint → unit/integration (testcontainers) → build, on every PR. Preview-deploy jobs scaffolded as **stubs** (commented/guarded — see §Stubs). | devops | 1 | **W1** | §4: `turbo run build lint test` green in CI. §3-#8 (CI full; preview stub). |
| 4 | `apps/api` observability bootstrap: **pino** structured logs (request id, tenant, user) FULL; **Sentry** + **OTel** init wired behind env, **no-op when DSN/endpoint absent** (stub). | devops | 1 | **W1** | §4: summary + verify. §3-#9 (pino full; Sentry/OTel stubbed). |
| 5 | `packages/ui` design tokens (CSS variables, light + dark per `docs/07 §2`) + themed **Button, Card, Input, Toast** (shadcn/Radix, Tailwind), a11y baked in (focus ring, labels, roles). Storybook or a tokens demo page optional. | design-system | 1 | **W1** | §4: a11y pass (keyboard + SR labels), loading/error states on Button/Toast. §3-#5. |
| 6 | Prisma **core** schema: `tenants, branches, users, roles, permissions, role_permissions, user_roles, sessions, programs, modules, lessons` with `docs/05 §1` conventions (id, created_at, updated_at, deleted_at, tenant_id where applicable; key indexes from `docs/05 §4`). Soft-delete + audit Prisma middleware/extension. `seed.ts`: 1 tenant, default roles + full permission matrix (`module.action` × scope), 1 admin user. First migration applies clean. | db-architect | 1, 2 | **W2** | §4: soft-delete + audit-log infra; migration forward-only; integration test of middleware. §3-#3. |
| 7 | Auth **contracts**: zod schemas in `@repo/types` (LoginDto, OtpRequestDto, OtpVerifyDto, RefreshDto, MeResponse, TokenPair, ErrorEnvelope). NestJS Swagger/OpenAPI for the auth routes. Generate typed `@repo/api-client` from that OpenAPI. Response envelope `{ data, meta, error }` + RFC-7807 errors per `docs/04 §2.14`. | api-designer | 6 | **W3** | §4: zod schema + types in `@repo/types`, imported FE+BE. §3-#6. |
| 8 | Auth **module** in `apps/api`: email+password **argon2id**; **OTP request/verify stub** (generates + logs code, `SmsProvider` interface, no MSG91 call); **JWT access (15m RS256) + rotating refresh (7d, hashed in DB, single-use, family revocation on reuse detection)**; sessions in Redis. RBAC `@RequirePermission` guard + `ScopeInterceptor` (`all\|branch\|assigned\|own`) proven e2e on protected **`GET /api/v1/me`**. Repository/service/guard layering per `docs/04 §2.1`. | backend-builder | 6, 7 | **W4** | §4: server-side RBAC guard; audit on mutating auth actions; validation at boundary. §3-#4. |
| 9 | App shells: `apps/web` (Next 15), `apps/lms` (Next 15), `apps/crm` (Vite SPA) each render a shell that calls **`GET /me`** via `@repo/api-client` (TanStack Query) and shows **loading / empty / error** states using `@repo/ui` primitives. No business logic in components. | frontend-builder | 5, 7, 8 | **W5** | §4: loading/empty/error on every async UI; a11y; no logic in components. §3-#7. |
| 10 | Tests: unit (argon2id hashing, JWT rotation + reuse detection, RBAC guard, scope filter, soft-delete middleware) + integration (auth login→refresh→reuse-revoke, `/me` permission allow/deny) via Jest + testcontainers (real Postgres/Redis). Wire into CI step from #3. | qa-engineer | 8 | **W5** | §4: unit + integration green; tests gate merge. §3-#4, #8. |
| 11 | Security review of the auth/RBAC slice: argon2id params, refresh rotation + reuse handling, no token leakage, cookie/CSRF posture, server-side scope enforcement, rate-limit + input validation presence, secrets-in-env check (`docs/04 §7`). Report gaps as fix tasks. | security-reviewer | 8, 10 | **W6** | §4: RBAC enforced server-side; matches `docs/04 §7` build-time gate. §3-#4. |
| 12 | Sync docs to reality: update `README.md` (run/dev/test instructions), record **ADRs** (modular monolith, RS256 JWT + refresh rotation, soft-delete-via-middleware, provider-interface pattern, pnpm+Turborepo). Document the Phase-0 stubs and the deferred-secrets list. | docs-writer | 11 | **W6** | §4: short summary of what changed + how to verify. §3 closeout. |

---

## Execution order (waves)

- **Wave 1 (parallel):** #1, #2, #3, #4 (devops) ‖ #5 (design-system).
  > devops tasks are sequenced internally (1 → 2/3/4) but the whole devops track runs in
  > parallel with design-system. design-system needs only the `@repo/config` + `@repo/ui`
  > package shell from #1.
- **Wave 2:** #6 (db-architect).
- **Wave 3:** #7 (api-designer).
- **Wave 4:** #8 (backend-builder).
- **Wave 5:** #9 (frontend-builder) → #10 (qa-engineer). #9 and #10 may overlap once #8
  lands; #10 must finish before Wave 6.
- **Wave 6:** #11 (security-reviewer) → #12 (docs-writer).

---

## What is STUBBED in Phase 0 (vs fully working)

| Item | Status in P0 | Note |
|------|--------------|------|
| Email+password (argon2id) login | **FULL** | real hashing + JWT issuance |
| JWT access + rotating refresh + reuse detection | **FULL** | RS256, hashed refresh in DB, family revoke |
| RBAC guard + scope interceptor on `/me` | **FULL** | server-side enforced end-to-end |
| OTP **request/verify flow** | FLOW FULL, **SEND STUBBED** | code generated + logged; `SmsProvider`/MSG91 send is a stub, no real SMS |
| Sentry error reporting | **STUBBED** | init wired behind `SENTRY_DSN`; no-op when absent |
| OpenTelemetry tracing | **STUBBED** | init wired behind OTel env; no-op when endpoint absent |
| pino structured logging | **FULL** | works locally with no extra config |
| Preview deploys (Vercel/CF Pages, ECS/Railway) | **STUBBED** | CI jobs scaffolded + guarded; not connected to real projects |
| All other providers (Payment/Mail/WhatsApp/Video/LiveClass/Storage) | **NOT IN SCOPE** | interfaces may be declared but no impls until later phases |
| Google OAuth login | **NOT IN SCOPE** | optional per `docs/04 §2.3`; deferred |

---

## Secrets / env vars the user must supply

**Needed in Phase 0 (blocking):**
- `DATABASE_URL` — Postgres (matches docker-compose; e.g. `postgresql://postgres:postgres@localhost:5432/stimuliiq`).
- `REDIS_URL` — Redis (matches docker-compose; e.g. `redis://localhost:6379`).
- `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` — **RS256 keypair** (PEM; can be generated locally — see open questions).
- `JWT_ACCESS_TTL` (=15m), `JWT_REFRESH_TTL` (=7d) — defaults provided, override-able.
- `APP_ENV` (=local) and base URLs for the 3 apps (CORS allow-list).

**Deferrable in Phase 0 (env keys documented in `.env.example`, features stubbed/off):**
- `SENTRY_DSN` — Sentry (deferrable; logging no-ops without it).
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OpenTelemetry (deferrable).
- `MSG91_AUTH_KEY` / `MSG91_SENDER` / `MSG91_TEMPLATE_ID` — OTP/SMS (deferrable; OTP send stubbed).
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — payments (deferrable, P2).
- `SES_*` or `RESEND_API_KEY` — email (deferrable, P6).
- `CLOUDFLARE_STREAM_*` / `MUX_*` — video (deferrable, P3).
- `S3_*` / `R2_*` — storage (deferrable).
- Vercel/Cloudflare/Railway/ECS deploy tokens — preview deploys (deferrable).

---

## Risks & open questions

1. **JWT keypair generation** — should Phase 0 ship a `pnpm gen:keys` helper that writes a
   dev RS256 keypair into `.env` (gitignored), or will you provide the keypair? (Recommend the
   helper for local dev; real keys via secrets manager in staging/prod.)
2. **cuid vs uuid** for PKs — `docs/05 §1` says "cuid/uuid". Confirm **cuid2** (Prisma default-friendly)
   to lock the db-architect choice; affects every table and the api-client types.
3. **Cookie vs header auth for the shells** — `docs/04 §2.3` allows access-in-memory + refresh
   httpOnly cookie, which pulls in CSRF handling. For the Phase-0 `/me` slice, do you want the
   full cookie+CSRF flow now, or Authorization-header bearer for the slice and cookies deferred
   to the website/LMS funnel phases? (Recommend: implement cookie+CSRF now since it's the
   security-sensitive core and cheap to do once.)
4. **Permission matrix breadth** — Phase 0 seeds roles + a permission matrix. Confirm we seed
   the **full** `module.action` catalog from `docs/04 §2.4` (forward-looking, harmless) vs only
   the auth/`me` permissions needed to prove the slice. (Recommend full catalog, granted to the
   admin role; other roles get a minimal sane subset.)
5. **Default tenant + admin identity** — what tenant slug, admin email, and default password
   should `seed.ts` create? (Need a value or I default to `tenant: stimuliiq`,
   `admin@stimuliiq.test` with a printed random password.)
6. **Branding token** — `CLAUDE.md` says find-replace `stimuliiq` before first commit. Confirm
   `stimuliiq` is final so devops bakes it into package scopes/`@repo/*` and seed data.
7. **Preview-deploy targets** — confirm Vercel (web/lms) + Cloudflare Pages or Vercel (crm) +
   Railway/ECS (api) so CI stubs name the right jobs, even if left disconnected in P0.

---

## Definition of Done for the whole phase (gate to P1)

- [ ] `pnpm i` + `turbo run build lint test` green from a clean clone (`docs/08 §3-#1`).
- [ ] `docker-compose up` brings up Postgres + Redis; API boots and **fails fast** on missing
      required env; `.env.example` complete (`§3-#2`).
- [ ] `prisma migrate dev` applies core schema; `seed.ts` creates tenant + roles + permission
      matrix + admin; soft-delete + audit middleware proven by integration test (`§3-#3`).
- [ ] Login (argon2id) → access+refresh issued; refresh rotation works; **reuse is detected and
      revokes the family**; OTP request/verify flow works with stubbed send; `GET /api/v1/me`
      passes RBAC guard + scope interceptor (`§3-#4`).
- [ ] `@repo/ui` exports Button/Card/Input/Toast in light + dark, a11y-checked (`§3-#5`).
- [ ] `@repo/types` auth schemas imported by FE+BE; `@repo/api-client` generated from auth
      OpenAPI (`§3-#6`).
- [ ] `web`, `lms`, `crm` shells each call `/me` via the client with loading/empty/error
      states (`§3-#7`).
- [ ] CI runs typecheck → lint → unit/integration → build on every PR; preview-deploy jobs
      present (stubbed) (`§3-#8`).
- [ ] pino logging active; Sentry + OTel init wired behind env (no-op without keys) (`§3-#9`).
- [ ] security-reviewer sign-off on the auth/RBAC slice (no high/critical open); ADRs + README
      synced by docs-writer.
- [ ] All Phase-0 DoD items either FULL or explicitly recorded as a documented STUB above.
