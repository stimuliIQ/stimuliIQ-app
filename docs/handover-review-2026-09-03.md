# Pre-handover engineering review — 2026-09-03

A full-repository review pass across `web`, `lms`, `crm`, `api`, `packages/*`, the Prisma
schema and the deployment configuration. This file is the record of what was found, what
was changed, and — the part that matters most for a handover — **what is still open and
who has to do it.**

Everything below was verified by reading the code path end to end. Where a finding was
reported but turned out to be wrong or already handled, it is not listed.

---

## 1. What must happen at deploy time

These are not code changes. The API now **refuses to boot** without the first two, which
is deliberate — a green boot with either of them wrong is worse than no boot at all.

| # | Action | Why it blocks |
|---|--------|---------------|
| **D1** | Set `COOKIE_SECURE=true` and a real `COOKIE_DOMAIN` in the production environment. | Both default to their LOCAL values (`false` / `"localhost"`). A deployment that forgot them booted green and issued every session cookie without `Secure`. `.env.production.template` has always had them right; nothing made it mandatory. Now `validateEnv` refuses. |
| **D2** | Split the R2 buckets: a PRIVATE `STORAGE_BUCKET` (public access OFF) and a PUBLIC `STORAGE_PUBLIC_BUCKET`, with `PUBLIC_ASSET_BASE_URL` pointing at the public one. | A CDN can only read a bucket that allows anonymous reads, and R2 grants that **per bucket**. One bucket + a CDN publishes `submissions/`, `exports/` (PII CSVs), `invoices/`, `receipts/`, `certificates/` and `careers/` resumes to anyone with a key — and several key shapes are deterministic (`receipts/{tenantId}/{paymentId}.pdf`), with tenant ids readable straight out of any pay-link token. **Check the live bucket's public-access setting before anything else.** The API now refuses to boot in the one-bucket-plus-CDN configuration. |
| **D3** | Set `NEXT_PUBLIC_LMS_URL` in the API env **and in Vercel**. | `apps/web` reads it at build time for its "Sign in" links. It falls back to `https://learn.stimuliiq.com`, so a miss is not fatal — but set it explicitly. |
| **D4** | Run `pnpm db:seed:org` once against any database seeded before 2026-09-01. | Unchanged from the P17 note in CLAUDE.md; repeated here because it is easy to miss and the symptom (leave silently routing to the owner) looks like working software. |

---

## 2. Security findings fixed in this pass

Each was reachable with an ordinary authenticated session and no special tooling.

### 2.1 A student could read every assessment's answer key — CRITICAL

The three P4 CRM controllers resolved their data scope as
`(getScopeContext()?.scope ?? "all") as "all" | "assigned" | "branch"`. Both halves were
wrong, and the cast hid it: `?? "all"` is the exact fallback `scope-context.ts` names as
*"the bug this hardening exists to prevent"*, and the cast asserted that `"own"` — a value
the guard really does produce — was impossible. The services then branched only on
`=== "assigned"`, so `"own"` and `"branch"` fell through to the **unfiltered** all-scope
path.

`prisma/seed.ts` grants the STUDENT role `assessments.view`, `assignments.view`,
`submissions.view` and `certificates.view` at scope `own`, and nothing stops an LMS session
calling `/crm/*`: the app/role audience gate runs at **login only**, and `PermissionsGuard`
matches the permission **key** alone. So an ordinary student's session could call:

- `GET /crm/assessments/:id` → the full answer key
- `GET /crm/submissions/:id` → another student's work, with signed download URLs
- `GET /crm/assignments/:id/submissions` → the whole grading queue
- `GET /crm/certificates*` → every student's certificates and eligibility

**Fixed** by narrowing once at the controller boundary through
`assertAuthoringScope` (`modules/common-scope/authoring-scope.ts`), which returns
`"all" | "assigned"` and 403s anything else — so the compiler now refuses to let a service
take a scope it does not handle. `branch` is **refused rather than filtered**: it was never
implemented in these modules, and for assessments it is not even well defined (an
assessment hangs off a module → programme, and a programme belongs to no branch).

### 2.2 An `admin` could become `super_admin` in one request — CRITICAL

`users.edit` is seeded for super_admin **and** admin. `PATCH /crm/admin/users/:id`
accepted two fields it should not have:

- `roleIds`, validated only against the `student` role — so an admin could assign
  themselves the `super_admin` role, whose id is readable straight off
  `GET /crm/admin/users`.
- `password`, written straight through — strictly **worse** than the dedicated
  `POST :id/reset-password` route that the seed deliberately keeps super-admin-only,
  because here the actor *chooses* the password instead of a random one being mailed to
  the account holder. `ResetStaffUserPasswordResponseSchema`'s own doc comment describes
  this exact threat model.

**Fixed**: role assignment now applies the same rank guard `RolesService` already enforces
on the role editor (you cannot hand out a permission, or a wider scope of one, than you
hold yourself), and `password` requires `users.reset_password`. The CRM hides the field
when the actor lacks the key.

### 2.3 OTP login admitted staff to the CRM with no password and no 2FA — HIGH

The gate was `assertAudienceAllowed(roleKeys, audience)`, whose non-LMS branch is
"holds any role that isn't student" — which a staff account **satisfies**, so it admitted
them — and `audience` is optional, so omitting the header skipped the check entirely.
Nothing consulted `two_fa_enabled`; that check lives on the password route. A ported or
swapped SIM was enough to reduce a 2FA-protected admin to one factor.

**Fixed**: OTP is student-only, decided on the **role** rather than on what the client
claims the audience is, and a 2FA-enrolled account is refused outright.

### 2.4 `GET /crm/emi-plans/:id` ignored its scope — HIGH

`emi.view` is seeded at scope `own` to counsellor **and student**. The list route narrowed;
the detail route did not, so a plan uuid was enough to read a customer's name, order total
and full installment schedule. **Fixed**: the detail route narrows with the same
restriction the list uses, and the write paths (create plan, mark-paid, dunning) now
require scope `all` instead of accepting `own` and ignoring it.

### 2.5 EMI plan totals were client-supplied — HIGH

`CreateEmiPlanRequest` carried `totalAmountPaise` and `currency`; the order was fetched
only to prove it existed. The schedule those numbers produce is what `markInstallmentPaid`
later hands the payment provider as a **real charge** — so a client that lowered the total
collected less than the order says is owed, and one that raised it overcharged, with the
order row reading correctly either way. **Fixed**: both fields are gone from the contract.
The CRM form now *shows* the order's total instead of asking a staff member to type it.

### 2.6 Refunds capped only the single request — MEDIUM

`requestRefund` compared `body.amountPaise` against the payment total but never against
other refunds on the same payment. Two full-amount refunds could each be raised and each
approved by a different person — maker-checker is satisfied by both. **Fixed**: the ceiling
is the aggregate of live (`requested|approved|processed`) refunds, re-checked immediately
before the provider call.

### 2.7 A content editor could publish a private object — HIGH

`mintCdnUrl` concatenated any key onto the public asset base with no namespace check.
Several key fields are free strings a CRM user types (`ogImageKey`, `brochureKey`,
`logoKey`, `photoKey`, `coverImageKey`, `seoImagePath`), validated only as "1..1024
characters" — so a content editor could set `ogImageKey` to
`careers/{tenantId}/{uuid}-resume.pdf` and the public programme page would publish a
permanent, unauthenticated link to a job applicant's CV.

**Fixed**: `mintCdnUrl` refuses keys in the namespaces this system manages as private
(derived from the two prefix lists, so a namespace added later is private by default). Keys
in no managed namespace still work — the partners manager legitimately takes a hand-typed
key for a file an operator uploaded themselves. The three duplicate copies of `mintCdnUrl`
are now one.

### 2.8 `POST /storage/upload-url` skipped its ownership check — HIGH

The enrollment-ownership check was gated on `purpose === "submission" || undefined`, and
the `else` built a submissions key anyway — so `purpose: "career_resume"` (an enum value no
client ever sent) walked past the check and minted a signed PUT into **another student's**
submission prefix, from a client-supplied `enrollmentId` nobody had verified.

**Fixed**: ownership is checked unconditionally, and the enum is narrowed to the one value
this endpoint actually serves. Also, `contentType` was a free string echoed into the signed
PUT and replayed on download — a student could store `text/html` under `submissions/` and
have it render in the reviewer's browser. It is now an allow-list
(`SubmissionContentTypeSchema`), and the LMS file picker offers exactly that list.

### 2.9 `GET /api/v1/assets/*` served any object with no signature — MEDIUM

The local-storage controller's public route read the same directory as the signed download
route and verified nothing, so any key at all was fetchable by anyone who knew one.
Path traversal was already blocked; the namespace was not. **Fixed** with the same
`isPrivateStorageKey` predicate `mintCdnUrl` uses, so the two surfaces cannot drift. SVG is
also served with `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`, so a
logo still renders in an `<img>` but cannot execute.

### 2.10 Revoking a session did not revoke the access token — MEDIUM

`revokeAllSessionsForUser` stamps `revokedAt` on the `sessions` rows, and those rows are
consulted on exactly one path: refresh rotation. The access token carries no session id and
`resolveRequestUser` never looked at `sessions`, so a stolen access token kept full API
access for the remainder of its 15 minutes **after** the password change, reset, 2FA
recovery or admin rotation meant to kill it.

**Fixed** with a per-user revocation epoch in Redis
(`modules/auth/lib/access-token-revocation.ts`), checked against the token's `iat`. It is
written inside `revokeAllSessionsForUser` itself rather than at each of the ten call sites,
because a wiring step somebody forgets is the shape of bug this codebase keeps finding. It
**fails open, loudly**: a Redis outage degrades to the previous behaviour rather than
logging out every user in the product.

### 2.11 Auth rate-limit buckets collided — LOW

`AuthIpRateLimitGuard` keyed on the handler name alone, which is not unique:
`PasswordResetController.request/confirm` and `TwoFactorRecoveryController.request/confirm`
share both method names, so two unrelated flows counted against one another's budget.
Tighter than intended rather than looser, so never a bypass — but the guard's own header
claimed "bucketed per ROUTE". Now keyed on `Class.handler`.

---

## 3. Correctness and product bugs fixed

- **The LMS assignment page crashed on every cold load.** A `React.useMemo` sat after four
  conditional early returns, so the render where the data arrived ran one more hook than
  the loading render before it — "Rendered more hooks than during the previous render", on
  a route with no error boundary anywhere in `apps/lms/app`. Root cause of the class:
  `eslint-plugin-react-hooks` was configured **nowhere** in the monorepo. It is now enabled
  for all four React workspaces, with `rules-of-hooks` as an error.
- **`pnpm db:seed` aborted on every database.** The HR grant block called
  `permId("users.view")`, but the `users.*` keys are upserted outside the catalog the
  lookup map is built from, and `permId` throws on a miss. A fresh deployment could not be
  seeded.
- **Coupon validation on `/pricing` could never work in production.** Its Turnstile widget
  was wrapped in a `display:none` div, and a widget that is never laid out never runs its
  challenge — so no token was minted and the server fail-closed on every apply. The
  component's own `appearance` doc comment names this exact mistake.
- **Gamification awarded nothing, ever.** All five award entry points had zero call sites —
  the only references in the API were TODO comments naming the sites nobody added. So
  `points_ledger` and `user_badges` were never written, while the LMS Progress page renders
  XP, badges, a streak and a leaderboard. Every student saw zeroes, permanently. Wired at
  the real event sites: lesson completion, assignment submission (on time by construction —
  a late one is already refused), assessment pass (both the auto-scored and the
  manually-graded path), project approval, and certificate issuance.
- **The leaderboard was doubly broken.** The Progress page passed `enrollmentId` to a
  **batch**-scoped endpoint, so `GET /batches/:id/leaderboard` 404'd every time and the LMS
  rendered that as "Leaderboard is not available for this batch" — a plausible-looking
  product state. And every row was stamped with the current user's id, so the table
  highlighted the entire board as "you". `ProgramProgressDetail` now carries `batchId`, and
  the leaderboard DTO carries a per-row `isMe` resolved server-side (which discloses
  nothing: it is a fact about the caller, who already knows who they are).
- **Lesson resources could not be downloaded**, and the page said so: every row shipped a
  dead chip titled "Download coming in P4". The endpoint, service, SDK method, hook and its
  unit test had all shipped; the hook simply had no consumer.
- **Two "Sign in" links went nowhere.** `/account`'s signed-out CTA pointed at `/enroll`,
  which does not exist, and the enrol form's "Log in" pointed at `/account` — the
  signed-out page itself.
- **The Razorpay loader could hang forever.** When a `checkout.js` tag was already in the
  document it polled every 100 ms with no resolve-on-failure, no reject and no timeout, so
  a failed earlier insertion left the promise pending and the Pay button disabled with
  nothing on screen. `retryPayment` also guarded `if (!order || !checkout)` and then
  dereferenced `order!.orderId` inside that branch.
- **The enrol form claimed an OTP was sent when it was not** — the request helper swallowed
  the failure and resolved `void`, so the green confirmation rendered beside the red error.
- **`grade_ready` notifications deep-linked to a 404** — `/assignments/{submissionId}`
  against a route that resolves an **assignment** id.
- **Scheduled reports were unreachable.** The whole feature (5 endpoints, a dispatch
  scheduler, a permission, four components) sat behind a route in no nav, no tile and no
  link.
- **45 CRM error toasts bypassed `surfaceError`**, dropping the API's `errors[]` array — so
  a 422 said only "One or more fields failed validation" with no field named, and a 403
  invited a retry that could never succeed. Worse, seven forms call `Schema.parse()` inside
  their submit `try/catch`, and a `ZodError` **is** an `Error` whose `message` getter is
  `JSON.stringify(issues, null, 2)` — staff were being shown a raw JSON array.
- **Three page fallbacks published invented facts**, rendered exactly when the CMS fetch
  fails and nobody is watching: fabricated scholarship statistics and a fund-distribution
  chart, three invented students with names and real medical colleges, and six invented
  gallery events each rendered as a grey box containing the literal string
  `[Image: …]`. `careers-fallback.tsx` already records the rule they broke: *a fallback may
  degrade; it may not lie.*
- **Scheduled campaigns never fired.** `Campaign.scheduleAt` has been written, validated
  and displayed since P6, the CRM builder makes picking a send time a REQUIRED step, and
  `scheduled` is handled as a first-class status throughout the service — but nothing ever
  polled for a due campaign. One saved as scheduled sat there forever and went to nobody.
  Recorded in `docs/live-issues.md` as a known gap; the missing piece was a sweep, which
  now exists (`CampaignScheduleScheduler`, mirroring the EMI-dunning and report-dispatch
  schedulers, gated by the same `SCHEDULER_ENABLED` flag so it never fires in tests). It
  sends as whoever SCHEDULED the campaign — they chose the moment as much as the content,
  and it is the only accountable name there is.
- **The Student 360 drawer had no Attendance tab.** `attendance` rows have been written
  since P3 (one per completed lesson, deduped per enrollment+lesson) and by the live-class
  sync, and nothing on the STAFF side could read them: no CRM endpoint, no SDK method, no
  screen. `docs/03` §7 and the go-live checklist both describe the tab as done. Built as a
  read-only surface — repository → service (scoped exactly like every other student read,
  404 rather than an empty list when the student is out of scope) → `GET
  /crm/students/:id/attendance` gated on `students.view` → SDK → hook → tab.
- **Converting a lead offered batches the API would refuse.** The batch picker in the
  convert drawer listed every batch for the programme, finished ones included, while the
  server accepts only `planned` or `active` (400 `commerce.batch_not_accepting`). A
  counsellor picked the only batch on the list and got an error naming a rule the dropdown
  had just contradicted. The `enrollable: true` flag exists precisely for this and says so
  in its own doc comment; the two sibling pickers that also move a student into a batch
  already passed it, and this one was missed.
- **A lead-capture modal covered the certificate-verification form.** The sitewide timed
  "Have Questions?" popup opens ~4s after load and is suppressed on `/pay/:token` and
  `/onboarding` for exactly this reason. It was not suppressed on `/verify`, where it
  physically intercepted the click on "Verify certificate" — and where the visitor is
  usually an employer checking a credential, not a lead.
- **The forum's "Report post" button only called `console.info`.** No endpoint exists and
  `ForumPost.status` is only `visible | hidden`, so a student reporting abuse got silence.
  The control is removed rather than left lying — see §5.

---

## 4. Schema and test-suite corrections

- **Prisma schema drift closed.** `prisma migrate diff` showed five divergences between the
  migrations and `schema.prisma`. Four are now fixed in the schema (a `TIMESTAMPTZ` pair
  that Prisma believed was `timestamp(3)`; the `certificates.issued_by` FK, whose implicit
  action for an optional relation is `SetNull` while the live constraint is `RESTRICT`; two
  `marketing_targets` defaults; a missing `onboarding_submissions` index). The fifth — the
  generated `search_vector` `tsvector` columns — is **unavoidable and documented**: Prisma
  cannot express `GENERATED ALWAYS AS … STORED`. A `prisma migrate dev` would still propose
  dropping those three columns; the migrations that touch those tables say so, and this
  repo writes its migrations by hand for that reason.
- **Four integration tests had been failing since earlier deliberate behaviour changes**
  and are corrected to assert what the product now does: `resend-credentials` emails a
  set-password *link* rather than a temporary password (`24c9d3b`), the audit redaction
  sentinel lost its em dash (`ba687bd`), batch completion now *issues* the cohort's
  certificates (`aa17681`), and `GET /crm/org/me/position` is an authn-only route (P17).
- **The RBAC matrix gained a positive assertion**: a student session must be refused every
  `/crm/*` route it has no own-scoped business on. That test immediately found five more
  routes a student could reach; four are legitimate (`tickets`, `live-classes`,
  `kb-articles`, `emi-plans` all resolve `own` to that student's own rows) and are listed
  with their reason, and the fifth — `certificate-templates` — was a genuine gap and is
  now narrowed.

---

## 5. Still open

Nothing below is a regression from this pass; each is a gap that predates it and needs a
decision or a build, not a patch.

| # | Item | Notes |
|---|------|-------|
| **O1** | **Forum post reporting does not exist.** | The button is now removed rather than silently doing nothing. Building it needs somewhere to put a report — a `forum_post_reports` table, or a route into the existing ticket queue — plus a CRM surface to work it. A student forum with no abuse reporting is a product decision somebody should make deliberately. |
| **O2** | **WhatsApp template campaigns still fail at Meta.** | Separate from the scheduling gap above, and unchanged by this pass: `docs/live-issues.md` records three defects (the friendly template name is sent instead of the approved one, variables are never passed, the language is hard-coded to English). Email campaigns work; WhatsApp ones do not, scheduled or otherwise. |
| **O3** | **`branch` scope is unimplemented** for assessments, assignments, certificates and EMI. | It is now **refused** rather than silently treated as "all". A branch manager holding those keys gets a clear 403 instead of every branch's data. Either implement a real filter or narrow the seeded grants. |
| **O4** | **Presigned PUT size limits are advisory.** | `maxBytes` is written as object metadata; S3/R2 do not enforce a byte ceiling on a presigned PUT. An anonymous caller can declare `sizeBytes: 1` and upload gigabytes. Fix with `createPresignedPost` + a `content-length-range` condition, or a bucket policy. |
| **O5** | **No AV scanning on uploads** (resumes, onboarding receipts, submissions). | Long-standing, tracked in `docs/go-live-checklist.md` R8. Staff download these files. |
| **O6** | **Quiet-hours notifications are dropped, not deferred.** | `isInQuietHours` returns a `deferUntil` and `NotificationsService` `continue`s past the send. The in-app row is still written, so nothing is lost from the student's inbox — but the email/SMS never arrives. Closing it properly means carrying `deliverAfter` through `NotificationDispatchPort` and using BullMQ's `delay`. Tracked in `docs/go-live-checklist.md` R5. |
| **O7** | **A lead cannot be edited in the CRM.** | `PATCH /crm/leads/:id`, the SDK method and `useUpdateLead` all exist and nothing calls them, so a typo'd phone or email on a lead is uncorrectable through the product. `POST /crm/leads/:id/restore` has no SDK method either, so a soft-deleted lead cannot be brought back. |
| **O8** | **Descriptive grading cannot show the answer.** | `QuestionResultSchema` carries no question or answer text, so the CRM's grade drawer renders "Student answer is stored server-side" above a score input. Faculty are asked to grade something they cannot read. |
| **O9** | **Live classes are retired from the product but not from the codebase.** | No UI in any of the three apps; `permission-screens.ts` classifies it as removed. Still running: the module, a BullMQ reminder worker, a Zoom/Meet provider seam and five seeded permissions. Delete it or bring it back. |
| **O10** | **Multi-tenancy is not live.** | `TENANT_SLUG` is hardcoded. Harmless while single-tenant, a blocker at tenant #2. Unchanged from the go-live checklist. |
| **O11** | **Credential-gated verification** — real Razorpay/MSG91/Mux/R2 keys, the k6 load run, and PII read-audit coverage (`@AuditRead`). | All carried from `docs/go-live-checklist.md`; none is a code gap. |

---

## 6. How this was verified

- `turbo run typecheck` — 11 tasks, green.
- `turbo run lint` — 12 tasks, green (0 errors; the 14 `react-hooks/exhaustive-deps`
  warnings are the usual react-hook-form `reset` identities and are left alone).
- `turbo run test` — the full unit suite across all eight workspaces.
- `pnpm --filter @stimuliiq/api test:integration:safe` — the integration suite against a
  throwaway `stimuliiq_test` database. **Use this wrapper, never `test:integration`
  directly**: the repo-root `.env` points `DATABASE_URL` at production Supabase, and the
  suite creates hundreds of users. The wrapper refuses to run against a non-local database
  or one whose name does not end in `_test`.
- Playwright end-to-end suites for all three frontends, against a live API on :4000 and a
  seeded local database:

  | Suite | Result |
  |-------|--------|
  | `apps/crm` | **36 passed**, 0 failed, 8 skipped |
  | `apps/web` | **12 passed**, 0 failed, 1 skipped |
  | `apps/lms` | **2 passed**, 0 failed |

  Getting there fixed three product defects (the batch picker, the popup over `/verify`,
  and the missing Attendance tab) and several stale or racy specs:

  - Both the CRM and LMS suites sign in as ONE shared account, and Playwright runs spec
    FILES in parallel even with `fullyParallel: false`. In the CRM two specs enable 2FA on
    that account mid-run, so every other file's login 401'd and six specs failed with the
    same "login card still visible" symptom. Both configs are `workers: 1` now, with the
    constraint written down; the real fix is a throwaway staff user per spec.
  - Three specs asserted copy or structure that had since changed: the verify panel's
    heading ("Verified Authentic", 9e0f74d), the CSRF cookie name (audience-scoped
    `crm_csrf_token` since the dual-login fix), and "Students" being a nav GROUP rather
    than a link.
  - Two interacted with a page before React had hydrated, which passes against a warm dev
    server and fails against a cold one — the worst kind of flake.
  - `live-class-list-join.e2e.spec.ts` was deleted: live classes are a RETIRED feature
    (`permission-screens.ts` lists the module as removed, the LMS route no longer exists),
    so the spec was testing a 404. The backend leftovers are O9 above.

  The 8 CRM skips are honest: four need org-chart fixture staff (a member, a lead and a
  manager) that the seed does not create, one needs a headed browser (headless Chromium
  has zero-width overlay scrollbars, so there is nothing to measure), and the rest
  self-skip on absent optional state. The web skip needs an eligible, not-yet-issued
  enrollment to self-provision a certificate from.
