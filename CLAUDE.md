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
  **Review has TWO outcomes (2026-08-09).** Grading was the only one until now:
  `SubmissionStatus.returned` shipped in P4 and nothing ever wrote it, so work needing
  another attempt had to be graded low (final, no way back) or left pending forever, and a
  `returned` row would have shown the student "Submitted" with no resubmit form.
  Now: **Grade** (`PATCH /crm/submissions/:id/grade`, unchanged) or **Send back**
  (`POST /crm/submissions/:id/return`, same `submissions.grade` key) — no score, a mandatory
  reason stored in `feedback` and emailed via the new `submission_returned` notification, and
  `allowResubmit` is switched on automatically so the student can actually comply. Only a
  `submitted` attempt can be returned (re-checked in the UPDATE's WHERE, so two reviewers
  can't both return one attempt). It is deliberately never called "reject" anywhere the
  student can see: a real fail is a low grade; this means "do it again". Reviewers work
  cohort-first — the submission queue carries `batchId`/`batchName` and a batch filter.
- **P5 Website:** marketing pages, SEO, book-slot, payment + registration funnel.
- **P6 Engagement:** notifications, WhatsApp/email campaigns, gamification, forum.
- **P7 Analytics + hardening:** dashboards, reports, perf, security audit, load test.
- **P8 Future:** Mentor management (external-hire mentors → batches → internship completion + mentor dashboard), placement/recruiter/college/parent portals, multi-tenant SaaS. (An "AI mentor" chatbot was explored and removed — mentors are human hires, not AI.)
- **P9 Completion (DONE):** cross-app gap-closing pass taking `web`/`lms`/`crm` to full PRD
  coverage — live classes, support tickets + KB, headless CMS/landing pages, referrals +
  EMI, settings, bookmarks/notes, durable 2FA, password reset, and BullMQ
  queue seam (ADR-0056). **Feature flags were part of this phase and have since been
  REMOVED** (migration `20260809160000_drop_feature_flags`): the table, the RBAC-gated CRUD,
  the cached `/feature-flags/evaluate` endpoint and the Admin ▸ Feature Flags screen were all
  built, and nothing in `web`/`lms`/`crm`/`api` ever evaluated a flag — the one seeded flag
  was read by no code. An admin toggle that appears to control something and does not is
  worse than none, so the seam was deleted rather than wired up for its own sake. Restore
  from git history if flags are ever genuinely needed.
  Plan: `docs/plans/phase-9-completion.md`. Closed with a Wave-6
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
  **Review is two verbs, not a status picker:** a submission arrives `hold` (DB default since
  migration `onboarding_default_hold`; `pending` is legacy and renders as "On hold") and a
  reviewer either **Accepts** — which drives the ORDINARY offline-payment lifecycle
  (`CommerceService.createOrder` → `recordManualPayment`) at the program's list price, so the
  enrolment, the GST invoice and ONE email carrying the invoice *and* the LMS credentials all
  come from commerce rather than a private copy; the amount is never client-supplied, and the
  money leg is skipped for a free program or an unticked box — or **Rejects**, which emails
  the student to contact support and deliberately omits the internal `reviewNotes`. If the
  money leg fails the student is still enrolled and emailed: access never depends on paperwork.
  Spec: `docs/specs/onboarding-form.md`, ADR-0064.
- **P13 Leave Management (DONE):** staff time off is in the product. Any member of staff
  applies from **CRM ▸ Leave Management ▸ My Leave**; the **super admin** — and nobody else,
  not even `admin` — approves or rejects, and authors the yearly allowances, the leave types,
  the holiday list and the working week. One shared calendar shows holidays, weekly offs, the
  viewer's own leave and everyone else's.
  **Durations are integer HALF-DAY units** (`half_days = 7` means 3.5 days), never a Decimal:
  0.5 is not representable in binary floating point and this schema has no Decimal column —
  same discipline as money-in-paise. **Balances are DERIVED**, not ledgered: remaining =
  quota − approved − pending, aggregated on read, because a stored balance drifts the first
  time a cancel path forgets to credit it back. Pending counts against remaining, so nobody
  queues five ten-day requests against a twelve-day allowance. A request may not span two
  calendar years (422, split it).
  **The super-admin narrowing is implemented by WHERE the permissions are seeded:**
  `leave.approve` and `leave.manage` are upserted in a dedicated block OUTSIDE the catalog in
  `prisma/seed.ts`, so the admin+super_admin catch-all cannot grant them. A permission-catalog
  spec and an integration test both guard it. Note `grant()` is an upsert that UPDATES scope —
  re-granting a key to `adminRole` in a staff loop silently downgrades admin from `all`.
  **The calendar has its own key** (`leave.calendar.view`, `scope=all` for every staff role)
  behind a projection that never fetches `reason`: the team sees WHEN somebody is out, never
  WHY. `computeLeaveDuration` (`@repo/types`) is run identically by the apply form and the
  API, the same way `buildOnboardingAnswerIssues` is.
  Spec: `docs/specs/leave-management.md`, ADR-0065.
  **DB setup on an existing/live database:** `prisma migrate deploy` (additive — five new
  tables, two enums, three NotificationType values) then `pnpm db:seed:leave`. Do NOT run the
  full `pnpm db:seed` against a live DB. No holidays are seeded on purpose: a wrong holiday
  fails silently in the direction nobody checks, by making leave across it cost a day less.
  **DB setup on an existing/live database:** `prisma migrate deploy` (additive — two new
  tables + three enums, nothing existing touched; plus `onboarding_default_hold`, which only
  changes a column default and moves `pending` rows to `hold`) then `pnpm db:seed:onboarding`. Do NOT
  run the full `pnpm db:seed` against a live DB — it upserts demo students/programs/
  campaigns; `seed-onboarding.ts` writes only the permissions + the nine questions, and
  skips any question a staff member has already edited.
- **P14 Careers / Hiring (DONE):** the careers surface finally closes its loop. It was
  half-built: job openings were free text typed into the careers page's `job_openings`
  block, applications landed in `career_applications` with **no CRM screen at all**, and
  **not one email was ever sent** — somebody uploaded a resume into silence and never heard
  back. Now: openings are a CRM-managed table (**CRM ▸ Careers ▸ Openings**, `JobOpening`)
  rendered LIVE on `/careers`, following the P11 colleges pattern, so an application
  references a real opening instead of a string. The `job_openings` block becomes the SECOND
  reference block beside `live_collection_ref` and **loses its role editor entirely** — no
  control may look like it publishes a job and not (the `stats.headline` lesson, P10-2).
  `closesOn` is an INCLUSIVE date that hides a lapsed advert **without changing its status**,
  because "close it on the 30th" is the chore nobody does on the 30th.
  **Review is FOUR VERBS, not a status picker** — `hold` (silent; the internal parking
  state) / `shortlist` (emails the round + the reviewer's details) / `offer` (requires an
  uploaded letter and emails it **ATTACHED**) / `reject` (polite decline; `internalNotes` is
  stored and NEVER sent). Same reasoning as P4 grade/send-back and P12 accept/reject, only
  sharper: three of the four mail a person outside the company. An offer or rejection is
  terminal, re-checked in the UPDATE's WHERE so two reviewers cannot both decide one
  application. `offer` is the ONE verb that reads storage BEFORE writing status — a
  candidate must never be marked offered with nothing sent. Applying always fires an
  automatic acknowledgement; a failed send leaves `acknowledgedAt` null, which is what the
  CRM flags. Attaching the letter is why `MailProvider` gained `attachments` and
  `StorageProvider` gained a size-capped `getObject` (the only server-side byte read here).
  Careers has its OWN permission domain — `careers.view` / `careers.review` /
  `careers.openings.manage`, deliberately **not** `content.*` like the colleges screen next
  door: an application carries a stranger's resume, and whoever may rewrite the homepage
  should not thereby read CVs. It also moved out of `ContentModule` into `modules/careers`
  (public URLs unchanged). `CareersPageFallback` no longer lists roles — it carried three
  hardcoded openings which, once openings became real, were fabricated job adverts shown
  whenever the API was unreachable.
  Spec: `docs/specs/careers-hiring.md`, ADR-0066.
  **DB setup on an existing/live database:** `prisma migrate deploy` (additive — one new
  table, nine new columns, a partial unique index; plus a rewrite of the two retired status
  values `reviewing`/`hired`, which nothing had ever written) then `pnpm db:seed:careers`.
  Do NOT run the full `pnpm db:seed` against a live DB. **No sample openings are seeded on
  purpose** — a seeded opening is not placeholder data, it is a live advert on a live website
  for a job that does not exist.
- **P15 Marketing Targets (DONE):** marketing had a scoreboard and no goal. The per-rep
  lead-performance report already counted leads assigned/contacted/converted, but nothing said
  what those numbers were SUPPOSED to be, and the marketing team could not see any of it — that
  report is gated on `reports.lead_performance.view` and reads as a management tool, so a
  marketing person opening the CRM got business-wide charts and nothing about themselves.
  Now: **one target row per person per month carrying TWO numbers** (deals + rupees-in-paise),
  because a marketing target is one sentence — "close N deals worth ₹X" — and splitting it
  across rows lets somebody set one half and forget the other. Either number may be 0 meaning
  "not measured on this" (hides that card); BOTH zero is rejected, since that is what deleting
  the target is for.
  **PROGRESS IS DERIVED, NEVER STORED** — no `completed`/`pending` column exists. Both are
  recomputed on read from `leads.converted_at` and `payments.paid_at`, the same call P13 made
  for leave balances and for the same reason: a stored counter drifts the first time a lead is
  reassigned, a conversion is undone or a payment is refunded, and it drifts silently in the
  direction that flatters the number. This is also what makes "when a deal closes the pending
  count drops" free rather than a thing to maintain. `summariseTargetMetric` (`@repo/types`)
  is the ONE definition of completed/pending/percent, run identically by API and dashboard card
  like `computeLeaveDuration`. Revenue reuses `mv_revenue_daily`'s exact
  `captured`+`paid_at` pair so per-person sums reconcile with the revenue dashboard (and is
  therefore gross of refunds).
  **New `leads.converted_at`**: `converted_student_id` recorded WHETHER a lead closed, never
  WHEN, and the student's `created_at` is not a substitute because converting LINKS a lead to
  a StudentProfile that may already have existed. Deliberately NOT backfilled — old conversions
  count in no month, same call the lead-ownership pass made.
  **Both permissions are kept OUT of the catalog**: `marketing_targets.view` is marketing-only
  (scope `own`; the `/me` endpoint takes no user id at all, so scope=own is the whole gate) and
  `marketing_targets.manage` is super_admin-only, same device as `leave.approve`. The asymmetry
  is intentional — super_admin gets `manage` but NOT `view`, because they have no target of
  their own and would otherwise carry a permanently-empty card; the team report IS their surface.
  Spec: `docs/specs/marketing-targets.md`, ADR-0067.
  **DB setup on an existing/live database:** `prisma migrate deploy` (additive — one table, one
  nullable column, two indexes) then `pnpm db:seed:marketing-targets`. Do NOT run the full
  `pnpm db:seed` against a live DB. **No targets are seeded on purpose** — a seeded target is a
  number a real person is measured against, and a wrong one fails silently in the direction
  nobody checks.

- **P16 Course Types (DONE):** the "Course type" dropdown on every student form was a Postgres
  enum — `btech/degree/diploma/mca/mba/other` — mirrored by a zod `z.enum` and by FOUR
  hand-copied `{value,label}` arrays in the CRM, so changing it cost a migration, a contract
  change, five UI edits and a deploy. It therefore never changed: it was written for the
  original B.Tech/MCA/MBA audience, survived the healthcare repositioning intact, and staff
  answered a REQUIRED field about nursing students with "Other".
  It is now **CRM-authored DATA** (`course_types`, Admin ▸ Course types) — the P12 onboarding
  call, for the same reason and deliberately the OPPOSITE of P11's locked templates: a
  marketing page has a layout free composition ruins, **a list of options has no shape a
  non-engineer can break**.
  `student_profiles.course_type` stores the option's **immutable `key`**, not a foreign key:
  the label is the only mutable half, so renaming "B.Tech" to "MBBS" renames the OPTION and is
  never a silent rewrite of what existing students are recorded as. Labels resolve on READ
  (`courseTypeLabel` on the student DTOs), so a rename shows up everywhere at once.
  **Writes accept only ACTIVE options** (422 `course_types.unknown` — hiding means "stop
  offering this"); **reads accept anything**, falling back to the raw key, because history is
  shown as it was recorded. Delete is refused while students hold the key (409) and points at
  hiding. The column also became **NULLABLE**, deleting the two paths that invented an answer
  to satisfy NOT NULL — website self-registration wrote `"btech"` and onboarding activation
  wrote `"other"` onto real people's records. The Excel importer no longer funnels
  unrecognised text into "Other": an unmatched cell is a row error naming the tenant's actual
  options. `slugifyCourseTypeKey` (`@repo/types`) is run identically by the API (which
  generates the key) and the CRM form (which previews it), like `computeLeaveDuration`.
  **Permissions are asymmetric on purpose:** reading is gated on `students.view` (every role
  that opens the student directory needs the picker to render; a dedicated `course_types.view`
  would have to be granted to every counsellor role and would be forgotten), and
  `course_types.manage` stays INSIDE the permission catalog — unlike `leave.approve` and
  `marketing_targets.manage` — so admin holds it too: maintaining a list of qualifications is
  configuration, not authority over a member of staff.
  Spec: `docs/specs/course-types.md`, ADR-0068.
  **DB setup on an existing/live database:** `prisma migrate deploy` (one new table; the
  `student_profiles.course_type` column converts enum → TEXT and becomes nullable, and the
  migration first inserts a `course_types` row for every value already in use PER TENANT, so
  no student changes meaning and no dropdown loses an option) then `pnpm db:seed:course-types`.
  Do NOT run the full `pnpm db:seed` against a live DB. **No new options are invented on
  purpose** — which qualifications a company recruits for is a live business fact, and a
  plausible seeded list gets picked silently by whoever is in a hurry.

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
| Staff leave spec (allowances, approvals, holidays, calendar) | `docs/specs/leave-management.md` |
| Careers/hiring spec (CRM openings, four-verb review, candidate emails) | `docs/specs/careers-hiring.md` |
| Marketing targets spec (two numbers, derived progress, dashboard card) | `docs/specs/marketing-targets.md` |
| Course types spec (CRM-managed option list, immutable keys, hide-not-delete) | `docs/specs/course-types.md` |
| Lead ownership + accountability (assignment notify, owner picker, per-rep report) | `docs/specs/lead-ownership-accountability.md` |
| Agent roster & protocol | `.claude/agents/README.md` |
