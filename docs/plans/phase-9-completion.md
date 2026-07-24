# Plan: Phase 9 — Completion ("finish everything deferred")

> Owner: orchestrator. Executes after P0–P8 GO. Scope = take **web, lms, crm, api**
> from ~55–60% PRD coverage to **100%**, closing every gap in `docs/go-live-checklist.md`
> (Tier 0 + Tier 1 + Tier 2) and every deferred PRD surface across `docs/01/02/03`.
> Every task DoD references `CLAUDE.md §4`. Engineering rules `CLAUDE.md §3` are binding:
> `tenant_id` + soft-delete + audit on every new table, money in paise, zod at every
> boundary, RBAC scope interceptor with **permission-catalog discipline** (every
> `@RequirePermission` must be both **seeded** in the permission catalog AND **granted**
> to the owning role in the seed), all vendors behind swappable provider interfaces with
> **fail-closed-in-prod** boot guards.

---

## Goal & success criteria

- All three apps reach 100% of their PRD (`docs/01/02/03`); no route renders "coming
  soon" / "available in a later phase"; no linked route 404s.
- Every `docs/go-live-checklist.md` Tier-0 blocker (B1–B12) closed; Tier-1 (R1–R13)
  closed or explicitly signed-off; Tier-2 product surface built.
- API boots **fail-closed** in production: any `noop` provider (video, storage,
  payments, live-class, sms) throws at boot, never serves fake data.
- `turbo run build lint test` green across the monorepo; Playwright e2e covers the
  payment funnel, video playback, and live-class join; crm has real component + a11y tests.
- Credential-gated items (Zoom/Meet, Mux/CF Stream transcode, S3/R2, MSG91 DLT,
  Razorpay live) are **code-complete behind their provider interface** and verified in a
  staging env once creds land; the build never depends on a secret being present in CI.

## Preconditions (what must already exist)

- P0–P8 shipped: identity/RBAC, catalog, commerce, LMS core (recorded video, progress,
  attendance-recorded), learning depth (assignments/assessments/certificates), website
  SEO funnel, engagement (notifications/campaigns/gamification/forum), analytics MVs,
  mentor track. See `docs/05 §10`.
- Redis is provisioned (used for sessions/cache) — BullMQ can reuse it.
- Provider seams already exist for Mail (Resend), WhatsApp (Cloud API), Video, Storage,
  Payment, Captcha (Turnstile), SMS (MSG91 stub). Only Mail/WhatsApp/Captcha currently
  fail-closed; Video/Storage/Payment do **not** (root cause per checklist).

---

## DECISIONS / CREDENTIALS NEEDED (batch-ask before Wave 3 verification)

Code behind interfaces is buildable now; **verification** of these is gated on creds.

1. **Live class vendor** — Zoom Meeting SDK creds (SDK key/secret + S2S OAuth) AND/OR
   Google Meet (Google Workspace OAuth + Calendar API). Confirm which adapter is primary;
   Noop is the dev/prod-fail-closed default.
2. **Video transcode** — Mux or Cloudflare Stream account + signing keys (blocked on **B1**
   token rotation). Determines the transcode-webhook payload shape for the video library.
3. **Object storage** — S3 or R2 bucket + IAM/API keys (downloads, invoices, cert PDFs,
   video-library source uploads, content images).
4. **MSG91** — auth key + **TRAI DLT** sender ID + approved DLT template IDs (OTP +
   transactional). Without DLT IDs SMS cannot legally send in India.
5. **Razorpay** — memory `p5-decisions` keeps Razorpay in **TEST**. EMI/dunning and invoice
   PDF are built against TEST; confirm no live charge is expected this phase.
6. **Sentry DSN + OTLP endpoint** (B11) and **new deps** (ask-before-install): `bullmq`,
   `hls.js` (lms), `otplib` + `qrcode` (2FA), `ics` (iCal) — recharts already approved P7.
7. **BullMQ standing-arch flip** — P6/P7 chose the sync-seam. This phase **installs BullMQ**
   (R1) to move campaign send, PDF render, notifications, dunning, and live-class reminders
   off the request path. Confirm the standing-architecture change (supersedes ADR-0020/0039).

---

## Task graph

Owners: `product-manager` (pm), `db-architect` (db), `api-designer` (api),
`backend-builder` (be), `integrations` (int), `design-system` (ds),
`frontend-builder` (fe), `qa-engineer` (qa), `security-reviewer` (sec),
`docs-writer` (docs), `devops` (ops).

| # | Task | Owner | Depends on | Parallel group | DoD (all + `CLAUDE.md §4`) |
|---|------|-------|-----------|----------------|------|
| **T0** | Credential + decision intake; confirm PRD acceptance criteria for every Tier-2 surface; assemble the master permission-key list to be seeded | pm | — | W0 | Decisions 1–7 answered; per-surface acceptance-criteria checklist written; canonical list of new `module.action` permission keys agreed |
| **T1** | **B1** rotate the two exposed `cfat_` Cloudflare tokens; purge from history/notes | ops/sec | — | W0 | New tokens issued, old revoked, secret store updated; verified old tokens 401 |
| **T2** | **B2** make `env.ts` fail-closed: `superRefine` requiring prod secrets; Video/Storage/Payment/LiveClass/SMS boot-throw on `noop` in prod exactly like Mail | ops/sec | — | W1-hard | Prod boot with any `noop` provider throws; dev/test still boot on Noop; unit test per provider guard |
| **T3** | **B12** patch the 5 suppressed HIGH CVEs (multer, OpenTelemetry); remove `ignoreCves` | sec/ops | — | W1-hard | `pnpm audit` clean at HIGH; no suppressions; build green |
| **T4** | **B11** activate Sentry + OTel: read `SENTRY_DSN`/`OTEL_EXPORTER_OTLP_ENDPOINT`, make **loud** (boot-throw) if unset in prod; wire `uncaughtException`/`unhandledRejection` | ops | T2 | W1-hard | `captureException` reaches Sentry in staging; prod-missing-DSN throws; test asserts no silent early-return |
| **T5** | **R2** cap `findQueuedRecipients` with `take:`; **R6** add `AuthIpRateLimitGuard` to `POST /auth/refresh` | be/sec | — | W1-hard | Recipient query bounded; refresh rate-limited by IP; unit tests |
| **T6** | Schema: **LiveClass** model (+ enum `LiveClassStatus`) and wire `attendance.live_class_id` FK (currently FK-less nullable column) | db | — | W1-schema | Model + migration (forward-only); FK constraint added; partial indexes `WHERE deleted_at IS NULL`; conventions §3.4 |
| **T7** | Schema: **Ticket**, **TicketMessage**, **CannedResponse**, **KbArticle** (+ `TicketStatus`/`TicketPriority` enums, `sla_due_at`) | db | — | W1-schema | Models + migration; SLA/assignee indexes; conventions |
| **T8** | Schema: headless CMS — **BlogPost**, **BlogCategory**, **Testimonial**, **Partner**, **FacultyBio**, **ContentBlock**/**Page**, **Newsletter subscription**, **ContactSubmission**, **CareerApplication** | db | — | W1-schema | Models + migration; slug partial-unique per tenant; `status(draft\|published)`; conventions |
| **T9** | Schema: **FeatureFlag** + **Setting** (system/company scope) models | db | — | W1-schema | Models + migration; `(tenant_id, key)` unique-partial; conventions |
| **T10** | Schema: **Bookmark** (ref_type/ref_id polymorphic), **LessonNote** (chapters/notes) | db | — | W1-schema | Models + migration; `(user_id, ref_type, ref_id)` unique-partial; conventions |
| **T11** | Schema: **Referral**/affiliate (reward/status) + **EmiPlan** + **EmiInstallment** (+ dunning state) models | db | — | W1-schema | Models + migration; installment schedule in paise; dunning-state indexes; conventions |
| **T12** | Schema: **LandingPage** (campaign, A/B variant) + **LeadForm** (field config) models | db | — | W1-schema | Models + migration; variant + publish status; conventions |
| **T13** | Permission catalog: add **every** new `module.action` key (liveclass.*, tickets.*, content.*, flags.*, settings.*, emi.*, referrals.*, videolib.*, bulk.*, twofa.*, reports.*) to the seed AND grant to owning roles; add `@AuditRead()` coverage list (R7) | db/sec | T6–T12,T0 | W1-schema | Seed idempotent; a test asserts every `@RequirePermission` in the codebase exists in catalog AND is granted to ≥1 role (permission-catalog discipline gate) |
| **T14** | Contracts: zod DTOs + OpenAPI stubs in `@repo/types` for **all** new endpoint groups (live class, tickets/KB, content, flags, settings, emi/dunning, referrals, video-library, bookmarks/notes, global search, bulk-actions/saved-views, password-reset, 2FA, newsletter/contact/career, reports) | api | T6–T12 | W2-contract | Every DTO exported, FE+BE import the same schema; money fields paise; no `any`; regenerate `@repo/api-client` |
| **T15** | Provider: **LiveClassProvider** interface + **Zoom** adapter + **Google Meet** adapter + **Noop** default + fail-closed-in-prod boot guard | int | T2 | W2-provider | Interface in place; adapters behind it; Noop in dev; prod-noop throws; contract test per adapter (mocked vendor) |
| **T16** | **B3** real **MSG91** SMS adapter (OTP + transactional) with DLT template IDs; stop logging OTP plaintext; return true delivery status | int | T2 | W2-provider | Real HTTP call behind `SmsProvider`; DLT id required; no OTP in logs; prod-noop throws; adapter test (mocked) |
| **T17** | **B5** provision + verify **Video** provider (Mux/CF Stream) — signed HLS real; **B6** provision + verify **Storage** (S3/R2) — presigned real | int/ops | T1,T2 | W2-provider (cred-gated) | Real signed/presigned URLs in staging; boot-throw on noop in prod; smoke test uploads+plays a real asset |
| **T18** | **R1** install **BullMQ**; queue module + worker seam (Redis-backed); move campaign send, PDF render, notification dispatch, dunning, live-class reminders off the request path; **R5** quiet-hours deferral | int/be | T2 | W2-provider | Queues + workers running; producers enqueue, request returns fast; ret/backoff; **R5** quiet-hours honored; integration test |
| **T19** | Design-system: **HLS video-player** primitive (hls.js, native-HLS fallback), **Calendar/agenda**, **Data-table with saved-views + bulk-select**, **Tabbed profile shell**, **Ticket thread**, **Kanban/pipeline**, **PDF/cert-template canvas**, **rich-text/MDX render sink (DOMPurify)** | ds | T14 | W3-ds | Components in `@repo/ui`; a11y (keyboard, focus, labels) per §3.9; loading/empty/error variants; story/usage doc |
| **T20** | Backend: **Live class module** — schedule/update/cancel, join (signed provider URL), **attendance auto-sync ≤60s of join**, reminders via BullMQ | be | T13,T14,T15,T18 | W3-be-A | Endpoints RBAC+tenant+scope guarded; attendance writes `attendance.live_class_id`; audit; tests incl. 60s auto-mark; §4 |
| **T21** | Backend: **Tickets/help-desk module** — CRUD, SLA timer, canned responses, KB articles, assignment, rating | be | T13,T14 | W3-be-A | Own-scope (student) / assigned-scope (staff) IDOR→404; SLA `sla_due_at`; audit; tests; §4 |
| **T22** | Backend: **Headless Content API** — blog/testimonials/partners/faculty/pages CRUD (CRM-managed) + public read endpoints (published only) | be/api | T13,T14 | W3-be-A | Draft/publish workflow; public read filters `published`; XSS render-sink discipline; audit; tests; §4 |
| **T23** | Backend: **Feature flags** + **Settings** modules (evaluate flag, read/write settings, system + company scope) | be | T13,T14 | W3-be-B | Flag eval endpoint cached; settings RBAC-guarded; audit on writes; tests; §4 |
| **T24** | Backend: **EMI plans + dunning** — plan create, installment schedule (paise), Razorpay TEST charge per installment, dunning reminders via BullMQ | be/int | T13,T14,T18 | W3-be-B | Money paise; idempotent installment charge; dunning enqueued; audit; tests; §4 |
| **T25** | Backend: **Referrals/affiliates** — referral link, attribution on lead/enrollment, reward ledger | be | T13,T14 | W3-be-B | Reward status machine; anti-self-referral guard; audit; tests; §4 |
| **T26** | Backend: **Video library** ingest — upload (presigned) → **transcode webhook** consume (existing `video-webhook.controller.ts`) → captions → attach to lesson | be/int | T13,T14,T17 | W3-be-B (cred-gated) | Webhook verified/signed; status `processing→ready/errored`; caption attach; audit; tests (mocked webhook); §4 |
| **T27** | Backend: **B8** invoice + **receipt** PDF generation (`@react-pdf/renderer` → StorageProvider key) via BullMQ; GST fields | be | T13,T14,T17,T18 | W3-be-B (storage-gated) | Real PDF stored, `storage_key` set (not null); signed download owner/finance-only; audit; tests; §4 |
| **T28** | Backend: **B9** password-reset flow (request → tokenized email via Mail → reset); **2FA** for admin roles (TOTP enrol/verify/disable, backup codes) | be/int | T13,T14,T18 | W3-be-B | Single-use expiring token; rate-limited; 2FA gates admin login server-side; audit; tests; §4 |
| **T29** | Backend: **Bookmarks + LessonNotes** + **global search** (programs/blog/lessons/forum via `tsvector`) with filters | be | T13,T14 | W3-be-C | Search tenant+RBAC scoped; bookmark own-scope; audit; tests; §4 |
| **T30** | Backend: **Bulk actions + saved views** on leads/students; **B10** fix `${lms}/dashboard` redirect target + `/verify` ID-entry endpoint data; **per-city SEO** data + **bundles/tracks** pricing endpoints | be/api | T13,T14 | W3-be-C | Bulk ops audited + scope-checked per row; redirect points to real route; city/bundle endpoints tested; §4 |
| **T31** | Backend: **R3** wire orphaned notifications — call `notifyGradeReady` at grading, `notifyCertificateReady` at issuance, `notifyDeadline`/`notifyPaymentReceipt` at event sites; **R10** Redis pub/sub for SSE (multi-instance) | be | T18 | W3-be-C | Each notifier has a real caller; three failing PRD ACs now pass; SSE survives 2 replicas; tests; §4 |
| **T32** | Frontend **web**: mount **R4** the 3 lead-capture components (exit-intent, sticky-bar, lead-form) into pages; footer newsletter; career-apply + contact forms; consume **headless content API** (replace hardcoded/MDX blog/testimonials/partners/faculty) | fe | T19,T22,T30 | W4-web | Components rendered + captcha-wired; content from API; forms zod-validated; loading/empty/error; a11y; §4 |
| **T33** | Frontend **web**: **global search** (programs+blog + filters); **landing pages** (campaign, A/B variant render); **B10** `/verify` ID-entry page; per-city SEO pages; WhatsApp per-program context; bundles/tracks pricing | fe | T19,T22,T29,T30 | W4-web | Search + filters; landing variants; `/verify` resolves; SEO/city pages in sitemap; a11y; §4 |
| **T34** | Frontend **lms**: **B4** wire **hls.js** into `lesson-video-player.tsx` (adaptive HLS Chrome/Firefox/Android, native fallback); downloads & resources page (signed URLs); profile & settings page | fe | T17,T19,T26 | W4-lms | Video plays cross-browser; downloads signed; settings functional; loading/empty/error; a11y; §4 |
| **T35** | Frontend **lms**: **live classes** UI (schedule list/join/countdown); dashboard widgets (live-class countdown, deadlines, announcements, streak/badges); calendar + **iCal** export; learning path | fe | T19,T20,T29 | W4-lms | Join launches provider; attendance reflects; iCal downloads; a11y; §4 |
| **T36** | Frontend **lms**: global search + **bookmarks**; chapters/**notes**; **support ticket** creation; **LinkedIn** certificate share | fe | T19,T21,T29 | W4-lms | Search/bookmarks/notes persist; ticket create works; LinkedIn share URL correct; a11y; §4 |
| **T37** | Frontend **crm**: **Overview dashboard** (role-aware KPIs/charts); **Student 360** tabs (enrollments/payments/attendance/certificates/tickets/timeline) | fe | T19,T21 | W4-crm | Widgets scope-aware; 360 tabs render real data; recharts a11y; loading/empty/error; §4 |
| **T38** | Frontend **crm**: **Video library** (upload→transcode status→captions→attach); **Live-class scheduler**; **Support/help-desk** (tickets+SLA+canned+KB) | fe | T19,T20,T21,T26 | W4-crm | Upload+status UI; scheduler pairs with lms; helpdesk workflow; a11y; §4 |
| **T39** | Frontend **crm**: **Settings** (system+company); **Feature flags**; **Attendance editor**; **Certificate template designer + bulk issuance**; **EMI plans + dunning**; **Referrals/affiliates** | fe | T19,T23,T24,T25 | W4-crm | Each screen CRUD-complete; template designer previews; bulk issuance queued; a11y; §4 |
| **T40** | Frontend **crm**: **Landing-page + lead-form manager**; **Blog/content CMS**; **Admissions checklist**; **Bulk actions + saved views** on leads/students; **reports** (cohort/branch/faculty-performance/refund); **2FA** enrol UI; **invoice/receipt PDF** download | fe | T19,T22,T27,T28,T30 | W4-crm | All 15 comingSoon nav items now live; reports export; 2FA enrol; PDF downloads; a11y; §4 |
| **T41** | Tests: **R12** stand up crm component + a11y test infra; **R13** real Playwright e2e (payment funnel, video playback, live-class join, password reset, ticket, cert verify); integration tests for new modules; **R11** run k6 load suite in staging | qa | T20–T40 | W5-test | crm has real tests; e2e gates critical journeys in CI; k6 executed with pass/fail vs SLOs; coverage on new services |
| **T42** | Security review: RBAC/scope on every new endpoint; **R7** `@AuditRead()` PII coverage; **R8** AV/malware scan on uploads; fail-closed boot verification; 2FA + password-reset threat review; **R9** mentor `branch_id` sign-off; secret-handling audit | sec | T20–T41 | W6-sec | No unguarded endpoint; PII reads audited; uploads scanned; boot-guards verified; findings triaged/closed |
| **T43** | Docs: update `docs/01/02/03` PRD status, `docs/05 §10` implementation status, ADRs (BullMQ flip, LiveClassProvider, content model, EMI, 2FA), `docs/go-live-checklist.md` → CLOSED, phase-9-followups.md | docs | T41,T42 | W7-docs | Every closed item marked; new ADRs written; followups logged; verify-steps documented |

---

## Execution order (waves)

- **Wave 0 (parallel):** T0, T1 — decisions/credentials + rotate exposed tokens.
- **Wave 1 (parallel):**
  - *Schema:* T6, T7, T8, T9, T10, T11, T12 (db-architect, all independent) → then **T13**
    (permission catalog + audit-read list, depends on T6–T12).
  - *Hardening (independent of schema):* T2, T3, T4, T5 (devops/security/backend).
- **Wave 2 (parallel):**
  - *Contracts:* T14 (api-designer, depends on schema).
  - *Providers:* T15, T16, T17, T18 (integrations — T17 credential-gated for verify).
  - *Design-system:* T19 (depends on T14 for prop shapes; can start on primitives immediately).
- **Wave 3 — Backend modules (three parallel sub-groups, depend on W1 schema + W2 contracts/providers):**
  - *W3-be-A:* T20 (live class), T21 (tickets), T22 (content).
  - *W3-be-B:* T23 (flags/settings), T24 (EMI), T25 (referrals), T26 (video-lib), T27 (invoice PDF), T28 (password-reset/2FA).
  - *W3-be-C:* T29 (search/bookmarks), T30 (bulk/redirect/SEO), T31 (notification wiring/SSE).
- **Wave 4 — Frontend (three parallel app-streams, depend on the backend they consume):**
  - *W4-web:* T32, T33.
  - *W4-lms:* T34, T35, T36.
  - *W4-crm:* T37, T38, T39, T40.
- **Wave 5:** T41 (tests + load) after frontends land.
- **Wave 6:** T42 (security review).
- **Wave 7:** T43 (docs).

> Maximize parallelism: within each wave the listed tasks run concurrently. The only hard
> serialization is schema → contracts → backend → frontend → tests → security → docs.
> Credential-gated tasks (T16, T17, T24, T26, T27) are **built and unit-tested with mocked
> vendors in-wave**; their staging **verification** is deferred until creds land but does
> **not** block downstream code (interfaces + Noop keep the build green).

---

## Fully-buildable-now vs vendor-credential-gated

- **Buildable + verifiable now (no external creds):** T2–T14, T18, T19, T20 (Noop provider
  path), T21, T22, T23, T25, T28 (password-reset via existing Mail; 2FA is TOTP-local),
  T29, T30, T31, T32, T33, T34 (B4 hls.js is a dependency, not a credential), T35, T36,
  T37–T40 UI shells, most of T41.
- **Code-complete now, verify-on-credential:** T15 (Zoom/Meet), T16 (MSG91 DLT), T17
  (Mux/CF Stream + S3/R2), T24 (Razorpay TEST charge), T26 (transcode webhook), T27
  (PDF bytes land in real storage). All behind provider interfaces with prod-fail-closed.

---

## Risks & open questions

- **Silent-degradation reversal (B2)** may surface latent prod-misconfig once providers
  fail-closed — stage the env rollout; verify every deploy target has real secrets first.
- **BullMQ standing-arch flip** changes the P6/P7 sync-seam decision — needs an ADR and a
  worker-deploy story (devops); dunning + reminders + campaign send all now depend on it.
- **Live-class attendance ≤60s** SLA depends on vendor webhook/polling latency (Zoom vs
  Meet differ) — confirm the mechanism per adapter.
- **Content migration:** moving web off in-repo MDX to the headless API needs a one-time
  content backfill — decide whether to import existing MDX or re-author in CRM.
- **DLT approval lead time (MSG91)** and **Razorpay live KYC** are external clocks; keep
  TEST-mode paths green so launch isn't blocked on them.
- **Multi-tenancy still hardcoded** (`TENANT_SLUG`) — out of scope here unless tenant #2 is
  imminent; flag if it is.

## Definition of Done for the whole phase

- All 42 tasks meet their per-task DoD and `CLAUDE.md §4`.
- No PRD surface renders a placeholder; no linked route 404s; `go-live-checklist.md`
  Tier 0 + Tier 1 fully closed (or explicitly signed-off), Tier 2 built.
- API fails closed in prod; permission-catalog discipline test passes (every
  `@RequirePermission` seeded AND granted).
- `turbo run build lint test` green; Playwright e2e + k6 executed with recorded results.
- Security review closed; docs + ADRs + followups updated.
```

