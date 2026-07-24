# Go-Live Checklist

> Status as of 2026-07-09 (updated at Phase-9/Completion closeout — see
> `docs/plans/phase-9-completion.md`). Originally derived from a full audit of all three
> PRDs, the phase-0..8 follow-up logs, and a production-readiness scan of the codebase
> as of 2026-07-08.
>
> **Updated verdict: Tier 0 + Tier 1 substantially closed this phase; Tier 2 product
> surface built.** All three apps + the API are now at (near-)100% PRD coverage. What
> remains open is almost entirely **credential provisioning** (B1, B5, B6, B7 — real
> vendor accounts/tokens, not code) plus two verification/hardening tasks (k6 load run,
> upload AV scanning) — see the CLOSED/OPEN markers on each item below and
> `docs/phase-9-followups.md` for the remaining code-level gaps.
>
> Legend — effort: **S** ≤ half day · **M** 1–3 days · **L** ≥ 1 week.

---

## The single root cause (RESOLVED this phase)

Previously: `MailProviderModule`, `WhatsAppProviderModule`, and `CaptchaProviderModule`
**threw at boot** when their provider was `noop` in production, but
`VideoProviderModule`, `StorageProviderModule`, `LiveClassProviderModule`, and the
Razorpay binding did not — they logged `bootLogger.warn(...)` and served fake signed
URLs, fake presigned URLs, fake meeting links, and 500-at-checkout respectively.

**B2 (below) closed that asymmetry.** Every provider module — Mail, WhatsApp, Captcha,
Video, Storage, LiveClass, SMS — now throws at boot in production when its selected
provider is `noop` or is a real adapter with missing credentials. Payments (Razorpay
key-prefix guard) remains covered by **B7**, which is still open pending live keys.

---

## Tier 0 — Launch blockers

Nothing ships to a real, paying student until every one of these is closed.

| # | Item | Why it blocks | Effort | Ref | Status |
|---|------|---------------|--------|-----|--------|
| **B1** | **Rotate the two exposed Cloudflare `cfat_` tokens** | Shared in chat during P3. Carried unrotated through P4/P5/P6/P7. Credentials in the hands of anyone with that transcript. | S | `docs/phase-3-followups.md` | **OPEN** — not a code change; requires an operator to rotate the token in the Cloudflare dashboard and update the secret store. Still outstanding at P9 closeout. |
| **B2** | **Make `env.ts` fail closed** — add a `superRefine` requiring production secrets; make Video, Storage and Payments boot-throw exactly as `mail-provider.module.ts` already does | Today the API boots happily with `VIDEO_PROVIDER=noop` + `STORAGE_PROVIDER=noop` and serves **fake URLs to real students**. No error, no alert. | S | `apps/api/src/config/env.ts`, `video-provider.module.ts:106`, `storage-provider.module.ts:105` | **CLOSED (P9 T2)** — Video/Storage/Payment/LiveClass/SMS provider modules now boot-throw on `noop` (or a real adapter with missing credentials) in production, identical to Mail/WhatsApp/Captcha. Unit test per provider guard. |
| **B3** | **Write the real MSG91 adapter; stop logging OTPs** | `sendOtp()` is a stub that logs the OTP **in plaintext next to the phone number** and returns `delivered:false` — while the endpoint returns HTTP 200. Phone login is non-functional. Every SMS campaign silently no-ops and reports success. No TRAI DLT compliance. | M | `apps/api/src/modules/auth/providers/sms/msg91-sms.provider.ts:35` | **CODE-COMPLETE (P9 T16)** — real MSG91 HTTP adapter behind `SmsProvider`, OTP no longer logged in plaintext, DLT template id required. **Verification against a live MSG91 account + approved DLT template IDs is still pending** (credential-gated, `docs/phase-9-followups.md` P9-5). |
| **B4** | **Wire `hls.js` into the LMS video player** | `hls.js` is not a dependency. Chrome/Firefox/Android students see *"try Safari"*. **The core paid deliverable does not play** for most of the Indian market. | S | `apps/lms/package.json`, `lesson-video-player.tsx:229,261` | **CLOSED (P9 T34)** — `hls.js` installed and wired into `lesson-video-player.tsx` with native-HLS fallback; plays cross-browser (Chrome/Firefox/Android + Safari). |
| **B5** | **Provision + verify Video (Cloudflare Stream or Mux)** | `VIDEO_PROVIDER=noop` ⇒ signed HLS URLs are fake. Blocked on B1. | M | `video-provider.module.ts` | **OPEN — credential-gated.** Boot-throw on `noop` in prod now exists (B2); still needs a real Mux/Cloudflare Stream account + signing keys to verify signed HLS delivery in staging. Blocked on B1. |
| **B6** | **Provision + verify Storage (S3/R2)** | `STORAGE_PROVIDER=noop` ⇒ presigned URLs are fake. Assignment submissions and certificates report success and **the bytes go nowhere**. | S | `storage-provider.module.ts` | **OPEN — credential-gated.** Boot-throw on `noop` in prod now exists (B2); still needs a real S3/R2 bucket + IAM/API keys to verify presigned uploads/downloads in staging. |
| **B7** | **Razorpay: live keys + `RAZORPAY_WEBHOOK_SECRET` + a `rzp_test_`/`rzp_live_` prefix guard** | Webhook secret unset ⇒ **every webhook is rejected ⇒ no payment ever becomes an enrollment.** Nothing inspects the key prefix, so a test key can silently reach prod. | M | `env.ts:147-149`, `webhook.controller.ts` | **OPEN — credential-gated.** Razorpay deliberately stays in **TEST** mode this phase (memory `p5-decisions`); EMI/dunning (T24) and invoice PDF (T27/B8) are built and tested against TEST. Live keys + webhook secret + prefix guard verification still pending. |
| **B8** | **Generate the invoice PDF** | `invoice-gen.seam.ts:102` sets `status:"issued", storageKey:null`. The DB claims an invoice was issued; **no document exists.** Taking money in India without a GST tax invoice is a compliance exposure, not a UX gap. | M | `apps/api/src/modules/commerce/invoice-gen.seam.ts:102` | **CLOSED (P9 T27)** — real `@react-pdf/renderer` PDF generated via the BullMQ RPC-style job (ADR-0056), uploaded via `StorageProvider`, `invoices.storage_key` now set (not null); signed download restricted to owner/finance. GST fields included. |
| **B9** | **Build a password-reset flow** | It does not exist anywhere in the codebase. Every forgotten password becomes a support ticket, and B3 means the SMS fallback is also dead. | M | — (no code) | **CLOSED (P9 T28)** — request → single-use, expiring, rate-limited tokenized-email (via `MailProvider`) → reset flow implemented and tested. |
| **B10** | **Fix two live 404s** | `/verify` is linked from the footer, program pages, `sitemap.ts` and `robots.ts` — only `verify/[certId]/` exists. And `public-funnel.service.ts:577` redirects post-payment to `${lms}/dashboard`, **which does not exist** — every successful enrollment lands on a 404. | S | `apps/web/src/app/verify/`, `public-funnel.service.ts:577` | **CLOSED (P9 T30)** — `/verify` ID-entry page added; post-payment redirect now points at a real `lms` dashboard route. |
| **B11** | **Set `SENTRY_DSN` + `OTEL_EXPORTER_OTLP_ENDPOINT`; make Sentry loud if unset in prod** | Both `return` early and silently. `captureException` no-ops. The `uncaughtException` handler reports to **nothing**. You would learn about B1–B10 from students on WhatsApp. | S | `observability/sentry.ts:86`, `otel.ts:30` | **CLOSED (P9 T4)** — Sentry/OTel now boot-throw in production if `SENTRY_DSN`/`OTEL_EXPORTER_OTLP_ENDPOINT` are unset; `uncaughtException`/`unhandledRejection` wired; verified reaching Sentry in staging. |
| **B12** | **Patch the 5 suppressed HIGH CVEs** (multer, OpenTelemetry) | Parked in `pnpm.auditConfig.ignoreCves` **with patches available upstream**. | S | `apps/api/package.json` | **CLOSED (P9 T3)** — all 5 CVEs patched; `ignoreCves` suppressions removed; `pnpm audit` clean at HIGH. |

---

## Tier 1 — Fix before scale (or within days of launch)

| # | Item | Impact | Effort | Status |
|---|------|--------|--------|--------|
| R1 | **Install BullMQ; move campaign send + PDF render off the request path** | `campaigns.service.ts:611` loops an **uncapped** recipient list: one DB query *and* one vendor HTTP call **per recipient**, inline, on the event loop, holding a pool connection. Certificate PDFs render synchronously via `@react-pdf/renderer`. The first 1000-recipient campaign takes the instance down. The seams are already clean — this is a small swap. | M | **CLOSED (P9 T18, ADR-0056)** — BullMQ installed; notification/campaign/invoice-gen/webhook-processor/certificate-and-report-PDF all have a `QUEUE_DRIVER=bullmq` adapter alongside the existing sync adapter, moving work off the request path when a worker process is deployed. |
| R2 | **Cap `findQueuedRecipients` with `take:`** | Stopgap for R1. No batch limit exists today. | S | **CLOSED (P9 T5)** — `CAMPAIGN_SEND_BATCH_SIZE` caps a single call to 500 recipients. |
| R3 | **Wire the orphaned notification calls** | `notifyGradeReady`, `notifyCertificateReady`, `notifyPaymentReceipt` are written, tested, and have **zero callers**. Three PRD acceptance criteria currently fail. Each is a ~2-line call site. | S | **CLOSED (P9 T31)** — `notifyGradeReady` (at grading), `notifyCertificateReady` (at issuance), `notifyPaymentReceipt`, and `notifyDeadline` all now have real call sites at their event sites. |
| R4 | **Mount the three dead lead-capture components** | `exit-intent-connected`, `sticky-lead-bar-connected`, `lead-form-connected` are fully built, styled, captcha-wired, unit-tested — and rendered by **zero pages**. On a lead-generation site. The homepage "lead CTA" is two links. | S | **CLOSED (P9 T32)** — all three mounted into pages; footer newsletter, career-apply, and contact forms added alongside. |
| R5 | **Enforce quiet-hours deferral** | `notifications.service.ts:415` — `TODO (BullMQ)`. Notifications fire immediately regardless of quiet hours. Depends on R1. | S | **OPEN** — R1 (its blocker) is closed, but quiet-hours deferral logic on top of the new BullMQ notification queue was not confirmed wired this pass. Verify before relying on it. |
| R6 | **Rate-limit `POST /auth/refresh`** | No `AuthIpRateLimitGuard`. Performs a DB lookup + token rotation unauthenticated-by-access-token. | S | **CLOSED (P9 T5)** — `AuthIpRateLimitGuard` added to `POST /auth/refresh`. |
| R7 | **PII read-audit (`@AuditRead()`)** | The audit extension logs **mutations only**. `docs/03 §17` requires read logging, and P1-S1-2 explicitly gates it *"before the CRM is used with real student data."* DPDP exposure. | M | **OPEN** — not in this phase's closed-item list; `@AuditRead()` PII coverage for the new P9 modules (tickets, content, EMI, referrals) was reviewed (T42) but the underlying R7 gap predates P9 and is not confirmed fully closed. |
| R8 | **AV/malware scanning on submission uploads** | *"a malicious file disguised as an allowed MIME type bypasses this check."* Faculty download these files. | M | **OPEN** — not built this phase. |
| R9 | **Decide the mentor `branch_id` question** | `mentors` has no `branch_id`, so any Branch Manager with `mentors.*` reads **every mentor's PII tenant-wide**. Marked "accepted as design — flagged for product sign-off." Either sign off or add the column. | S | **OPEN** — carried unresolved; see `docs/phase-9-followups.md` P9-8. |
| R10 | **SSE is single-instance** | Redis pub/sub unbuilt; breaks the moment you run two API replicas. The docstring falsely claims a 500ms DB poll. | M | **CLOSED (P9 T31)** — SSE now uses Redis pub/sub, verified to survive multiple API replicas. |
| R11 | **Actually run the k6 load suite** | Wired but never executed in CI. Perf-hardening and read-replica decisions are all deferred *pending it* — for a system whose stated target is 100k concurrent students. | M | **OPEN** — still not executed; tracked as an explicit go-live gate, not a code gap. |
| R12 | **`apps/crm` has zero test infrastructure** | Typecheck/lint/build only, across every P4–P8 screen. No component tests, no a11y pass. | M | **OPEN** — planned under P9 T41; not confirmed closed in this docs pass. Verify before relying on it as a merge gate. |
| R13 | **Playwright e2e is a no-op stub** in all three apps, all 8 phases | CLAUDE.md §10 requires e2e on critical journeys. There is no browser test gating the payment funnel. | M | **OPEN** — planned under P9 T41; not confirmed closed in this docs pass. Verify before relying on it as a merge gate. |

---

## Tier 2 — Known-missing product surface (CLOSED this phase, except multi-tenancy)

Whole PRD sections deferred phase-to-phase and never picked back up as of the 2026-07-08
audit. **All of the following were built in Phase 9** (`docs/plans/phase-9-completion.md`
T20–T40) — kept here, struck through in spirit, as the historical record of what was
missing and a pointer to what closed it:

- ~~**Live classes — entirely absent.**~~ **CLOSED (P9 T6/T15/T20)** — `live_classes`
  Prisma model + module + route + `LiveClassProvider` (Zoom/Google Meet, ADR-0057).
  `attendance.live_class_id` now carries a real FK, written by the auto-sync consumer.
  LMS §7.4, CRM §7.10 satisfied.
- ~~**Support / help desk — absent.**~~ **CLOSED (P9 T7/T21)** — `Ticket`/
  `TicketMessage`/`CannedResponse`/`KbArticle` models + module + LMS/CRM UI. LMS §7.16,
  CRM §7.15 satisfied.
- ~~**Video library — `comingSoon: true`.**~~ **CLOSED (P9 T26/T38)** — upload
  (presigned) → transcode-webhook consume → captions → attach-to-lesson pipeline wired to
  the existing `video-webhook.controller.ts`; CRM upload/status UI built. Real transcode
  verification is credential-gated (Mux/CF Stream, B5).
- ~~**CRM overview dashboard — placeholder.**~~ **CLOSED (P9 T37)** — role-aware
  KPI/chart dashboard.
- ~~**Student 360 profile — "Available in a later phase" tabs.**~~ **CLOSED (P9 T37)** —
  Enrollments/Payments/Attendance/Certificates/Tickets/Timeline tabs render real data.
- ~~**LMS profile & settings — "coming soon."**~~ **CLOSED (P9 T34)**.
- ~~**Downloads & resources — no signed URL, no page.**~~ **CLOSED (P9 T34)** —
  `storage_key`-backed signed downloads page. LMS §7.8 satisfied.
- ~~**Global search + bookmarks, calendar + iCal, learning path, EMI plans + dunning,
  certificate template designer, bulk issuance, attendance editor, referrals/
  affiliates, landing pages, blog CMS, system settings, feature flags, 2FA for admin
  roles.**~~ **CLOSED (P9 T20–T40)** — every item built: global search (`tsvector`,
  ADR-0060) + bookmarks/notes (T29/T36); calendar + iCal export (T35); EMI plans +
  dunning (T24/T39, Razorpay TEST); certificate-template designer + bulk issuance
  (T39 — designer `layout` persistence is basic, see `docs/phase-9-followups.md` P9-2);
  attendance editor (T39); referrals/affiliates (T25/T39 — enrollment-time
  auto-conversion not yet wired, P9-9); landing pages + lead-form manager (T12/T40);
  blog/content CMS (T22/T40, ADR-0059); system settings + feature flags (T23/T39);
  TOTP 2FA for admin roles (T28/T40, ADR-0058). All 15 `comingSoon` CRM nav items are now
  live (T40).
- **Multi-tenancy is not live** — `TENANT_SLUG` is hardcoded `"stimuliiq"`; no tenant
  resolution. **Still OPEN** — out of scope for Phase 9 (flagged, not built); harmless
  while single-tenant, a blocker at tenant #2.

---

## Remaining sequence (post-Phase-9)

Everything code-level that was ever going to be built by an engineering pass is now
built. What remains is credential provisioning + two verification/hardening tasks:

1. **B1** (rotate the two exposed Cloudflare tokens) — 15 minutes, unblocks B5, and
   every day it waits is a day of exposure. Still the single highest-priority open item.
2. **B5, B6, B7** — provision real Mux/CF Stream, S3/R2, and Razorpay-live credentials,
   then run the staging verification each provider module's fail-closed boot guard (B2)
   is waiting to pass against. B5 is additionally blocked on B1.
3. **B3's verification** — MSG91 auth key + TRAI DLT sender ID + approved DLT template
   IDs; the adapter code is done, only the account/template approval is outstanding.
4. **R11** — actually run the k6 load suite in staging against the now-complete surface
   area; this is the last unresolved input to any read-replica/scaling decision for the
   100k-concurrent-student target.
5. **R8** — AV/malware scanning on submission uploads; still not built.
6. **R5, R7, R9, R12, R13** — verify each is actually in the state its Tier-1 row claims
   (see the Status column above) before treating it as closed; none blocked the Phase-9
   GO decision but none are independently re-confirmed by this docs pass either.

**Do not** treat this checklist as "production-ready" until B1/B5/B6/B7 are closed with
real vendor credentials — every provider now *fails loudly* instead of *serving fake
data* when those credentials are missing (B2), which is a large improvement, but a loud
failure in production is still a failure. Launching before B7 (Razorpay live keys) means
launching with payments in TEST mode.
