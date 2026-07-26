# Live issues log

Running log of issues observed on production (www.stimuliiq.com / admin.stimuliiq.com /
api.stimuliiq.com). One dated section per reporting day; each issue gets root cause,
fix commit, and status. Fixes are committed locally and pushed in a single batch on
explicit approval (CLAUDE.md §3.13 — every push triggers Vercel deploys).

## 2026-07-26

### 1. `/programs` (and all per-request SSR pages) return 500 on www — FIXED (awaiting push)

- **Symptom:** `https://www.stimuliiq.com/programs` and `/programs/[slug]` return
  `500 Internal Server Error`. `/`, `/about`, `/contact`, `/mentors`, `/blog` still 200.
- **Root cause:** Vercel runtime logs show `Cannot find module 'isomorphic-dompurify'`
  on every SSR render. `apps/web` lists the package in `serverExternalPackages`
  (next.config.mjs) so it is `require()`d at runtime, but never declared it in its own
  `package.json` — Vercel's output tracing therefore omitted it from the serverless
  function. lms/crm/packages-ui all declare it; web was the only consumer missing it.
  Pages that "worked" were only serving stale cached ISR HTML — their background
  revalidations were failing with the same error.
- **Fix:** `f3fb958` — declare `isomorphic-dompurify@^3.18.0` in `apps/web/package.json`
  (+ lockfile).
- **Status:** committed locally; recovers on next push/deploy. Verify `/programs` and a
  `/programs/[slug]` return 200 after deploy.

### 2. CRM lead drawer: "Move stage" dropdown stays on old stage — FIXED (awaiting push)

- **Symptom:** In the lead detail drawer, moving a stage shows the "Stage updated"
  toast, but the dropdown keeps showing the old stage. Re-selecting the same target
  then errors with `Cannot move a lead from "won" to "won"` (server had already moved
  it — DB confirmed `stage=won` immediately). List chips catch up on refetch; the
  dropdown label doesn't.
- **Root cause:** two compounding client issues:
  1. `useMoveLeadStage` optimistically patched only the *list* caches — the *detail*
     cache (which the drawer's `<Select value={lead.stage}>` is bound to) waited on the
     settle-time invalidate round-trip, so the dropdown lagged and its same-stage guard
     compared against a stale stage (hence the won→won 422s).
  2. Radix Select's trigger label (`SelectValue`) does not reliably re-render when the
     controlled `value` prop changes externally — the standard workaround is to remount
     the root via `key` on the value.
- **Fix:** in `apps/crm/src/hooks/use-leads.ts`, patch the detail cache's `stage`
  optimistically in `onMutate` (with rollback) and write the server's returned
  `LeadDetail` into the detail cache in `onSuccess`; in `lead-detail-drawer.tsx`, key
  the stage `<Select>` by `lead.stage` so the trigger label remounts with the fresh value.
- **Status:** committed locally; ships with the same push as issue #1.

### 3. Console WebGL / WOFF warnings on www — NOT A SITE ISSUE (no action)

- **Symptom:** DevTools console on www.stimuliiq.com shows repeated
  `WebGL: INVALID_ENUM`, `powerPreference ignored`, `No available adapters`, and an
  `OTS parsing error` for a WOFF font.
- **Root cause:** every entry traces to `normal?lang=auto:1` — Chrome's built-in
  translation feature / an injected extension context, not site code (the marketing
  site ships no WebGL/WebGPU). Clean in incognito.

### 4. Lead drawer: "Won" lead shows "Registered" + conversion isn't full registration — FIXED (awaiting push + API deploy)

- **Symptom:** moving a lead to Won makes the Lifecycle chip read "Registered" while
  the "Convert to student" button is still showing — contradictory (no student record
  exists yet). Also conversion only captured name/email/course-type; the student then
  needed a separate registration step to get working LMS access, and the convert modal
  was cramped.
- **Root cause:** (a) `resolveLifecycleStage` deliberately mapped a won-but-unconverted
  lead to `registered`; (b) the convert dialog exposed 3 of the 8 student fields the
  contract already accepted, and the server dropped `alternatePhone` entirely;
  (c) LMS account provisioning (temp password email + forced first-login change) only
  ran at first enrollment, not at conversion.
- **Fix:**
  - `@repo/types` lifecycle resolver: won + unconverted → `registration_started`
    ("Registration Started"); `registered` now strictly means a student record exists.
  - API: conversion passes `alternatePhone` through and defaults `college` from the
    lead. (An initial cut also provisioned the LMS login at conversion; superseded by
    #8 — LMS access is a paid entitlement, credentials go out at payment completion.)
  - CRM: convert dialog is the full registration form — phone, alternate/guardian
    phone, college, year, city (prefilled from the lead), two-column layout,
    `size="lg"` modal.
- **Status:** committed locally. NOTE: needs both the Vercel push (crm) AND an API
  deploy on the VPS (pm2) to take effect.

### 5. `POST /commerce/payments/manual` 500 — FIXED (awaiting API deploy)

- **Symptom:** recording an offline payment in the CRM returns 500 (three retries, all
  500). One earlier manual payment that day had succeeded.
- **Root cause (from VPS pm2 logs):** `Transaction already closed: ... The timeout for
  this transaction was 5000 ms, however 5535 ms passed`. The capture transaction
  (payment → order → enrollment → invoice, each write also emitting an audit row) makes
  10+ DB round trips, and production's VPS→Supabase-pooler latency puts the total right
  at Prisma's default 5 s interactive-transaction ceiling — succeeding or failing on
  latency variance.
- **Fix:** global `transactionOptions { maxWait: 15s, timeout: 30s }` on both Prisma
  clients (prisma.service.ts) — a ceiling, not a slowdown. Also soft-deleted the 4
  orphan `created`-status manual payment rows the failed attempts left on order
  `9698f437` (payment row is created before the tx); re-record the payment after the
  API deploy.
- **Status:** committed locally; requires the VPS API deploy.

### 6. Analytics MV refresh cron failing on EVERY run in prod (found while debugging #5) — FIXED (awaiting API deploy)

- **Symptom:** pm2 logs show `refresh_analytics_views() FAILED ... ERROR: invalid
  transaction termination` (SQLSTATE 2D000) on every scheduler tick — analytics
  dashboards were only ever refreshed manually.
- **Root cause:** the `refresh_analytics_views()` procedure `COMMIT`s between MVs;
  production's runtime `DATABASE_URL` goes through the Supabase pgbouncer pooler in
  TRANSACTION mode, where transaction control inside a procedure is illegal. Verified by
  reproducing 2D000 through the pooler directly. Bonus finding: the
  `analytics_mv_refresh_log` seed rows are missing in prod (pre-launch data reset), so
  freshness would read permanently stale even after successful refreshes.
- **Fix:** `AnalyticsRepository.refreshMaterializedViews()` no longer CALLs the
  procedure — it refreshes each of the 8 MVs as its own single autocommit statement
  (pooler-safe, verified live through the pooler: all 8 refreshed) with the same
  per-MV failure isolation, and upserts the freshness log rows so the missing seeds
  self-heal on the first tick.
- **Status:** committed locally; requires the VPS API deploy.

### 7. CRM testimonial add / status change not reflecting on www — DUPLICATE OF #1 (no new fix)

- **Symptom:** publishing/archiving testimonials in the CRM has no effect on the
  homepage "What Our Students Say" section.
- **Diagnosis:** the API serves the correct data (`/public/testimonials` returns exactly
  the published set) — but the live homepage HTML predates it. The homepage is ISR
  (5-minute revalidate) and every background re-render crashes on the missing
  `isomorphic-dompurify` module (issue #1), so Vercel pins the last-good HTML
  indefinitely. Applies to ALL CRM-driven marketing content (testimonials, mentors,
  programs, site settings) until #1 deploys.
- **Status:** resolves automatically with the #1 push; no additional code change.

### 8. Post-conversion UX gates (local QA) — FIXED (awaiting push + API deploy)

- **Symptom:** (a) a converted lead's drawer still shows "Convert to student" (clicking
  can only say "already converted"); (b) the student drawer offers "Resend LMS
  credentials" while payment is still pending.
- **Decision:** LMS access is a PAID entitlement. Credentials are first emailed when
  payment completes (the existing enrollment-time provisioning seam) — conversion
  captures the details only. The provision-at-convert cut from #4 was reverted.
- **Fix:** lead drawer hides Convert once `convertedStudentId` is set; student drawer
  shows "Resend LMS credentials" only from `payment_completed` onward (incl. dropped —
  an account exists to reissue); convert-dialog copy states credentials arrive after
  payment.
- **Status:** committed locally; ships with the batch.
