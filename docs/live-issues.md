# Live issues log

Running log of issues observed on production (www.stimuliiq.com / admin.stimuliiq.com /
api.stimuliiq.com). One dated section per reporting day; each issue gets root cause,
fix commit, and status. Fixes are committed locally and pushed in a single batch on
explicit approval (CLAUDE.md §3.13 — every push triggers Vercel deploys).

## 2026-08-13

Reported as a batch of ten. Three turned out to be production **environment** problems, not
code: the fix for those is setting a value on the VPS, and no deploy will help without it.

### A. `RESEND_API_KEY` in production is the literal placeholder `re_` — EVERY email fails

- **Symptom reported:** forgot-password emails never arrive. Also explains missing LMS
  credentials emails, and would equally affect invoices, receipts and assignment reminders.
- **Root cause:** `/srv/stimuliiq/.env` contains `RESEND_API_KEY=re_` — the 3-character
  prefix from `.env.example`, never replaced with a real key. Confirmed live against the
  Resend API: `GET https://api.resend.com/domains` returns
  `400 {"message":"API key is invalid"}`.
- **Why nothing showed it:** every transactional send is wrapped in log-and-continue
  (`password-reset.service.ts`, `lms-account-provisioning.service.ts`, `commerce.service.ts`,
  `faculty.service.ts`), and both the LMS and CRM forgot-password screens show the success
  confirmation on error as well as on success (deliberate, for enumeration resistance). So a
  total mail outage looks identical to normal operation from every screen.
- **Status:** OPEN — needs a real Resend API key. Nothing in the codebase can fix this.
  Set `RESEND_API_KEY` in `/srv/stimuliiq/.env`, then `pm2 restart stq-api`. Verify with the
  same `curl` above returning 200.

### B. `TWO_FACTOR_ENC_KEY` unset in production — 2FA could never be enabled

- **Symptom reported:** Google Authenticator "not working".
- **Root cause:** the key was commented out in `/srv/stimuliiq/.env`. Enrolment starts fine
  (the pending secret is plaintext in Redis, the QR scans, codes generate) and the code
  verifies correctly. It fails at the last step, where the confirmed secret is encrypted for
  storage, which throws and 500s. The CRM's catch-all then reports "That code didn't verify",
  pointing the user at their phone instead of at a missing environment variable. The TOTP
  implementation itself is correct (verified against the RFC 4226 test vectors).
- **Fix:** key generated and set on the VPS. Code side, `TWO_FACTOR_ENC_KEY`,
  `CERT_SIGNING_SECRET` and `NOTIFICATION_SIGNING_SECRET` are now validated at BOOT in
  production, so a missing one stops the app starting instead of surfacing later as an
  unrelated-looking 500.
- **Status:** key set; code committed `aa17681`. Requires the API deploy.
- **DEPLOY ORDER MATTERS:** the boot check ships in `aa17681`. `NOTIFICATION_SIGNING_SECRET`
  was also missing and has been set for the same reason. If either were still absent when
  this code deploys, the API would refuse to start.

### C. Batch completion never issued certificates — FIXED

- **Root cause:** `autoIssueOnCompletion` had exactly one caller, a student completing their
  last LMS lesson. No path from `batch.status = completed` to certificate issuance existed;
  all three ways a batch can complete explicitly documented that they touch no certificate
  row. A batch taught in person therefore issued nothing, ever, with no error.
- **Secondary defect found:** auto-issue selected the tenant's OLDEST active template
  regardless of kind, and the seed creates the internship template first. So every
  auto-issued certificate was stored as `kind=training` and rendered on internship artwork.
- **Fix:** `aa17681`. Marking a batch complete issues the training certificate to each
  student (dropped students skipped, already-certified skipped, per-student failures isolated
  and reported as counts). Template lookup is kind-aware.
- **Note:** the hourly auto-close sweep (batches past their end date) deliberately still does
  NOT issue. Issuing on a date rollover with no human involved is not the same assertion as a
  mentor clicking "Mark complete".

### D. Password reset left users locked out — FIXED

- **Symptom reported:** "LMS credentials issue after password fixed".
- **Root cause:** a completed reset wrote only the password hash and left
  `must_change_password` set. Login then succeeded, every authenticated route 403'd, and the
  first-login gate redirected to a form asking for the temporary password the user had just
  replaced. A dead end reachable only by users who chose forgot-password over the forced
  change screen.
- **Second defect:** temporary passwords were 16 random base64url characters, but the login
  policy requires at least one digit. About 6.6% of generated passwords contained none, so
  roughly one provisioned student in fifteen received credentials the login form refused to
  submit. The stored hash was correct; the request never reached it.
- **Third defect:** user lookup by email was case sensitive with no normalisation on write.
  A student created in the CRM as `Name@Gmail.com` failed both login and forgot-password when
  they typed lowercase, silently in the second case.
- **Fix:** `aa17681`, all three.

### E. Sitemap and robots.txt URLs contain a line break — FIXED

- **Symptom reported:** Google results still not showing proper information.
- **Root cause:** production `NEXT_PUBLIC_SITE_URL` has a trailing newline, and the code
  stripped only a trailing slash. `new URL()` silently trims whitespace, so canonical tags
  and OG URLs looked correct in the page source, which is where anyone would check. But
  `robots.txt` and `sitemap.xml` interpolate the raw string, and live they emit
  `Sitemap: https://www.stimuliiq.com\n/sitemap.xml` and `<loc>https://www.stimuliiq.com\n/</loc>`
  for every URL. The sitemap was undiscoverable and its entries malformed.
- **Fix:** `aa17681` trims at the source, and the two `/verify` pages stop separately
  re-deriving the host from env with the wrong bare-apex default.
- **Also do:** correct the `NEXT_PUBLIC_SITE_URL` value in Vercel (remove the newline), and
  resubmit the sitemap in Google Search Console. Re-indexing is not instant.

### F. Super admin appeared to hold edit/delete on audit logs — FIXED

- **Root cause:** the permission catalog is generated as modules x actions, and `audit_logs`
  was in the module list, so `audit_logs.create/edit/delete/export/approve` were minted and
  granted to super_admin and admin at scope=all. No endpoint ever honoured them (only
  `audit_logs.view` is read anywhere, and the audit controller exposes no write verb), but
  the RBAC matrix displayed them, which is indistinguishable from rights that work.
- **Fix:** `aa17681`. Seed narrowed to `audit_logs.view`; `pnpm db:seed:audit-permissions`
  removes the stale rows from an existing database. Backed by a Postgres trigger blocking
  DELETE and any UPDATE outside the DPDP redaction columns, plus a Prisma extension guard.
- **Status:** run `pnpm db:seed:audit-permissions` against production after the migration.

### G. "Only one member in a batch" — PARTLY A DATA-ENTRY TRAP

- **Finding:** there is no one-member cap. `@@unique([studentId, batchId])` is per pair, and
  capacity enforcement is correct. But `capacity` has no database default and the create form
  left the field blank, so a batch saved with `1` accepts one student and then rejects
  everyone with `enrollments.batch_full`.
- **Fix:** `aa17681` seeds a default of 30 in the create form, still editable.
- **Check production:** `SELECT id, name, capacity FROM batches WHERE capacity <= 2;` If the
  affected batch is there, edit its capacity. No deploy needed for that.
- **One course per batch is real and by design.** `Batch.programId` is a single FK and there
  is no join table. Supporting multiple courses per batch is a schema project, not a fix.
  Confirm the requirement before anyone starts it.

### H. Still open, not started

- **Assignment module dropdown** (attach an assignment to its module and lesson while
  building a course). Investigated, not built. The Course and Lesson pickers work today, but
  there is no Module picker, and the lesson list is flattened to `Module . Lesson` in one long
  list. There is also no way to add an assignment from the curriculum builder, and the
  "Assignment" lesson TYPE creates no assignment row, which is an active trap for authors.
- **WhatsApp template campaigns.** Roughly 85% built. Three defects make every send fail at
  Meta: the friendly template name is sent instead of the approved one, variables are never
  passed, and the language is hard-coded to English. Scheduled campaigns also never fire, as
  nothing polls for them. See `docs/staff-guide-reassignment-and-campaigns.md` Part 2.

### J. "Deleted a faculty member in admin, it did not remove" — the delete WORKED

- **Reported as:** a mentor card ("Kavya Reddy", tagged AWS / Docker / CI-CD) showing under
  **Your Mentors** on the live Psychology programme page, after deleting her in the CRM.
- **What the audit log shows:** the delete succeeded. `FacultyProfile` audit rows at
  `2026-08-13T05:36:49Z` (update) and `05:36:50Z` (delete), and the profile carried
  `deleted_at = 2026-08-13T05:36:47Z`. Permissions were fine (`faculty.delete` granted to
  super_admin/admin at scope=all). Nothing about the delete path is broken.
- **Actual root cause, two parts:**
  1. `PublicRepository.getPublicMentorBios` filtered on neither `faculty.deletedAt` nor the
     user's status, so a soft-deleted, deactivated faculty member stayed on the public page
     permanently. Deleting in the CRM genuinely changed nothing the reporter could see.
  2. Soft-deleting a faculty member does NOT clear `batches.faculty_id`, so the batch went on
     pointing at a deleted row, which is what the public query then followed.
- **Where the data came from:** all three faculty were demo seed rows
  (`faculty.{priya,arjun,kavya}@stimuliiq.test`, `prisma/seed.ts`), with tech-stack expertise
  on a healthcare catalog. They survived the July reset because that reset cleared courses and
  mentors but kept staff, and faculty are staff.
- **Fix:** `714a1a6` filters the public query on both the profile's soft-delete and the user's
  status. Production data cleaned separately: batch unassigned, three demo faculty profiles
  removed, backup at `/srv/stimuliiq/faculty-cleanup-backup.json`. User rows were deliberately
  left in place (already soft-deleted, and `audit_logs.actor_id` references them).
- **Still open:** soft-deleting a faculty member leaves them assigned to their batches. The
  CRM shows a deleted person as the batch's teacher, and the confirm dialog gives no warning
  that batches will be left without faculty.
- **Also note:** the programme page's heading says "Your Mentors" over data that is really
  `batch.facultyId`. The `Mentor` records staff manage in the CRM never appear there, which is
  why adding a mentor had no effect. Unresolved product decision.

### I. VPS housekeeping

- A `prisma migrate deploy` process had been hung for 3.5 days (1 second of CPU across
  308,000 seconds), stuck on `can-connect-to-database` against the Supabase pgbouncer pooler
  on port 6543. Killed. Migrations need a DIRECT connection, and no `DIRECT_URL` is
  configured, which is very likely why it hung. Worth fixing before the next migration.
- Two PM2 daemons are running, one under `root` with no apps and one under `deploy` holding
  `stq-api`. The `deploy` one is the live one and its pid matches the port 4000 listener.
  Harmless but worth tidying, and a known source of confusion in past incidents.
- Public endpoints are responding in 2 to 5 seconds, consistent with the known API-to-database
  region split.

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

### 10. Pay-link verify 500s AFTER a successful payment — FIXED (found in e2e test)

- **Symptom:** paying through a /pay/:token link completes the charge, but the page
  shows "Payment verification failed … contact support". DB inspection shows the
  payment WAS captured (signature verified), the order paid, the enrollment active,
  and the invoice created — only the response 500'd.
- **Root cause:** the pay-link verify path's post-payment audit write passed
  `order.studentId` (a student PROFILE id) as `audit_logs.actor_id`, which is an FK
  to `users` — FK violation → unhandled 500 after the money moved. The session-based
  enroll-funnel path was correct; only the pay-link path had it.
- **Fix:** resolve the profile's USER id for the audit row, and make this bookkeeping
  write best-effort (the underlying payment/order/enrollment writes are already
  audited by the Prisma extension) — a failed marker row must never show the payer a
  false failure.
- **Verified:** full e2e against local API + real Razorpay TEST keys: token → summary
  → checkout (real rzp order) → signed verify → order paid, payment captured
  (signature verified), enrollment active, invoice INV-2026-0003, profile promoted,
  LMS login provisioned (temp password + forced change), receipt + credentials
  emails sent, audit row with the correct user actor.
- **Status:** committed locally; requires the VPS API deploy.

### 9. Paid student never received LMS credentials email — FIXED (awaiting API deploy)

- **Symptom:** payment completed on live (receipt email arrived, enrollment created)
  but no LMS credentials email (temp password + forced first-login change). DB
  confirmed: the paid student's user row was still `invited` with an empty
  `passwordHash` — provisioning never ran.
- **Root cause:** `LmsAccountProvisioningService` is invoked only from the Razorpay
  WEBHOOK path and the manual roster-enroll path. The two synchronous capture paths —
  `verifyPayment` (browser checkout) and `recordManualPayment` (offline payment) —
  create the enrollment inline and never provision. A manual payment gets NO webhook,
  so its student could never be provisioned at all.
- **Fix:** both capture paths now call `provisionForStudentProfile` right after the
  enrollment transaction (best-effort — an email failure never fails the payment;
  idempotent — the webhook double-fire case is a no-op). The already-affected student
  (paid 2026-07-25) was provisioned manually with the exact same guarded logic and the
  welcome email was delivered via Resend (accepted, id 5b7a3ad3).
- **Note:** the forced first-login password change the user described is the existing
  `mustChangePassword` gate — already implemented in the LMS; no change needed there.
- **Status:** committed locally; requires the VPS API deploy.
