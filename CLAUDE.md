# CLAUDE.md — Project Context & Operating Rules

> This file is auto-loaded by Claude Code at session start. Every agent reads it.
> Keep it lean. Deep specs live in `/docs`. This file = the contract.

---

## 0. What we are building

A **3-application EdTech ecosystem** for an internship-training company serving
B.Tech / Degree / Diploma / MCA / MBA / Engineering students across India.
Architected to scale to **100,000+ concurrent students**.

| # | App | Codename | Surface | Primary users |
|---|-----|----------|---------|---------------|
| 1 | Marketing Website | `web` | Public, SEO-first | Prospects, leads |
| 2 | Student Learning Portal (LMS) | `lms` | Authenticated | Enrolled students |
| 3 | Admin CRM Dashboard | `crm` | Internal, RBAC | Staff, faculty, admins |

Branding token: **`stimuliiq`** (find-replace before first commit).
Primary market: **India** (payments, SMS, WhatsApp, compliance choices reflect this).

Read in order before coding anything: `docs/00-product-strategy.md` →
the relevant PRD (`01`/`02`/`03`) → `docs/04-trd-architecture.md` →
`docs/05-database-design.md` → `docs/06-user-flows.md` → `docs/07-design-system.md`.

---

## 1. Tech stack (do not deviate without an ADR)

**Monorepo:** `pnpm` workspaces + `Turborepo`.

**Frontend**
- `web`, `lms` → **Next.js 15 (App Router)**, React 19, TypeScript, Tailwind, shadcn/ui.
- `crm` → **Vite + React 19** SPA (internal, no SEO), TanStack Router + Query.
- Shared: `@repo/ui` (design system), `@repo/types` (zod schemas + TS types),
  `@repo/api-client` (typed SDK), `@repo/config` (eslint/tsconfig/tailwind preset).

**Backend**
- **NestJS** (TypeScript) as a **modular monolith** with clean module boundaries so
  high-load modules (video, notifications, payments) can be split into services later.
- **PostgreSQL 16** + **Prisma** ORM. **Redis** for cache + sessions.
- **BullMQ** for queues (email, sms, whatsapp, certificate gen, video transcode webhooks).
- Auth: **JWT access (15 min) + rotating refresh (7 d)**, RBAC + fine-grained permissions.

**Integrations (India-first, swappable behind interfaces)**
- Payments: **Razorpay** (primary) + Stripe (international) — behind `PaymentProvider`.
- Email: **AWS SES / Resend** — behind `MailProvider`.
- SMS / OTP: **MSG91** — behind `SmsProvider`.
- WhatsApp: **WhatsApp Cloud API / Gupshup** — behind `WhatsAppProvider`.
- Video: **Cloudflare Stream / Mux** signed HLS — behind `VideoProvider`.
- Live class: **Zoom Meeting SDK + Google Meet** — behind `LiveClassProvider`.
- Object storage: **S3-compatible (R2 / S3)** — behind `StorageProvider`.

**Infra:** Docker, GitHub Actions CI, deploy backend to AWS ECS Fargate (or Railway for
MVP); frontends to Vercel / Cloudflare Pages. Observability: Sentry + OpenTelemetry +
pino structured logs.

---

## 2. Monorepo layout (target)

```
stimuliiq/
├── apps/
│   ├── web/                 # Next.js marketing site
│   ├── lms/                 # Next.js student portal
│   ├── crm/                 # Vite admin dashboard
│   └── api/                 # NestJS backend
├── packages/
│   ├── ui/                  # design system (shadcn + tokens)
│   ├── types/               # zod schemas, shared DTOs
│   ├── api-client/          # typed fetch SDK (generated from OpenAPI)
│   └── config/              # eslint, tsconfig, tailwind preset
├── prisma/                  # schema.prisma, migrations, seed
├── docs/                    # PRD / TRD / flows / design system
├── infra/                   # docker-compose, IaC, CI helpers
└── .claude/
    ├── agents/              # subagent definitions (the orchestration layer)
    └── commands/            # slash commands
```

---

## 3. Non-negotiable engineering rules

1. **TypeScript strict** everywhere. No `any` without an inline justification comment.
2. **Validation at every boundary** with **zod**. DTOs in `@repo/types`, reused FE+BE.
3. **No business logic in controllers or React components.** Services (BE) / hooks (FE).
4. **Every table has** `id` (uuid/cuid), `created_at`, `updated_at`, `deleted_at`
   (soft delete), and is multi-tenant-ready via `tenant_id` where applicable.
5. **RBAC is enforced server-side**, never trusted from the client. Permission checks
   live in NestJS guards; the UI only *hides* what the API already *forbids*.
6. **Money is integer minor units** (paise), never floats. Currency stored explicitly.
7. **All external calls go through a provider interface** (see §1) — never call a vendor
   SDK directly from a feature module.
8. **Migrations are forward-only and reviewed.** Never edit a shipped migration.
9. **Accessibility is a requirement, not a polish step:** WCAG 2.2 AA, keyboard-first,
   semantic HTML, visible focus, labelled controls.
10. **Tests gate merges:** unit (services, utils), integration (API + DB via testcontainers),
    e2e (Playwright on critical journeys). New feature without tests = not done.
11. **Conventional Commits**; one logical change per PR; every PR has a Definition-of-Done
    checklist (see §6).
12. **Secrets only via env**, validated at boot with zod. Never commit `.env`.
13. **NO `git push` without explicit user approval.** Every push triggers Vercel
    deployments (free tier — limited credits). Commit locally as needed; pushing to
    any remote requires the user to say so first, each time.

---

## 4. Definition of Done (per unit of work)

- [ ] Matches the relevant PRD acceptance criteria
- [ ] zod schema + types in `@repo/types`, imported by FE and BE
- [ ] Server-side RBAC/permission guard in place
- [ ] Soft-delete + audit-log entry for mutating actions
- [ ] Unit + integration tests green; e2e for user-facing journeys
- [ ] a11y pass (keyboard + screen-reader label check)
- [ ] No new lint/type errors; `turbo run build lint test` green
- [ ] Loading / empty / error states implemented for every async UI
- [ ] Short summary of what changed + how to verify

---

## 5. How the agent orchestration works (read `.claude/agents/README.md`)

The **`orchestrator`** agent is the planning brain. Given a goal, it produces a
**phased build plan** and a **delegation list** naming which specialist agent owns each
task and in what order/parallelism. The **main Claude Code session executes that plan**,
dispatching to specialists (`db-architect`, `backend-builder`, `api-designer`,
`frontend-builder`, `design-system`, `integrations`, `qa-engineer`, `devops`,
`security-reviewer`, `docs-writer`). Specialists return tight reports; the orchestrator
re-plans on each phase boundary.

> Mechanics note: in standard Claude Code a subagent cannot itself spawn subagents — the
> **main session** owns dispatch. So "orchestrator calls api-builder" means: orchestrator
> *emits the plan*, the main thread *delegates* to `api-designer`/`backend-builder`. For
> true peer-to-peer multi-agent runs, enable Agent Teams
> (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). The plan format is identical either way.

Kickoff prompt to paste into Claude Code:
```
Use the orchestrator subagent to produce the build plan for Phase 0 (monorepo + auth +
db foundation). Then execute it, delegating each task to the named specialist subagent.
```

---

## 6. Build phases (orchestrator follows this spine)

- **P0 Foundation:** monorepo, CI, Prisma schema core, auth, RBAC, design-system skeleton.
- **P1 CRM core:** students/faculty/courses/batches CRUD, roles/permissions, audit logs.
- **P2 Commerce + Leads:** Razorpay flow, invoices, lead pipeline, enrollment.
- **P3 LMS core:** dashboard, courses, recorded video (signed HLS), progress, attendance.
- **P4 Learning depth:** assignments, projects, assessments, certificates + verification.
- **P5 Website:** marketing pages, SEO, book-slot, payment + registration funnel.
- **P6 Engagement:** notifications, WhatsApp/email campaigns, gamification, forum.
- **P7 Analytics + hardening:** dashboards, reports, perf, security audit, load test.
- **P8 Future:** Mentor management (external-hire mentors → batches → internship completion + mentor dashboard), placement/recruiter/college/parent portals, multi-tenant SaaS. (An "AI mentor" chatbot was explored and removed — mentors are human hires, not AI.)
- **P9 Completion (DONE):** cross-app gap-closing pass taking `web`/`lms`/`crm` to full PRD
  coverage — live classes, support tickets + KB, headless CMS/landing pages, referrals +
  EMI, feature flags/settings, bookmarks/notes, durable 2FA, password reset, and BullMQ
  queue seam (ADR-0056). Plan: `docs/plans/phase-9-completion.md`. Closed with a Wave-6
  security pass (H1 referrals scope, M1–M4, L1–L2) + QA defect fixes; api unit
  147 suites/1996 tests + 24 integration files green. Go-live blockers tracked in
  `docs/go-live-checklist.md` (remaining OPEN items are credential/infra provisioning:
  real vendor keys, AV scan, k6 staging load test — not code).
- **P10 Page Builder (DONE, authoring UX superseded by P11):** marketing site is
  CRM-editable — super_admin-only block-based page builder over `ContentPage` (11-block
  zod registry in `@repo/types`, save-is-live + `ContentPageVersion` snapshots/revert +
  server-side preview), dedicated `SiteSetting` model (nav/footer/SEO/contact; homepage
  stats live ONLY in the home page's `stat_group` block — a `stats.headline` setting
  existed briefly and was removed as a save-does-nothing trap, see P10-2),
  `live_collection_ref` blocks killing homepage testimonial/partner duplication. Spec:
  `docs/specs/phase-10-page-builder.md`, ADR-0062. **The free block-composition authoring
  UX (add/remove/reorder) was replaced in P11 by locked templates — storage/versioning/
  RBAC from this phase are unchanged and still in force.**
- **P11 Locked Templates (DONE):** the P10 free block builder is replaced with
  **locked, fixed-layout templates** for the 6 core marketing pages (`/`, `/about`,
  `/scholarship`, `/for-colleges`, `/gallery`, `/careers`) — staff edit only field values
  (text/images/list rows) of a pinned, ordered set of sections per page; no add/remove/
  reorder/block-picker. Server-side enforcement via `validatePageBodyAgainstTemplate`
  (422 on any shape violation) reuses the P10 engine internally (storage, `web` renderer,
  `ContentPageVersion` history/revert, preview, `live_collection_ref`) as an implementation
  detail. Colleges are now a dedicated CRM list (`/crm/colleges`, `Partner` rows category
  `college_partner`) surfaced live on the site like mentors and courses. Added per-page OG
  image (`ContentPage.seoImagePath` / `ContentPageVersion.seoImagePath`). Removed the
  ad-hoc `/pages/[slug]` route — no non-template pages can be created anymore. Plan:
  `docs/plans/phase-11-locked-templates.md`. ADR-0063 (supersedes ADR-0062's authoring
  model). Known limitation: same-`blockType`-position swaps are not detected by
  `validatePageBodyAgainstTemplate` (`docs/phase-11-followups.md`).
- **P12 Onboarding Form (DONE):** the Google Form students filled after paying is now in
  the product — a standalone form at **`/onboarding`** on the marketing site (`apps/web`;
  `SiteShell` drops the marketing chrome the same way it does for `/pay/:token`), with
  every submission landing in **CRM ▸ Onboarding**. NO subdomain: an
  `onboarding.stimuliiq.com` host rewrite was built and then removed on the owner's call
  (needed DNS + a Vercel domain attachment, and ran edge middleware sitewide to serve one
  page) — do not re-add it without asking. Deliberately the OPPOSITE of P11's locked
  templates: the
  question set is **CRM-authored DATA** (`onboarding_fields`) — staff add/rename/retype/
  reorder/hide/delete questions with no deploy — because a form, unlike a marketing page,
  has no shape a non-engineer can break. Answers are stored as self-describing snapshots
  (`{key,label,type,value,storageKey}`) so later field edits can't rewrite history, and
  validation is one shared function (`buildOnboardingAnswerIssues`, `@repo/types`) run
  identically in the browser and the API, since a data-defined form admits no fixed DTO.
  The payment receipt uploads through the anonymous signed-PUT posture built for career
  resumes (`onboarding/{tenantId}/…`, signed-URL delivery only, never CDN). Permissions
  split intentionally: `onboarding.view/edit/delete` (intake queue — counsellor/support)
  vs `onboarding.fields.manage` (editing the live form — admin only).
  Spec: `docs/specs/onboarding-form.md`, ADR-0064.
  **DB setup on an existing/live database:** `prisma migrate deploy` (additive — two new
  tables + three enums, nothing existing touched) then `pnpm db:seed:onboarding`. Do NOT
  run the full `pnpm db:seed` against a live DB — it upserts demo students/programs/
  campaigns; `seed-onboarding.ts` writes only the permissions + the nine questions, and
  skips any question a staff member has already edited.

Do **not** jump ahead. Each phase ends with tests green + a demo path.

---

## 7. Where to look

| Need | File |
|------|------|
| Business/product strategy, personas, metrics | `docs/00-product-strategy.md` |
| Website requirements | `docs/01-prd-website.md` |
| LMS requirements | `docs/02-prd-lms.md` |
| CRM requirements | `docs/03-prd-crm.md` |
| Architecture / backend / frontend / API | `docs/04-trd-architecture.md` |
| Schema, ER, indexes, storage, implementation status | `docs/05-database-design.md` |
| Every user flow | `docs/06-user-flows.md` |
| Design system, tokens, components | `docs/07-design-system.md` |
| Architecture decision records | `docs/adr/README.md` |
| Phase-0 deferred items + security follow-ups | `docs/phase-0-followups.md` |
| Phase-1 deferred items + security follow-ups | `docs/phase-1-followups.md` |
| Phase-2 deferred items + security follow-ups | `docs/phase-2-followups.md` |
| Phase-3 deferred items + security follow-ups | `docs/phase-3-followups.md` |
| Phase-4 deferred items + security follow-ups | `docs/phase-4-followups.md` |
| Phase-5 deferred items + security follow-ups | `docs/phase-5-followups.md` |
| Phase-6 deferred items + security follow-ups | `docs/phase-6-followups.md` |
| Phase-7 deferred items + security follow-ups | `docs/phase-7-followups.md` |
| Phase-8 (Mentor) deferred items + security follow-ups | `docs/phase-8-followups.md` |
| Phase-10 deferred items + follow-ups | `docs/phase-10-followups.md` |
| Phase-11 deferred items + follow-ups | `docs/phase-11-followups.md` |
| Mentor feature spec (human external-hire mentors) | `docs/specs/phase-8-mentor.md` |
| Page-builder spec (blocks, ACs, edge cases — authoring UX superseded by P11) | `docs/specs/phase-10-page-builder.md` |
| Locked page-templates plan (P11) | `docs/plans/phase-11-locked-templates.md` |
| Onboarding form spec (CRM-authored questions, subdomain) | `docs/specs/onboarding-form.md` |
| Agent roster & protocol | `.claude/agents/README.md` |
