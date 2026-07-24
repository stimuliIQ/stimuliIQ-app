# QA — Full Application Test Scenarios

> Manual + automated test scenario catalogue for the whole stimuliiq stack.
> Written against the code as it exists at Phase-9 completion.

---

## Part 0 — Execution results (run of 2026-07-16)

> First execution pass. Environment brought up from a **truncated (empty) DB**, seeded,
> and driven with the real automated + browser-e2e harness. This section records actual
> PASS / FAIL / SKIP — the per-scenario tables in Part 3 remain the plan; the mapping
> from those IDs to executed evidence is summarised here.

### Environment
- Infra: Postgres `:55433`, Redis `:6380` (docker, healthy). API `:4000` → `health/ready` = `{db:ok, redis:ok}`.
- Seed: `pnpm db:seed` + `node scripts/dev-set-passwords.cjs` (canonical demo data + 5 role logins).
- Business dataset: `pnpm db:seed:medical` (new) — see "Medical seed" below.

### A. Automated backend suite (Jest — unit + live-DB integration) — ✅ ALL GREEN
| Metric | Before seed (empty DB) | After seed |
|---|---|---|
| Suites | 128 pass / **21 fail** | **149 pass / 0 fail** |
| Tests  | 1936 pass / **106 fail** | **2042 pass / 0 fail** |

The 106 initial failures were **not code defects** — every failing suite was a
`*.permission-catalog.spec.ts` (or `appmodule-p4-boot.integration.spec.ts`) that queries
a **live seeded DB**; they failed only because the DB had been truncated. After seeding
they all pass. This suite is the automated proof for the server-side logic behind:
Suite **C** (coupon math C-08, GST split C-09, order/webhook idempotency C-04/C-05,
webhook signature C-06), Suite **I** (cert HMAC verify I-07/I-08, revoke I-06), Suite
**J** (manual-payment match J-02, reconciliation J-03, refund rules J-04), Suites
**Q/R** (permission catalog + role/scope grants Q-01/Q-02, R-01…R-11). UI halves of those
scenarios remain pending browser e2e (see C below).

### B. Browser e2e (Playwright, real Chromium, live apps) — ✅ 17 passed / 0 failed / 5 skipped
| App | Passed | Skipped | Fixed this run |
|---|---|---|---|
| `web` :3000 | 7 | 1 (cert self-provision helper) | — |
| `crm` :3002 | 8 | 0 (2FA-enroll held — it mutates the demo admin login) | — |
| `lms` :3001 | 2 | 2 (ticket-create = CORS blocker below; join = no live session) | **login selector bug** |

Evidence mapped to Part-3 IDs:
- **B-15 / I-05 / I-06 / I-07** cert verify — valid, revoked (410 on download), forged-not-found, PDF download → `web`, `crm` cert-verify specs. ✅
- **A-18** reset enumeration-resistant (200 for real + fake email), **A-17** confirm invalid-token 422 → `web` password-reset specs. ✅ (⚠ see defect: `/reset-password` page 404).
- **A-11** CSRF — mutation still works after cookie rotation → `crm` csrf-rotation. ✅
- **E-01** Student-360 drawer (all 7 tabs render, completed-student cert visible, enrollments), **E-02** duplicate-email conflict + delete/re-add → `crm`. ✅
- **F-01 / K-01** LMS live-classes list renders (populated or explicit empty state), **N-01** ticket validation (empty subject/body blocked) → `lms`. ✅
- **Fixed:** LMS e2e login `beforeEach` used `getByLabel("Password")`, which substring-matched the "Show password" toggle button → Playwright strict-mode failure before login. Switched both LMS specs to `#login-email` / `#login-password` (consistent with the CRM specs). Now green.

### C. Video "can't see after upload" — diagnosed; one real bug fixed
Root cause is **not** a broken upload — local dev runs the `noop` video provider (default
`VIDEO_PROVIDER=noop`):
1. A fresh upload is created `status: processing`. Nothing flips it to `ready` locally,
   because that only happens via a **transcode webhook** the noop provider never fires →
   `GET /lessons/:id/stream-url` returns **409 `lms.video_not_ready`** forever.
2. Even a `ready` video won't play in dev — noop `mintSignedHlsUrl` returns a fake
   `https://noop.video.local/…m3u8`. Real playback needs **Cloudflare Stream / Mux keys**
   (a known go-live provisioning item, not code).
3. **Fixed (real bug):** the LMS player mapped only **503** → the friendly "not available
   yet" state, so a still-processing **409** showed a misleading generic "Failed to load
   video" error. `apps/lms/src/hooks/use-stream-url.ts` now maps 409 too. (F-02/F-04 UX.)

### D. Medical business dataset — `pnpm db:seed:medical` (new, `prisma/seed-medical.ts`)
Standalone + idempotent; reuses the canonical RBAC, adds: **1 branch** (BiPC Medical
Academy — Hyderabad), **1 admin** (`admin@bipc.test`), **5 faculty**, **10 mentors**
(BiPC/medical SMEs, all assigned to batches), **6 courses** @ **₹10,000** (3 with
scholarship), **6 batches** (faculty + 2 mentors each), and coupons **OFFER6000**
(flat ₹4,000 off → ₹6,000 offer price — Program has no separate sale-price column, so the
offer price is realised through the real checkout discount path) + **MEDSCHOLAR50** (50%,
scoped to scholarship courses). Logins: `<first>@bipc.test` / `Faculty@12345` /
`Mentor@12345`; admin `Admin@12345`. Backend suite stays 2042/2042 green with this data present.

### E. Blocker status (updated 2026-07-16, second pass)
- **CORS `Idempotency-Key`** — ✅ **RESOLVED**. `apps/api/src/main.ts:136` `allowedHeaders`
  now includes `Idempotency-Key`; preflight verified (`Access-Control-Allow-Headers` returns
  it for Origin `:3001`). The LMS ticket-create e2e (`N-01`) was **un-skipped and now passes**
  — a student creates a ticket cross-origin (`:3001` → `:4000`) with no CORS failure.
- **Reset-password page** — ✅ **NOT actually missing**. Fully implemented and wired in BOTH
  **CRM** (`/forgot-password` + `/reset-password` routes in `router.tsx`, "Forgot password?"
  link on the login form, forms + hooks) and **LMS** (`app/forgot-password`, `app/reset-password`).
  The reset email targets `LMS_APP_URL/reset-password` (which exists). The earlier "404" note
  referred to the **web** marketing site, which has **no login** and is not part of the reset
  flow. (Optional future refinement: make the reset email audience-aware so a CRM-originated
  request links to `CRM_APP_URL/reset-password` instead of the LMS one — both work today; the
  confirm endpoint is app-agnostic.)
- **Video playback** — still needs real Cloudflare/Mux credentials to actually play (C above);
  the 409-vs-503 UX bug is fixed.

### G. Additional real CRM login (created this pass)
`node scripts/create-crm-admin.cjs` (new, idempotent) → **`support.stimuliiq@gmail.com`** /
**`Admin@1234`**, `super_admin` (scope all), CRM `:3002`. This is the app's OWN auth
(NestJS JWT + argon2 + Postgres + RBAC) — there is no Supabase in this stack. Verified: API
login `200`, and a real-browser CRM login (student-360 suite, 4/4) using these creds. Note:
the requested `Admin@123` (9 chars) is rejected `400` by the login DTO's 10-char minimum
(`PasswordSchema`); `Admin@1234` is the closest compliant password.

### F. What's still PENDING (browser e2e not yet written for these)
Suites B (most of web funnel), C (checkout UI incl. Razorpay TEST), D, E (bulk of CRM
academics UI), F (video playback, progress, notes, bookmarks), G, H, K, L, M, N, O, P, Q,
T (a11y/axe, responsive) — server logic is covered by the 2042-test suite where noted in
A; the **UI journeys** need dedicated Playwright specs. This is the bulk of the remaining
"real browser e2e across live apps" effort.

---

## Part 1 — What the application actually is

Four deployables in one pnpm/Turborepo monorepo, one shared Postgres.

| Surface | Stack | Port (local) | Who uses it | Auth |
|---|---|---|---|---|
| `web` — marketing site | Next.js 15 App Router (SSG/ISR/SSR) | 3000 | Anonymous prospects | Public (only `/account` is auth-aware) |
| `lms` — student portal | Next.js 15 App Router, PWA | 3001 | Enrolled students | Cookie session, `audience: "lms"` |
| `crm` — admin dashboard | Vite + React SPA, TanStack Router/Query | 3002 | Staff, faculty, mentors, admins | Cookie session, `audience: "crm"` |
| `api` — backend | NestJS modular monolith, Prisma, Redis | 4000 (`/api/v1`) | All three | JWT-in-httpOnly-cookie + RBAC |

**The commercial arc the product implements**: a stranger lands on `web`, becomes a **lead**
(popup / form / book-a-slot), a **counsellor** works that lead in `crm`, the lead converts by
paying through Razorpay on `web`, which creates an **order → payment → enrollment → invoice**,
which provisions **LMS access**. The student then learns (video, live classes, assignments,
projects, assessments), and on meeting an eligibility bar earns a **certificate** with a
publicly verifiable UID that anyone can check back on `web`. Staff run the whole thing from
`crm` — academics, commerce, marketing, support, analytics, governance.

### The seven mechanisms everything else is built on

These are the load-bearing invariants. Most of the interesting test scenarios are attacks on them.

1. **RBAC is server-side.** `@RequirePermission("module.action")` on the controller, checked by
   `PermissionsGuard`. The CRM UI only *hides* affordances — deep-linking a page you lack
   permission for renders the shell and the API returns 403. Both halves need testing separately.
2. **Data scope, not just permission.** Every grant carries a scope: `all | branch | assigned | own`.
   Faculty see only their assigned batches; mentors only their own; counsellors only their branch;
   students only themselves. `requireScopeContext()` *throws* rather than falling open to "all" —
   an empty scope array must mean **zero rows**, never "no filter".
3. **Money is integer paise, server-derived.** The client never sends a price. Coupons, GST (18%,
   tax-inclusive, CGST/SGST split with the remainder paisa going to SGST), and EMI are all computed
   server-side. Floats anywhere is a bug.
4. **Idempotency everywhere it matters.** Order creation is keyed on `idempotency_key`; the Razorpay
   webhook is keyed on `provider_payment_id`; refunds key on the refund row id. A replay must never
   double-enroll or double-charge.
5. **Soft delete + audit.** `delete` is rewritten to `deletedAt = now()`; every mutating action on an
   audited model writes an `audit_logs` row post-commit with before/after and actor. Restore endpoints
   exist for students, leads, faculty, mentors, batches.
6. **Signed, short-lived media.** Video is signed HLS minted per-play with a server-built watermark;
   it **fails closed with a 503** rather than ever emitting an unsigned URL. Resource downloads and
   certificate PDFs are signed on demand and never stored.
7. **Public endpoints are hostile-input surfaces.** Every public form has honeypot + Turnstile captcha
   + DPDP consent + a Redis fixed-window IP rate limiter that **fails closed**. Every webhook verifies
   an HMAC with `timingSafeEqual` and fails closed when the secret is absent.

---

## Part 2 — Getting a testable environment back

**You truncated the DB.** All 77 tables are empty; only the 35 `_prisma_migrations` rows survive.
There are currently **no users, no roles, no permissions** — so nobody can log into CRM or LMS.
Before any test run:

```bash
# 1. infra up (Postgres :55433, Redis :6380)
docker compose -f infra/docker-compose.yml --env-file .env up -d

# 2. repopulate: catalog, roles, permissions, demo users, programs, batches…
pnpm db:seed

# 3. seeded users are status="invited" with placeholder hashes and CANNOT log in.
#    This activates the five demo accounts and sets known passwords.
node scripts/dev-set-passwords.cjs

# 4. apps
pnpm --filter @stimuliiq/api dev     # :4000
pnpm --filter @stimuliiq/web dev     # :3000
pnpm --filter @stimuliiq/lms dev     # :3001
pnpm --filter @stimuliiq/crm dev     # :3002
```

Health gate before testing anything: `GET http://localhost:4000/api/v1/health/ready`
→ `{"status":"ok","db":"ok","redis":"ok"}`.

### Credentials (local demo only — created by the seed + password script)

| Email | Password | Role | Log in at |
|---|---|---|---|
| `admin@stimuliiq.test` | `Admin@12345` | **Super Admin** — full catalog, scope `all` | **CRM** :3002 |
| `faculty.priya@stimuliiq.test` | `Faculty@12345` | Faculty — `assigned` scope | CRM :3002 |
| `counsellor.sneha@stimuliiq.test` | `Counsellor@12345` | Counsellor — `branch`/`own` scope | CRM :3002 |
| `mentor.ramesh@stimuliiq.test` | `Mentor@12345` | Mentor — own batches, `/mentor/dashboard` | CRM :3002 |
| `student.ananya@stimuliiq.test` | `Student@12345` | Student — `own` scope | **LMS** :3001 |

The **CRM login you asked for is `admin@stimuliiq.test` / `Admin@12345`.** These exist only after
step 2 + 3 above. They are non-secret local fixtures and do not exist in staging or production.

Roles in the system: `super_admin`, `admin`, `branch_manager`, `counsellor`, `faculty`, `finance`,
`marketing`, `support`, `content_editor`, `student`, `mentor`.

---

## Part 3 — Test scenarios

Format: **ID · Scenario · Preconditions → Steps → Expected**. Priority **P0** = blocks release,
**P1** = must pass before sign-off, **P2** = polish/edge.

---

### Suite A — Authentication, session, identity

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| A-01 | P0 | CRM happy-path login | Admin creds at :3002 → session cookies set (`access_token`, `refresh_token` httpOnly; `csrf_token` readable), dashboard renders with all nav sections. |
| A-02 | P0 | LMS happy-path login | Student creds at :3001 → dashboard renders "Continue learning". |
| A-03 | P0 | **Audience gate — student cannot enter CRM** | Log in at :3002 with `student.ananya` → **403 `auth.audience_forbidden`**, no session issued. |
| A-04 | P0 | **Audience gate — staff cannot enter LMS** | Log in at :3001 with `admin` → 403 `auth.audience_forbidden`. |
| A-05 | P1 | Audience gate is optional-but-enforced | `POST /auth/login` with **no** `audience` field → succeeds (legacy/server-to-server path). Gate must be a no-op when absent, not a rejection. |
| A-06 | P0 | **User enumeration resistance** | Login with unknown email vs. known email + wrong password → **identical** error body (`auth.invalid_credentials`) and comparable response latency (both run a full-cost argon2 verify). |
| A-07 | P0 | Inactive account | Any seeded user *not* activated by the script → same generic `auth.invalid_credentials`, never "account inactive". |
| A-08 | P0 | **Refresh rotation** | Call `/auth/refresh` → new refresh token issued, old one invalid. |
| A-09 | P0 | **Refresh reuse detection** | Capture refresh token R, refresh (→R′), then replay **R** → **409 `auth.refresh_reuse_detected`** *and the entire session family is revoked* (R′ also now dead). |
| A-10 | P0 | Silent refresh in the client | Let access token expire (15 min) mid-session in LMS → next API call auto-refreshes once and succeeds; user is not bounced to login. |
| A-11 | P0 | **CSRF double-submit** | `POST` any mutation with a valid session cookie but **omitted/incorrect `X-CSRF-Token`** → rejected. Then with the header matching the `csrf_token` cookie → accepted. |
| A-12 | P1 | CSRF exemptions are exactly right | Login, otp/*, password-reset, all webhooks, unsubscribe, `2fa/login-verify`, `storage/local/*` must work **without** the header; nothing else should. |
| A-13 | P0 | Logout | Logout → cookies cleared, session revoked server-side, replaying the old access token fails. |
| A-14 | P1 | **2FA enrol → challenge → login** | CRM `/admin/settings` → Two-Factor tab → Enable → scan/enter TOTP → verify → backup codes shown once. Log out, log in → **login returns a 2FA challenge, not a session**; `POST /auth/2fa/login-verify` with a valid TOTP → session issued. |
| A-15 | P1 | 2FA backup code | Log in with a **backup code** instead of TOTP → succeeds, and that code is single-use (second attempt fails). |
| A-16 | P1 | 2FA disable requires proof | Disable 2FA without a valid TOTP/backup code → rejected. |
| A-17 | P0 | **Password reset** | LMS `/forgot-password` → email → `/reset-password?token=` → set new password → redirected to `/login?reset=success`; old password rejected; **all existing sessions for that user are revoked**; the token is single-use and expiring. |
| A-18 | P0 | Reset does not leak account existence | `/forgot-password` with an unknown email → **identical** neutral confirmation to the known-email case. |
| A-19 | P1 | Auth rate limiting | Hammer `/auth/login` from one IP / one email → `AuthIpRateLimitGuard` + per-email limiter kick in and throttle. |
| A-20 | P2 | Phone OTP | `POST /auth/otp/request` → local SMS provider is a **no-op stub** (known go-live blocker B3). Verify the stub path returns cleanly; do not treat missing SMS as a defect. |

---

### Suite B — `web`: public site, SEO, lead capture

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| B-01 | P1 | Home renders | `/` (ISR) → hero, featured programs from `public.programs.list`, mentors teaser, testimonials, FAQ, lead band. |
| B-02 | P1 | Programs browse + filter | `/programs` → search `?q=`, specialisation checkboxes, sort (popularity/price asc/desc/newest), cursor pagination. Empty + error states render. |
| B-03 | P1 | Program detail | `/programs/[slug]` → sticky buy card, CTAs to `/enroll/[slug]` and `/book-free-slot`, JSON-LD (`Course`, `FAQPage`, `BreadcrumbList`) present and valid. |
| B-04 | P0 | **Unpublished/private program is a 404** | Hit a non-public slug → 404, no data leaked. |
| B-05 | P1 | Pricing | `/pricing` → prices come from the API as paise and are formatted, **no client-side money arithmetic**. Coupon validator returns the server's display string. |
| B-06 | P0 | **Lead capture (timed popup)** | Wait ~4s on any page → popup fires **once per session** (sessionStorage guard). Submit → lead lands in CRM `/leads` with correct `source: web-timed-popup` and **UTM attribution** (utm_*, gclid/fbclid, referrer, landing URL). |
| B-07 | P0 | **Honeypot** | Fill the hidden `_hp_email` / `hp_field` field → submission is silently rejected; no lead created. |
| B-08 | P0 | **Captcha gate** | Submit any public form with a missing/invalid Turnstile token → rejected. (Dev provider is `noop`; test the failure path against the real gate config.) |
| B-09 | P0 | **DPDP consent** | Submit without `tosAccepted: true` → rejected. `marketingOptIn` is recorded and honoured downstream by campaigns. |
| B-10 | P0 | **Public rate limiter fails closed** | Burst public lead/booking submissions from one IP → throttled. Kill Redis → limiter **fails closed** (rejects), it does not fall open. |
| B-11 | P1 | Book-a-slot (4 steps) | `/book-free-slot` → program → slot → details (name, phone required; email optional) → confirm → booking appears in CRM `/leads/bookings`. Double-clicking submit does **not** create two bookings. |
| B-12 | P1 | Contact / newsletter / careers | `/contact` (≤5000 char message), newsletter band, `/careers` apply (PDF resume via signed upload URL) → all land in CRM under Content → intake lists. |
| B-13 | P1 | Blog + CMS pages | `/blog`, `/blog/[slug]` → body is authored HTML rendered through DOMPurify. **Inject `<script>` / `onerror=` into a post body in CRM → it must be stripped on render.** |
| B-14 | P1 | Landing pages + A/B | `/lp/[slug]` with and without `?variant=` → server resolves the split; unpublished → 404; `robots.txt` disallows `/lp/*`. |
| B-15 | P1 | Certificate verification (public) | `/verify` → enter cert ID → `/verify/[certId]`. Three states must all render: **valid** (holder, program, issue date), **revoked** (not colour-only — icon + text), **invalid/404** (no internals leaked). |
| B-16 | P2 | SEO surface | `/sitemap.xml` lists static routes + public programs; `robots.txt` disallows `/account`, `/api`, `/book-free-slot`, `/lp/*`, `/search`; city pages `/programs/city/[citySlug]` render with JSON-LD. |
| B-17 | P2 | Analytics consent-gated | GA4/GTM loader must not fire before consent banner acceptance. |

---

### Suite C — The enrollment & payment funnel (highest-risk path)

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| C-01 | P0 | **Full happy path** | `/enroll/[slug]` → register (name/email/phone/OTP/password/consent + captcha) → order (optional coupon, optional EMI) → Razorpay TEST checkout → verify → success screen auto-redirects to LMS. **Assert the full chain exists**: order `paid`, payment `captured`, enrollment `active`, invoice generated, welcome notification queued, LMS access works. |
| C-02 | P0 | **programId never comes from the URL** | Tamper with the client payload to point at a different/expensive program → server uses the RSC-fetched program, request rejected or ignored. |
| C-03 | P0 | **Client cannot set the price** | Send a forged `amountPaise` → server recomputes from program price − coupon; forged amount ignored. |
| C-04 | P0 | **Order idempotency** | Reuse the same `idempotency_key` (generated once at funnel entry) → returns the **cached order**, does not create a second one. Retry after a network failure → same order. |
| C-05 | P0 | **Webhook idempotency** | Replay the Razorpay webhook with the same `provider_payment_id` → **no double enrollment, no double invoice, no double payment row**. |
| C-06 | P0 | **Webhook signature** | POST the webhook with a bad/missing `X-Razorpay-Signature` → rejected (fails closed). Verify comparison is timing-safe and uses the **raw body**. |
| C-07 | P0 | **Webhook replay window** | POST a validly-signed webhook with a stale `created_at` beyond `WEBHOOK_SIGNATURE_MAX_AGE_SECONDS` → rejected. (Known gap: freshness check is *skipped* when `created_at` is absent — assert this is the documented behaviour, then decide if it's acceptable.) |
| C-08 | P0 | **Coupon math** | Percentage coupon → `floor(price * pct / 100)`. Flat coupon larger than price → discount clamped to price, **net never negative**. Expired / max-uses-exhausted / wrong-program coupon → rejected. |
| C-09 | P0 | **GST split** | For several prices, assert `taxAmountPaise = round(a*18/118)`, `cgst = round(tax/2)`, `sgst = tax − cgst`, and **cgst + sgst === tax exactly** (the remainder paisa goes to SGST). No floats. |
| C-10 | P1 | Payment failure → retry | Fail the Razorpay payment → retry UI shown, retrying reuses the same order, no orphan enrollment created. |
| C-11 | P1 | Existing account at register step | Enter an email that already has an account → funnel switches to the login path, does not create a duplicate user. |
| C-12 | P1 | Double-click the pay button | Button disabled in-flight; only one order/checkout attempt. |
| C-13 | P1 | EMI plan at checkout | Select EMI → plan created with N installments; visible in CRM `/commerce/plans` and LMS `me/emi-plans`. |

---

### Suite D — CRM: leads → conversion (counsellor journey)

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| D-01 | P1 | Pipeline board | `/leads` → Kanban ⇄ table toggle; filters (search debounced 350ms, source, stage); server pagination (20/page). |
| D-02 | P1 | Create + edit lead | New lead form (Name*, Phone*, email, program interest, source, branch, owner, utm_*) → appears in the right stage column. |
| D-03 | P1 | **Stage transitions** | Drag through `new → contacted → qualified → counselling → negotiation → won/lost`. Each transition writes an **audit log** row. |
| D-04 | P0 | **Lead conversion** | Lead detail → Convert (`leads.convert`) → dialog (student name, email, course type, program, batch, coupon) → creates a **student + enrollment**, sets `converted_student_id`, moves lead to `won`. |
| D-05 | P1 | Bulk actions | Select rows in table view → bulk assign owner, bulk move stage (`bulk.leads`). Saved views: create, apply, delete. |
| D-06 | P1 | Counselling workspace | `/leads/counselling` → due/overdue follow-ups, pending bookings, SLA-overdue leads with `SlaChip`. Each panel has a working retry on error. |
| D-07 | P1 | Tasks & bookings | `/leads/tasks` complete a task; `/leads/bookings` transition status through `NEXT_STATUSES` only (invalid jumps blocked). |
| D-08 | P1 | Soft delete + restore | Delete a lead (confirm dialog) → row disappears from default lists; restore endpoint brings it back with history intact. |
| D-09 | P2 | Contact messages | `/leads/contact-messages` → status update (`content.edit`), reply-by-email mailto. |

---

### Suite E — CRM: academics (students, courses, batches, faculty, mentors)

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| E-01 | P1 | Student directory + 360 | `/students?status=lead\|active\|alumni` → filters, sort, pagination. Detail drawer tabs: Overview / Enrollments / Payments / Attendance / Certificates / Tickets / Timeline all populate. |
| E-02 | P1 | Student CRUD | Create (email immutable after create), edit, soft-delete + restore. Bulk status update (`bulk.students`). |
| E-03 | P1 | Program + curriculum | `/courses` → create program; detail → **publish/unpublish** (`courses.approve`), visibility toggle, curriculum builder: add modules/lessons, **reorder** persists. |
| E-04 | P1 | Batch CRUD | `/batches` → create (program*, branch*, faculty, dates, capacity, mode, status, day, times); filters; soft-delete + restore. |
| E-05 | P0 | **Batch roster: enroll / move / withdraw** | Roster tab → enroll student (search by name/email/phone) → **capacity is enforced**; move enrollment to another batch; withdraw (confirm). Each writes an audit row. |
| E-06 | P1 | Batch mentors | Mentors tab → assign mentor (`mentors.assign`), mark lead mentor, remove mentor (confirm). Locked-state warning shows when applicable. |
| E-07 | P1 | **Mark batch complete** | Completion tab → KPIs → Mark complete (`batches.markComplete`, confirm) → batch closes, students move toward alumni, certificate eligibility recomputes. |
| E-08 | P1 | Faculty & mentor directories | CRUD + soft-delete + restore for both. Mentor engagement-status filter works. |
| E-09 | P1 | Attendance roster | `/academics/attendance` → pick batch → roster + KPIs; edit attendance (`attendance.edit`) persists and feeds the student's attendance tab. |

---

### Suite F — LMS: the learning journey

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| F-01 | P1 | Dashboard | `/` → continue-learning card deep-links to `/lessons/[id]?t=<sec>`; live-class, deadlines, announcements, streak/badges, learning-path widgets all render. |
| F-02 | P0 | **Signed HLS video playback** | Open a lesson → `GET /lessons/:id/stream-url` is fetched **on play, never cached** → video plays with the watermark overlay. |
| F-03 | P0 | **Video access control (IDOR)** | Request `stream-url` for a lesson in a program you are **not** enrolled in → **404, not 403** (no existence disclosure). Preview lessons remain accessible. |
| F-04 | P0 | **Fails closed, never leaks an unsigned URL** | Force the video provider to error → **503**. Assert the response never contains a raw/unsigned playback URL. |
| F-05 | P0 | **Watermark is server-built** | Attempt to inject watermark text from the client → ignored; watermark is derived from the authed user server-side. |
| F-06 | P1 | Progress tracking | Play → throttled `PUT progress.ping` (~10s) with position; `POST progress.complete` (idempotency key per call) → dashboard, `/progress` rollup, and attendance all invalidate and update. |
| F-07 | P1 | Resume | Leave mid-lesson, return → resumes from `progress.lastPositionS` (or `?t=`). |
| F-08 | P1 | Timestamped notes | Lesson notes panel → create at current position, edit, delete. Timestamps accept `mm:ss` and raw seconds. |
| F-09 | P1 | Bookmarks | Bookmark a lesson and a forum thread → both appear under `/search` → Bookmarks tab; remove works. |
| F-10 | P1 | Resource downloads | Lesson resources + `/downloads` (search and browse-by-course) → each download mints a **signed URL on click**; URL expires. |
| F-11 | P1 | Progress + gamification | `/progress` → per-program rings, module bars, attendance summary. Gamification: XP, streak, badges. **Leaderboard only renders when opted in, and shows no PII beyond the chosen display name.** |
| F-12 | P2 | Search | `/search` over lessons/resources/forum with type filters. |
| F-13 | P2 | Calendar + iCal | `/calendar` aggregates live classes + assignment/assessment deadlines; per-event `.ics` export downloads and parses. |
| F-14 | P2 | PWA | Installable (manifest); offline fallback `/offline` renders when the network is cut. |
| F-15 | P1 | Profile | Theme / video quality / language persist device-locally. "Change password" sends a reset link to own email. Sign out works. |

---

### Suite G — Assignments & projects

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| G-01 | P1 | Faculty creates assignment | CRM `/academics/assignments` → create (lesson, kind, title*, instructions, max score, due date, allow-resubmit, is-final, milestones) → appears in LMS `/assignments` for the batch. |
| G-02 | P0 | **Student submits** | LMS `/assignments/[id]` → file(s) via signed upload URL + text + link → `assignments.submit()` → status `submitted`. |
| G-03 | P1 | Overdue policy | Submit after `due_at` → marked overdue, policy applied (not silently accepted as on-time). |
| G-04 | P0 | **Faculty grades (assigned scope)** | CRM → submissions panel → rubric grader (`submissions.grade`) → score + feedback → student sees it in LMS. **Faculty must only see submissions from their assigned batches.** |
| G-05 | P1 | Resubmission | With allow-resubmit → student resubmits → `submitted → graded → resubmitted` cycle; final grade recorded. |
| G-06 | P1 | Project milestones | LMS `/assignments/[id]/project` → per-milestone submit (link/notes/files) → CRM `/academics/projects` review (`projects.review`) → `changes_requested` loops back; **all milestones approved → project approved → certificate gate satisfied**. |
| G-07 | P2 | Delete assignment | Uses `assignments.edit` (not `.delete`) — confirm that's intentional and that a user with only `assignments.view` cannot delete. |

---

### Suite H — Assessments

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| H-01 | P1 | Create assessment | CRM `/academics/assessments` → create (module, title*, type, pass threshold %, time limit, max attempts) + questions with rubric hints and points. |
| H-02 | P0 | **Timed attempt** | LMS `/assessments/[id]` → start → countdown timer → submit → **objective questions auto-grade instantly**; pass/fail against threshold. |
| H-03 | P0 | **Max attempts enforced server-side** | Exhaust `maxAttempts` → further `startAttempt` calls **rejected by the API**, not just hidden in the UI. |
| H-04 | P1 | Timer expiry | Let the clock run out → attempt auto-submits/locks; late submission not accepted. |
| H-05 | P1 | Descriptive grading | Descriptive answers → `pending manual grade` in LMS → CRM grader (`attempts.grade`) → Pass/Fail → student sees the result. |
| H-06 | P2 | Proctoring flags | `flagAttempt()` records the flag (tab-switch etc.) and surfaces it to the grader. |

---

### Suite I — Certificates & public verification

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| I-01 | P0 | **Eligibility engine** | Student who has **not** met completion% + assessments passed + project approved → **not eligible**; LMS shows remaining requirements. Meet all three → eligible. |
| I-02 | P0 | **Issue** | CRM `/content/certificates` → recommend (`certificates.recommend`) → issue (`certificates.issue`, pick template) → PDF generated, `cert_uid` assigned. |
| I-03 | P1 | Bulk issue | Select rows → bulk issue → per-row results list shows individual successes/failures (partial failure does not abort the batch). |
| I-04 | P0 | **Student download** | LMS `/certificates` → download via signed URL, minted on demand and **never stored**. |
| I-05 | P0 | **Public verify — valid** | `web` `/verify/[certUid]` → valid → holder name, program, issue date. |
| I-06 | P0 | **Revoke → verify flips** | CRM revoke (reason **required**) → the same UID on `/verify` now shows **revoked**; the LMS download returns **410**. |
| I-07 | P0 | **Forged UID** | Tamper one character of the cert UID → HMAC verify fails → "Certificate Not Found", **no internals leaked**. |
| I-08 | P0 | **Signature alone is not enough** | Construct a UID with a *valid* HMAC for a student/program that has no live certificate row → must still fail, because verification requires **both** HMAC verify **and** a DB status lookup. |
| I-09 | P1 | Reissue | Reissue after a template change → new PDF, verification still resolves. |

---

### Suite J — Commerce (CRM side)

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| J-01 | P1 | Order & payment ledgers | `/commerce/orders`, `/commerce/payments` → filters (status, date range, program), pagination, detail drawers with receipts. |
| J-02 | P0 | **Manual payment** | Record manual payment (`payments.create`) → **amount must equal the order amount exactly**, else `commerce.manual_payment_amount_mismatch`. |
| J-03 | P0 | **Reconciliation** | `/commerce/payments` reconciliation widget over a date range → `reconcilesOk = (captured − refunds) === orderPaid`. Introduce a deliberate mismatch → it must surface, not silently pass. |
| J-04 | P0 | **Refund** | Request refund (`refunds.create`) → **refund > captured amount is rejected**. Approve (`refunds.approve`, confirm) → provider called with a stable idempotency key. Approving an already-processed refund is an **idempotent no-op**, not a double refund. Reject requires a reason. |
| J-05 | P1 | Coupons | `/commerce/coupons` → CRUD, percentage vs flat, max uses, validity window, deactivate. Validate tool returns the right server-side result. |
| J-06 | P1 | Invoices | `/commerce/invoices` → download via signed URL; GST breakdown on the invoice matches Suite C-09. |
| J-07 | P1 | EMI | `/commerce/plans` → create plan against a paid order; mark installment paid (`emi.charge`); trigger dunning. Student sees the plan in LMS. |

---

### Suite K — Live classes & attendance

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| K-01 | P1 | Schedule | CRM `/academics/live-classes` → schedule (title*, batch*, host, provider, start/end) → appears in LMS `/live` and `/calendar`. |
| K-02 | P0 | **Join mints a short-lived URL** | LMS `/live` → Join → server mints a provider join URL (short TTL, opened in a new tab). **Attendance is auto-marked server-side** — assert it appears in the batch roster. |
| K-03 | P1 | Edit is state-gated | Edit is only permitted while `status === "scheduled"`; cancel (confirm) transitions correctly and notifies students. |
| K-04 | P1 | **Live-class webhook** | Zoom: HMAC over `v0:{timestamp}:{rawBody}`; the **URL-validation challenge is handled *before* signature verification** — assert both the challenge and a signed event work, and that a bad signature is rejected. |

---

### Suite L — Forum

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| L-01 | P1 | Threads & replies | LMS `/forum` → pick an enrolled batch → create thread (title, body) → reply, upvote, resolve. |
| L-02 | P0 | **Batch IDOR** | Request threads for a batch you are **not** enrolled in → **404**. |
| L-03 | P0 | **XSS in post bodies** | Post a body containing `<script>` / `<img onerror>` → sanitized by DOMPurify before `dangerouslySetInnerHTML`; nothing executes. |
| L-04 | P1 | Moderation | CRM `/academics/forum-moderation` (`forum.moderate`) → **hide post requires a reason**; unhide restores. A user without `forum.moderate` sees the no-permission empty state. |

---

### Suite M — Notifications, campaigns, referrals

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| M-01 | P1 | Notification delivery | Trigger each type (grade_ready, certificate_ready, forum_reply, announcement, payment_receipt, welcome, live_reminder) → appears in LMS `/notifications`; bell badge updates. |
| M-02 | P1 | SSE + polling fallback | Live SSE stream delivers in real time; **kill SSE → polling fallback takes over**, no lost notifications. |
| M-03 | P1 | Preferences & quiet hours | `/notifications/prefs` → type × channel matrix + quiet hours → a notification inside quiet hours is suppressed/deferred on the muted channel. |
| M-04 | P0 | **Unsubscribe token** | `unsubscribe/:token` is authenticated **by HMAC alone** (no session). Valid token → unsubscribed. **Tampered token → rejected** (timing-safe compare). |
| M-05 | P1 | Campaign build → send | CRM `/marketing/campaigns` → builder (name, channel, audience source, template, timing) → send (`campaigns.send`) → recipients list populates; metrics (sent/delivered/opened/failed) update; pause and cancel work. |
| M-06 | P0 | **Marketing opt-out is honoured** | A contact with `marketingOptIn: false` must **not** receive a marketing campaign. |
| M-07 | P1 | Campaign webhook | Resend (Svix headers) and Meta/WhatsApp (`X-Hub-Signature-256`) → valid signature updates delivery status; invalid → rejected. |
| M-08 | P1 | Referrals | LMS student generates a referral → `public/referrals/redeem` (anonymous) → CRM `/marketing/referrals` → approve/reward or reject (`referrals.approve`). **Wave-6 fixed an H1 scope bug here — assert a student cannot see or act on another student's referrals.** |

---

### Suite N — Support (tickets + KB)

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| N-01 | P1 | Raise ticket | LMS `/support` → new ticket (subject, body, priority) → appears in CRM `/support/tickets` with an SLA timer. |
| N-02 | P1 | Agent workflow | CRM → assign (`tickets.assign`), change status/priority, reply, **internal note** (must **not** be visible to the student), insert canned response. |
| N-03 | P1 | State machine | `open → pending → resolved → closed`; on resolution the student is asked for a **star rating**, which records. |
| N-04 | P0 | **Ticket IDOR** | Fetch another student's ticket by id from LMS → 403/404. |
| N-05 | P2 | KB | CRM `/support/kb` CRUD (delete is gated on `kb.edit`) → published articles appear on the public `public/kb-articles` endpoint. |

---

### Suite O — Content, CMS, landing pages

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| O-01 | P1 | Blog CMS | `/marketing/blog-cms` tabs (Blog / Testimonials / Partners / Faculty Bios / Pages) → CRUD each; publish (`content.publish`) → appears on `web`. Unpublished stays invisible publicly. |
| O-02 | P1 | Landing pages | `/marketing/landing-pages` → Pages tab CRUD (title, slug, variant, campaign, body, SEO) and Forms tab (dynamic lead-form field builder) → `/lp/[slug]` renders the blocks. |
| O-03 | P0 | **Rich-text sanitization** | Every HTML-authoring surface (blog body, KB body, landing page richtext, content pages) → inject a script payload → stripped by `lib/sanitize.ts` / `RenderSink` on render. |
| O-04 | P1 | Video library | `/content/videos` → ingest video (`videolib.upload`) → **provider webhook** (Cloudflare/Mux, HMAC-verified) flips status to `ready` → the lesson becomes playable in LMS. Captions CRUD. |

---

### Suite P — Analytics, exports, schedules

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| P-01 | P1 | Report dashboards | Each of revenue / enrollment / funnel / attendance / engagement / campaigns / gamification / forum-health renders with the date-range + granularity filter, and its **numbers reconcile with the underlying records**. |
| P-02 | P0 | **Report permission gating** | A user lacking e.g. `reports.revenue.view` → `ReportPageShell` shows "You don't have access to this dashboard" **and** the API returns 403 on direct call. |
| P-03 | P1 | Composed reports | Cohort, branch-comparison (needs `reports.revenue.view` **AND** `branches.view`), faculty-performance (needs `faculty.view` **AND** `reports.attendance.view`), refunds → client-side CSV export downloads and parses. **Note: nav gates faculty-performance on `faculty.view` only — a user with `faculty.view` but not `reports.attendance.view` sees the nav item; verify the page itself denies cleanly.** |
| P-04 | P1 | Export jobs | `/analytics/exports` (`reports.export`) → create export (8 report types w/ PDF; 4 entity types CSV-only) → job status chip polls → download works. |
| P-05 | P1 | Scheduled reports | `/analytics/schedules` (`reports.schedule`) → CRUD a schedule (report, format, frequency, recipient, active) → the cron fires and emails. |
| P-06 | P2 | Report freshness | The freshness indicator reflects the materialized-view/Redis read-model refresh time, not "now". |

---

### Suite Q — Admin & governance

| ID | Pri | Scenario | Steps → Expected |
|---|---|---|---|
| Q-01 | P0 | **Role permission matrix** | `/admin/roles` → edit a role's grants + scopes. Rows the editor doesn't personally hold are **disabled**; scopes above the editor's own rank are disabled. |
| Q-02 | P0 | **Privilege-escalation is blocked server-side** | Bypass the UI and `PUT roles/:id/permissions` granting yourself a permission/scope you don't hold → **403**, surfaced as an inline alert. This is the single most important negative test in the suite. |
| Q-03 | P1 | System roles protected | `super_admin`/`admin` (isSystem) cannot be renamed or key-changed. |
| Q-04 | P1 | Branches | `/admin/branches` CRUD → branch-scoped users' visible data changes accordingly. |
| Q-05 | P0 | **Audit log** | `/admin/audit-logs` → every mutating action from every suite above has a row with actor, entity, action, before/after, IP. **PII is masked** per `SENSITIVE_MODEL_ALLOWLISTS`. Read-only — no edit affordance. |
| Q-06 | P1 | Feature flags | `/admin/feature-flags` → toggle a flag → `feature-flags/evaluate` reflects it; without `flags.edit` the switches are disabled and the new-flag form is absent. |
| Q-07 | P1 | Settings | `/admin/settings` System/Company tabs → `settings.view` to read, `settings.edit` to change. |
| Q-08 | P1 | DPDP erasure | `POST /dpdp/erasure` (`dpdp.erasure.execute`) → PII is erased/hashed while audit integrity is preserved. |

---

### Suite R — RBAC & data-scope isolation (the negative suite)

**This is the suite that matters most.** Run each as the named role, and for each,
attempt the action **both through the UI and by calling the API directly** — the UI hiding a
button proves nothing.

| ID | Pri | Scenario | Expected |
|---|---|---|---|
| R-01 | P0 | **Faculty sees only assigned batches** | `faculty.priya` → batch list, rosters, submissions, attendance return **only** batches where `batches.facultyId = her profile`. Directly GET a foreign batch id → 403/404. |
| R-02 | P0 | **Mentor sees only own batches** | `mentor.ramesh` → `/mentor/dashboard` and all batch endpoints scoped to assigned batches. The dashboard **re-verifies assigned scope server-side as a defense-in-depth IDOR guard** — test that guard by forging a batch id. |
| R-03 | P0 | **Counsellor is branch-scoped** | `counsellor.sneha` → leads/students/bookings limited to her branch; cross-branch ids 403/404. |
| R-04 | P0 | **Student is own-scoped** | `student.ananya` → cannot read another student's enrollments, submissions, attempts, certificates, tickets, referrals, or EMI plans by id. |
| R-05 | P0 | **Empty scope means zero rows, not all rows** | A faculty member with **no** assigned batches → lists return **empty**, never the full table. (This is the classic fail-open bug; `requireScopeContext()` should throw rather than default to `all`.) |
| R-06 | P0 | **Missing scope context throws** | Any repository path invoked without a scope context → `ScopeContextMissingError`, not an unfiltered query. |
| R-07 | P0 | **Deep-link without permission** | As faculty, navigate directly to `/commerce/refunds`, `/admin/roles`, `/analytics/revenue` → page shell may render but **every API call 403s** and no data appears. |
| R-08 | P1 | Mentor-dashboard nav gate | Nav gates `/mentor/dashboard` on `mentor.dashboard.view` **AND** `role: "mentor"` — so a wildcard-granted admin does **not** see it. Verify. |
| R-09 | P1 | Saved views are own-scoped | `crm/saved-views` has **no `@RequirePermission`** (authenticated-only; own-scope enforced in the service). Verify user A cannot read/delete user B's saved views. |
| R-10 | P1 | `feature-flags/evaluate` is auth-only | It has `JwtAuthGuard` but no permission — confirm that's intentional and it leaks no flag metadata a user shouldn't see. |
| R-11 | P1 | Permission-guard default | `PermissionsGuard` **allows any route with no `@RequirePermission`**. Enumerate every such route and confirm each is *intentionally* authenticated-only. |

---

### Suite S — Security & resilience

| ID | Pri | Scenario | Expected |
|---|---|---|---|
| S-01 | P0 | All webhook signatures fail closed | For each of Razorpay / campaigns / video / live-class: missing secret, missing header, wrong signature → **rejected, never processed**. |
| S-02 | P1 | Webhook IP limiter fails **open** | `WebhookIpRateLimitGuard` deliberately fails open on Redis error (HMAC is the primary control). Confirm this is the behaviour and is acceptable. |
| S-03 | P0 | Public limiter fails **closed** | `PublicBookingRateLimiter` must reject on Redis failure. Note the deliberate asymmetry with S-02. |
| S-04 | P0 | Storage signed URLs | `storage/local/*` (dev) auth is the HMAC in the URL. Tamper the key, the op, or the expiry → rejected. Expired URL → rejected. |
| S-05 | P1 | `/metrics` is protected | Guarded by a bearer token compared timing-safe. Without it → 401. |
| S-06 | P1 | Error responses leak nothing | 500s on web/lms/crm render generic pages; API errors are RFC7807 problem+json with no stack traces or internals. |
| S-07 | P1 | Soft-delete opt-out is not exploitable | The `deletedAt` filter opt-out exists for restore/"show deleted" flows. Confirm a normal caller cannot pass a crafted filter to read deleted rows. Note `mentors.service.ts:94` honours `includeDeleted` **only for `all`-scope callers** — verify. |
| S-08 | P1 | Secrets required in production | `CERT_SIGNING_SECRET` unset → **throws in production**, dev fallback only. Env is zod-validated at boot. |

---

### Suite T — Cross-cutting UI quality

| ID | Pri | Scenario | Expected |
|---|---|---|---|
| T-01 | P1 | Loading / empty / error for every async surface | Every list in CRM and LMS has a skeleton, an `*-empty` EmptyState, and an `*-error` EmptyState **with a working "Try again"**. Simulate API-down and walk every route. |
| T-02 | P1 | Confirm dialogs | All 30 destructive actions prompt. Reason-required ones (revoke certificate, hide forum post, reject refund) block submit without a reason. |
| T-03 | P0 | **a11y — WCAG 2.2 AA** | axe clean on the key journeys; keyboard-only completion of login, enroll funnel, lesson playback, assignment submit, and CRM lead conversion; visible focus; labelled controls; **revoked-certificate state is not colour-only**. |
| T-04 | P2 | Responsive / mobile | LMS mobile bottom tabs; web funnel on a phone viewport; CRM at ≥1280px. |
| T-05 | P2 | Known placeholders | Topbar branch switcher and notifications bell in CRM are **hard-disabled placeholders** — expected, not defects. |

---

## Part 4 — Suggested execution order

1. **Bootstrap** — seed, activate passwords, health check (Part 2).
2. **Suite A** (auth) — everything else depends on being able to log in as five roles.
3. **Suite R** (RBAC/scope) — run early. If isolation is broken, the rest of the results are noise.
4. **Suite C** (payment funnel) → **F** (learning) → **G/H** (assignments/assessments) → **I** (certificates) — this is the end-to-end money-to-credential spine.
5. **Suites B, D, E, J, K, L, M, N, O, P, Q** — breadth.
6. **Suites S, T** — security and quality gates before sign-off.

Existing automated coverage to build on: **147 API unit suites / 1996 tests + 24 integration files**,
all currently green. Playwright e2e exists for critical journeys.

---

## Part 5 — Known open items (do not file as new defects)

From `docs/go-live-checklist.md` — the remaining OPEN items are **provisioning, not code**:

- Real vendor credentials (Razorpay live keys, MSG91, WhatsApp, Cloudflare Stream, SES/Resend).
- Antivirus scanning on file uploads.
- k6 load test against staging.
- Phone-OTP SMS delivery is a local no-op stub (go-live blocker B3).
- GST is always CGST+SGST — no IGST / place-of-supply field yet.
- Webhook replay-freshness check is skipped when the payload has no `created_at`.
