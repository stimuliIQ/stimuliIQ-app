# Spec: Phase 5 — Marketing Website (stimuliiq `web`)

> Written by: product-manager · Phase: P5 · Date: 2026-07-02
> Consumed by: db-architect (#1), api-designer (#2), integrations (#3), design-system (#4),
> backend-builder (#5), frontend-builder (#6, #7, #8), qa-engineer (#9), security-reviewer (#10),
> devops (#11), docs-writer (#12).

---

## Why (purpose + which metric it moves)

The marketing website (`apps/web`) is the top of the acquisition funnel. Phase 5 delivers
the full public surface — pages, SEO, lead generation, book-slot, and the
enroll→register→pay funnel — so that a stranger who lands on a search result or paid-campaign
URL can complete a purchase and be handed off to the LMS without any staff involvement.

Primary metrics moved:
- **Lead conversion (visit → lead): target ≥ 6%** (any lead-form submission on the site).
- **Lead → paid: target ≥ 15%** (enroll funnel completion).
- **Lighthouse SEO ≥ 95** on program detail (the defining technical requirement).
- **LCP < 2.0 s, CLS < 0.1, INP < 200 ms** on the public site.

---

## Users and roles affected

| Actor | Surface | P5 change |
|-------|---------|-----------|
| Anonymous visitor | `apps/web` | Entire public site built for the first time |
| Just-registered student (self-service) | `apps/web` enroll funnel + new `POST /public/register` + `POST /public/enroll/*` endpoints | New self-service account + payment path |
| CRM staff (`marketing`, `content` roles) | No new CRM screens in P5 | Programs/coupons already managed via CRM (P1/P2); content roles deferred to CMS phase |
| CRM counsellor | Receives new leads from `POST /public/leads` and bookings from `POST /public/bookings` | Unchanged CRM pipeline; P5 widens intake volume |

**RBAC actions introduced in P5:**
- No new CRM-staff RBAC permissions are added. All new endpoints are either fully
  anonymous public reads or self-service (the authenticated student acts only on their
  own order via `own`-scoped fail-closed authz).

---

## User stories

1. As an anonymous visitor I can browse the programs listing filtered by domain, level,
   duration, mode, and price band so I can find a relevant program.
2. As an anonymous visitor I can open a program detail page and see the curriculum,
   mentors, reviews, price, and EMI options so I can decide whether to enroll.
3. As an anonymous visitor I can submit any lead form (inline, sticky bar, exit-intent
   modal, footer newsletter, career-apply) so a counsellor is assigned to follow up.
4. As an anonymous visitor I can complete a multi-step Book-Free-Slot form so I am
   booked for a counselling session without needing an account.
5. As a visitor I can apply a coupon code on the pricing / checkout page and see the
   discounted amount in paise before paying.
6. As an anonymous visitor I can click "Enroll Now", register with my email, verify my
   phone via OTP, create an order, complete Razorpay checkout, and be redirected to the
   LMS — all in one guided funnel.
7. As a just-registered student I can retry a failed payment using the same idempotency
   key so the system never creates a second order or double-charges me.
8. As any web visitor I can find the program detail page via Google because it emits
   valid `Course` + `Review` + `FAQ` + `Breadcrumb` JSON-LD and is served SSG/ISR.
9. As a visitor in India I can click the WhatsApp float button and be taken to a
   click-to-chat deep link pre-filled with the program context.
10. As a visitor concerned about privacy I can accept or decline marketing cookies via
    the DPDP consent banner, and analytics tags only load after explicit acceptance.

---

## Acceptance criteria (Given / When / Then) — numbered, testable

### A. Lead capture (all form types)

**AC-1** (lead form happy path)
Given an anonymous visitor fills in any lead form (name, phone, email, optional
`program_interest`) with a valid captcha token and submits,
When the `POST /public/leads` request is processed,
Then within 2 seconds the API responds 201; a `leads` row exists in the DB with the
correct `name`, `phone`, `email`, `program_interest_id`, `source`, `utm` JSON (all UTM
params captured from the landing URL), `landing_url`, `referrer`, and `consent` JSON
`{marketing_opt_in, tos_version, timestamp, ip_hash}`; the lead `stage` is `new`; and a
domain event (confirmation event) has been **enqueued** in BullMQ (not sent).

**AC-2** (UTM absent)
Given the landing URL has no UTM parameters,
When a lead form is submitted,
Then `leads.utm` is `{}` (empty object, not null) and `landing_url` is still captured.

**AC-3** (lead form captcha failure)
Given a lead form submission carries an invalid or missing captcha token,
When `POST /public/leads` is called,
Then the API responds 422 before any DB write occurs.

**AC-4** (lead form rate limit)
Given the same IP submits `POST /public/leads` more than the configured fixed-window
limit,
When the limit is exceeded,
Then subsequent requests within the window return 429 with a `Retry-After` header; no
additional `leads` row is created for those requests.

**AC-5** (consent declined — marketing opt-out)
Given a visitor submits a lead form with `marketing_opt_in: false`,
When the lead is created,
Then `leads.consent.marketing_opt_in` is `false` and the lead is still created; the
confirmation event is enqueued but has `marketing_opt_in: false` recorded in its payload
so P6 fanout can honour the preference.

### B. Book-Free-Slot funnel

**AC-6** (booking happy path)
Given a visitor completes the multi-step Book-Free-Slot form (program → date/time →
name/phone/email → confirm) with a valid captcha,
When the `POST /public/bookings` request is processed (reused P2 endpoint, unchanged),
Then a `bookings` row is created with `status: requested`, linked to a `leads` row
(created or matched by phone), with `program_id`, `slot_at`, `source`, and `consent`
JSON `{marketing_opt_in, tos_version, timestamp, ip_hash}` captured; a confirmation
event is enqueued (not sent); the API responds 201.

**AC-7** (booking full slot)
Given a visitor attempts to book a slot that has reached capacity,
When `POST /public/bookings` is processed,
Then the API responds 409 with a generic "slot unavailable" message (not revealing how
many slots remain) and no `bookings` row is created.

**AC-8** (duplicate phone booking deduplication)
Given a visitor submits a booking with a phone number that already exists as a `leads`
row,
When `POST /public/bookings` is processed,
Then a new `bookings` row is linked to the existing `leads` row (no duplicate lead
created); the response is 201.

### C. Coupon validation

**AC-9** (valid coupon)
Given an anonymous visitor submits a valid, active, non-expired coupon code and a
`program_id` to `POST /public/coupons/validate`,
When the request is processed,
Then the API responds 200 with `{original_paise, discount_paise, final_paise, type}`;
the coupon's internal `id`, `max_uses`, `used` count, `program_scope` internal detail,
and any other non-display fields are NOT present in the response.

**AC-10** (expired or invalid coupon)
Given a visitor submits an expired, inactive, or non-existent coupon code,
When `POST /public/coupons/validate` is called,
Then the API responds 422 with a generic "invalid or expired coupon" message; the
response NEVER reveals whether the code exists but is inactive vs. was never created.

**AC-11** (coupon rate limit)
Given the same IP calls `POST /public/coupons/validate` more than the configured rate
limit,
When the limit is exceeded,
Then subsequent requests within the window return 429. No coupon enumeration is possible
through timing differences.

### D. Registration (`POST /public/register`)

**AC-12** (registration happy path)
Given an anonymous visitor submits a valid registration payload
(`name`, `email`, `password`, `phone`, `tos_version`, `marketing_opt_in`, `captcha_token`),
When `POST /public/register` is called,
Then a `users` row and a `student_profiles` row are created; a JWT access token and
rotating refresh token are issued in the response; the consent payload
`{marketing_opt_in, tos_version, timestamp, ip_hash}` is stored; and the password is
hashed with argon2id.

**AC-13** (registration — existing email — no enumeration)
Given a visitor submits `POST /public/register` with an email that already exists as a
`users` row,
When the request is processed,
Then the API responds with the **same HTTP status and generic error message** as for a
successful registration prompt (i.e., the response MUST NOT reveal that the email is
already registered); no duplicate `users` row is created.

**AC-14** (registration — captcha failure)
Given a registration payload carries an invalid or missing captcha token,
When `POST /public/register` is called,
Then the API responds 422 before any DB write; no `users` row is created.

**AC-15** (registration — rate limit)
Given the same IP submits `POST /public/register` more than the configured fixed-window
limit,
When the limit is exceeded,
Then subsequent requests within the window return 429 with `Retry-After`; no additional
`users` row is created.

### E. Enroll → Order → Checkout → Verify funnel (idempotency + payment integrity)

**AC-16** (successful payment — exactly one enrollment)
Given a just-registered student creates an order via `POST /public/enroll/orders`
(with a client-generated `idempotency_key`), completes Razorpay checkout, and calls
`POST /public/enroll/verify` with the valid Razorpay signature,
When `verifyPayment` runs in `CommerceService` (the P2 engine, reused unchanged),
Then exactly one `orders` row (status: `paid`), one `payments` row
(status: `captured`, `signature_verified: true`), one `invoices` row
(status: `issued`), and exactly one `enrollments` row (status: `active`) exist for that
student + program combination; a receipt event is enqueued; the API responds 200.

**AC-17** (idempotent order — same `idempotency_key` called twice)
Given a student calls `POST /public/enroll/orders` twice with the **same
`idempotency_key`**,
When both requests are processed,
Then the API responds 200/201 on the first call and 200 with the existing `orders` row
on the second; only ONE `orders` row exists; no duplicate payment or enrollment is
created.

**AC-18** (double-click on verify — replay protection)
Given a student calls `POST /public/enroll/verify` more than once with the same
Razorpay `razorpay_payment_id`,
When the duplicate verify request is processed,
Then `payments.provider_payment_id` uniqueness constraint makes the second call a
no-op; the response is 200 (idempotent); no second `enrollments` row or `payments` row
is created; no second charge occurs.

**AC-19** (failed payment — no enrollment, retry path)
Given a student's Razorpay payment fails (e.g., card declined),
When the failure reaches the site,
Then no `enrollments` row is created; no `payments` row with `status: captured` exists;
the order `status` remains `created` or is set to `failed` per the P2 engine; the UI
shows an error state with a "Retry" button that reuses the same `idempotency_key`; a
retry checkout call on the same order does NOT create a second order row.

**AC-20** (forged / replayed Razorpay signature — no enrollment)
Given a POST to `POST /public/enroll/verify` carries an invalid or replayed
`razorpay_signature`,
When the request is processed,
Then the `PaymentProvider.verifySignature` check fails; the API responds 400; no
`payments` row is updated to `captured`; no `enrollments` row is created.

**AC-21** (amount server-derived — no client amount accepted)
Given a client submits `POST /public/enroll/orders` with a tampered `amount_paise`
field,
When `CommerceService.createOrder` runs,
Then the order amount is derived exclusively from `programs.price_paise` and the server-
computed coupon discount; the client-supplied amount is stripped by `.strict()` zod
validation before the service is called; the stored `orders.amount_paise` matches the
server-derived value.

**AC-22** (funnel IDOR — student cannot transact on another's order)
Given student A has an `orders` row and student B is authenticated,
When student B calls `POST /public/enroll/checkout` or `POST /public/enroll/verify`
with student A's `order_id`,
Then the API responds 404 (no information disclosure about the order's existence); no
payment or enrollment is created for student B or student A as a result of this call.

**AC-23** (LMS handoff on enrollment success)
Given a successful payment produces an `enrollments` row,
When the funnel verify endpoint returns 200,
Then the response body includes a `lms_redirect_url` or equivalent handoff token/URL so
the web funnel can redirect the newly enrolled student to the LMS without a separate
login step.

### F. Public program catalog (draft/non-public protection)

**AC-24** (published + `is_public` programs returned in listing)
Given at least one `programs` row has `status: published` AND `is_public: true`,
When `GET /public/programs` is called (with no filters),
Then the response includes that program with ONLY the public-projection fields (see §
"Public-Projection Allowlist" below); no draft or non-`is_public` program appears.

**AC-25** (draft program slug — 404)
Given a `programs` row has `status: draft` OR `is_public: false`,
When a visitor navigates to `/programs/:slug` for that program (or calls
`GET /public/programs/:slug`),
Then the API responds 404; the response body contains no internal IDs, no draft content,
no indication that a program with that slug exists; the web page renders a standard 404.

**AC-26** (forbidden fields absent from public responses)
Given any call to `GET /public/programs` or `GET /public/programs/:slug`,
When the response is inspected at the API level,
Then NONE of the forbidden fields listed in the "Public-Projection Allowlist" section
below are present in the response at any nesting level.

**AC-27** (anonymous read — no PII, no staff notes, no storage keys)
Given an unauthenticated `GET /public/programs/:slug`,
When the response is parsed,
Then the payload contains no fields that are `storage_key`, `provider_asset_id`,
`answer_key`, `cost` (margin/internal), `notes`, or any `users`/`student_profiles` PII
beyond mentor public bio fields.

### G. SEO and structured data

**AC-28** (program detail JSON-LD — Course schema)
Given a program detail page at `/programs/:slug`,
When the rendered HTML is parsed,
Then it contains a `<script type="application/ld+json">` block with a valid
`@type: "Course"` object including `name`, `description`, `provider`, `url`, and
`offers.price` fields; the JSON-LD does NOT contain a `</script>` literal (it is
escaped per P4 L-1 fix).

**AC-29** (program detail JSON-LD — Review, FAQ, Breadcrumb)
Given a program detail page with at least one review and at least one FAQ entry,
When the rendered HTML is parsed,
Then the page also contains `@type: "Review"` (or `AggregateRating`), `@type: "FAQPage"`,
and `@type: "BreadcrumbList"` JSON-LD blocks in the same or separate `<script>` tags.

**AC-30** (Lighthouse SEO score)
Given a program detail page served in production (or a Lighthouse CI run against the
preview deploy),
When Lighthouse runs with the SEO auditor,
Then the SEO score is ≥ 95.

**AC-31** (sitemap and robots)
Given the deployed `apps/web` instance,
When a crawler fetches `/sitemap.xml`,
Then the response is a valid XML sitemap containing at least one URL for each
`is_public: true, status: published` program; the `Last-Modified` date is recent.
When a crawler fetches `/robots.txt`,
Then the response explicitly allows crawling of `/programs/*` and references the
sitemap URL.

**AC-32** (canonical + OG meta on program detail)
Given a program detail page,
When the `<head>` is inspected,
Then a `<link rel="canonical">` tag points to the canonical URL for that page, and
`og:title`, `og:description`, `og:image`, and `og:url` meta tags are present and
non-empty.

**AC-33** (JSON-LD script-breakout escaping — P4 L-1 resolved)
Given any page that embeds JSON-LD (program detail, blog article, verify, homepage),
When the `seo_title`, `seo_description`, or any user-controlled string is embedded in
a `<script type="application/ld+json">` block,
Then the shared JSON-LD helper has replaced any `</script>` sequence with `<\/script>`
before embedding; the page HTML parses without a script-breakout at the W3C validator.

### H. Consent / DPDP

**AC-34** (consent banner — analytics gating)
Given a first-time visitor arrives at any page,
When the DPDP consent banner is rendered,
Then no analytics or marketing pixel scripts have executed; they are deferred until the
visitor explicitly accepts analytics cookies.

**AC-35** (consent banner — accept)
Given a visitor clicks "Accept" on the DPDP consent banner,
When the consent is recorded (localStorage + optional server-side),
Then the `AnalyticsProvider` client-side loader fires; the banner is dismissed; on
subsequent page loads the banner does not reappear.

**AC-36** (consent banner — decline)
Given a visitor clicks "Decline" or closes the banner without accepting,
When the interaction is recorded,
Then no analytics or marketing pixel fires; all page functionality remains available;
the banner does not reappear with the declined state stored.

**AC-37** (consent version on form submissions)
Given any public form (lead, booking, registration) is submitted,
When the request body is processed by the API,
Then `consent.tos_version` matches the current published `TOS_VERSION` env/config value,
`consent.timestamp` is a UTC ISO-8601 string within 60 seconds of server time,
and `consent.ip_hash` is the SHA-256 hash of the submitting IP (not the raw IP).

### I. Accessibility

**AC-38** (keyboard navigation — header mega-menu)
Given a keyboard-only user tabs to the "Programs" nav item and presses Enter,
When the mega-menu opens,
Then all links within the mega-menu are reachable via Tab/Arrow keys; pressing Escape
closes the menu and returns focus to the trigger; the menu has `role="dialog"` or
equivalent ARIA pattern.

**AC-39** (multi-step form — focus management)
Given a user advances to the next step of the Book-Free-Slot or registration funnel,
When the step changes,
Then focus is programmatically moved to the first focusable element of the new step or
to a step-heading; a screen-reader announcement (via `aria-live` or focus) communicates
the new step name and number.

**AC-40** (axe zero critical/serious violations)
Given any new `@repo/ui` marketing primitive (header, hero, program card, multi-step
form, consent banner, pricing table, FAQ accordion),
When run through axe-core in a unit or integration test,
Then there are zero critical or serious accessibility violations.

### J. Security surface (public write endpoints)

**AC-41** (no secret in client bundle)
Given `apps/web` is built for production,
When the JS bundle is inspected (source map or build artefact analysis),
Then `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `CAPTCHA_SECRET_KEY` are
ABSENT from all client-side bundles; only the public `RAZORPAY_KEY_ID` (prefixed
`NEXT_PUBLIC_`) and `CAPTCHA_SITE_KEY` (prefixed `NEXT_PUBLIC_`) are present.

**AC-42** (honeypot field honored)
Given any public write form (lead, booking, registration) renders a honeypot field
(`display: none` via CSS, not `type="hidden"`),
When a bot submission populates that field,
Then the API rejects the request with 422 before any DB write.

**AC-43** (rate limit fail-closed on Redis error)
Given the Redis instance backing the `PublicBookingRateLimiter` is unreachable,
When any public write endpoint is called,
Then requests are **rejected** (fail-closed), not allowed through; the error is logged
without including the raw client IP.

**AC-44** (captcha fail-closed in production)
Given `CAPTCHA_PROVIDER` env var is set to anything other than `noop` and
`CAPTCHA_SECRET_KEY` is absent or empty,
When any captcha-gated public write endpoint is called,
Then all requests are rejected with 503 or 422 (fail-closed); no writes proceed.

**AC-45** (CSP and security headers on `apps/web`)
Given the deployed `apps/web` instance,
When an HTTP response for any page is inspected,
Then the following headers are present:
- `Content-Security-Policy` (at minimum: `default-src 'self'`; `script-src` allows
  Razorpay checkout.js and the selected analytics domain; `frame-ancestors 'none'`).
- `Strict-Transport-Security` (max-age ≥ 31536000; includeSubDomains).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.

---

## Edge cases and error states

| Scenario | Expected system behaviour |
|----------|--------------------------|
| **Double-click "Pay"** | Client disables the Pay button on first click; if a second `POST /public/enroll/verify` arrives, the `provider_payment_id` unique constraint makes it a no-op (200 idempotent); no second enrollment. |
| **Payment failure + retry** | Order status becomes `failed`; UI shows retry CTA; retry checkout re-uses the same `idempotency_key` so `POST /public/enroll/orders` returns the existing order; a new Razorpay checkout order is created against the same internal order; on successful retry, exactly one enrollment is created. |
| **Coupon expired mid-session** | A coupon that was valid when validated but expires before checkout completes returns a 422 at `POST /public/enroll/orders`; the funnel shows an inline error "coupon expired, please remove it to continue." |
| **Coupon not applicable to selected program** | `POST /public/coupons/validate` returns 422 with a generic message; `CommerceService` enforces `program_scope` server-side; client-side price cannot be manually overridden. |
| **Register with existing email (enumeration prevention)** | `POST /public/register` returns the same HTTP status and generic-worded message regardless of whether the email is taken or free (AC-13). |
| **Booking a full slot** | `POST /public/bookings` returns 409; no booking row created; message is generic (AC-7). |
| **Draft program slug guessed in URL** | `GET /public/programs/:slug` returns 404; the Next.js page renders the 404 template; no draft content, no program metadata, no OG tags for the draft content leak into the response (AC-25). |
| **UTM parameters absent** | Lead and booking rows created with `utm: {}` and `landing_url` still captured from the request origin header (AC-2). |
| **Consent declined** | All forms still submit (consent is a preference, not a gate for the form); `consent.marketing_opt_in: false` is recorded; no analytics fires (AC-36, AC-5). |
| **OTP expiry during registration** | If the OTP used to verify phone during `POST /public/register` has expired, the API responds 422; the registration does not complete; no `users` row is created; the user is prompted to request a new OTP. |
| **User navigates back during payment** | The `idempotency_key` stored in session/state is preserved; re-opening checkout uses the existing order (idempotent `POST /public/enroll/orders`); if payment was already captured, the verify endpoint returns the existing enrollment (idempotent). |
| **Webhook arrives before `POST /public/enroll/verify`** | The P2 webhook handler (`POST /commerce/payments/webhook`, reused unchanged) processes the event first; when `POST /public/enroll/verify` arrives later, `provider_payment_id` is already unique so it is a no-op; the enrollment already exists and the response is 200. |
| **Non-`is_public` program used in booking** | `POST /public/bookings` accepts `program_id`; the endpoint does NOT validate `is_public` for bookings (a counsellor may book a session for a not-yet-published program); however `GET /public/programs/:slug` returns 404 for it. |
| **Performance budget miss on low-end mobile** | Program detail page is SSG/ISR; images are AVIF/WebP with `sizes` attribute; initial JS budget ≤ 150 KB; third-party scripts deferred post-consent; skeleton loaders shown during hydration. |

---

## Out of scope (explicit)

These are **locked gate decisions** that must not be revisited during P5. Any change
requires an ADR and re-planning.

| Item | Decision | Deferred to |
|------|----------|-------------|
| Headless CMS / CRM content-authoring UI | Marketing copy, blog, faculty bios, testimonials, partners, FAQ, gallery, and career roles ship as MDX/typed-content in `apps/web`. Programs/pricing/coupons are live from the DB (CRM-managed P1/P2). | CMS phase (P6+) |
| Blog authoring UI / editorial workflow | Blog articles render from MDX files in the repo (author, categories, related, `Article`/`BlogPosting` JSON-LD). No admin authoring UI, no comments, no CMS. | CMS phase |
| i18n / multi-language | English only. Content layer is structured for i18n but no locale routing. | P8 |
| A/B testing framework / experiment runtime | Landing pages are A/B-ready in structure (single CTA, isolated layout) but no experiment runtime is wired. | P8 |
| Personalization by traffic source | P8. | P8 |
| Chatbot lead-qualifier | P8. | P8 |
| Email / WhatsApp / SMS sending | Confirmations only enqueue the domain event. Actual fanout (MailProvider, WhatsAppProvider, SmsProvider) is P6. WhatsApp on the site = click-to-chat deep link only. | P6 |
| New EMI / dunning mechanics | P5 exposes the existing P2 EMI display and engine. No new dunning flows. | Later |
| New coupon types or payment providers | P5 exposes existing engine only. | Later |
| True bundle-order product | Bundles/tracks display on pricing but resolve to existing per-program orders. A true bundle-order product (one order covering multiple programs) is not built. | Later phase |
| CRM content roles / marketing campaign tooling | P6. | P6 |
| Programmatic SEO per program × city | `docs/01 §7.9` mentions "programmatic SEO pages per program × city." This is not built in P5 (no city-level pages). | P7 |
| Global search across programs + blog | `docs/01 §7.1` mentions global search. This requires full-text indexing (tsvector / Meilisearch noted in `docs/05 §4`). Deferred. | P7 |
| Real load test / perf hardening depth | P5 sets Lighthouse + performance budgets in CI. Full load test is P7. | P7 |
| College B2B entry page | `docs/01 §10` "For Colleges" nav item. Placeholder page only in P5; B2B portal is P8. | P8 |

---

## Locked scope decisions (task #0 gate, confirmed against `docs/01 §22`)

The following decisions from `docs/plans/phase-5.md §7` (Q1–Q7) are **locked** for P5.
Any implementation that deviates from these requires an ADR and orchestrator re-plan.

| Decision | Default locked in P5 | Justification |
|----------|----------------------|---------------|
| **Q1 — Content approach** | MDX/typed-content in `apps/web` for marketing/blog/trust copy; live DB for programs/pricing/coupons | CMS builds are phase-scope killers; MDX is SSG-perfect, Git-auditable, and investor-grade for launch |
| **Q2 — Blog** | MDX blog renders with frontmatter (author, categories, related, `Article`/`BlogPosting` JSON-LD); NO authoring UI | Authoring UI requires CRM extension + auth surface (deferred) |
| **Q3 — i18n / A/B / personalization / chatbot** | All OUT. Landing pages A/B-ready in structure only | P8 gate, would require runtime infrastructure not in scope |
| **Q4 — Confirmations** | Enqueue-only (BullMQ domain event row). WhatsApp on site = click-to-chat deep link. Email/WhatsApp send = P6 | P6 owns all notification fanout |
| **Q5 — Self-service registration** | `POST /public/register` ships (argon2id, consent, OTP-verify reuse) | Required for the enroll funnel; no other way for a visitor to self-create an account |
| **Q6 — Consent modeling** | `consent` Json? column on `leads` and `bookings` (no new `consents` table) | Minimal additional infra; a `consents` table is a CMS-phase / DPDP-hardening follow-up |
| **Q7 — Bundles / tracks** | Display-only on pricing page; resolve to existing per-program orders | True bundle-order product requires commerce engine extension (later phase) |

---

## PRD conflicts found

The following items in `docs/01-prd-website.md` conflict with P5 gate decisions. Each
is recorded, resolved, and tracked.

| Conflict ID | PRD section | PRD says | P5 gate decision | Resolution |
|-------------|-------------|----------|-----------------|------------|
| CONFLICT-P5-1 | `docs/01 §9` | "Content (blog, programs, testimonials, partners, pages, landing pages, coupons) is managed from the CRM by `marketing`/`content` roles via a headless content API." | P5 does NOT build a CMS or CRM content-authoring UI. Marketing copy ships as MDX. Programs/coupons remain CRM-managed (P1/P2 surfaces). | MDX for launch; headless content API + CRM content roles tracked as CMS-phase follow-up. Record in ADR. |
| CONFLICT-P5-2 | `docs/01 §7.7`, `docs/01 §22` | "creates CRM lead + calendar event + WhatsApp/email confirmation" (book-slot); "triggers a WhatsApp/email confirmation" (lead form AC in §22). | P5 only **enqueues** the confirmation event. WhatsApp/email fanout is P6. | AC-1 and AC-6 in this spec replace the §22 acceptance criteria wording with "enqueued (not sent)". Record in spec and `docs/phase-5-followups.md`. |
| CONFLICT-P5-3 | `docs/01 §7.9` | "programmatic SEO pages per program × city" | Not built in P5. Program detail pages at `/programs/:slug` only. | Deferred to P7 (requires city data model + URL strategy). |
| CONFLICT-P5-4 | `docs/01 §7.1` | "Global search (programs + blog) with filters" | Not built in P5. The header renders a search trigger but the full-text search implementation is deferred. | Deferred to P7 (requires tsvector or Meilisearch integration, `docs/05 §4`). |
| CONFLICT-P5-5 | `docs/01 §7.8` | "Welcome + LMS credentials → redirect to LMS" | P5 delivers the redirect/handoff CTA. Actual LMS credentials email is a P6 notification. The redirect itself (LMS URL from enrollment response) is in scope. | Split: redirect = P5; email = P6. |

---

## Public-projection allowlist

This allowlist is the authoritative contract for `db-architect` (task #1) and
`backend-builder` (task #5). Deviation from this list is a security defect.

### Program list projection (`GET /public/programs`)

**ALLOWED on each item in the list response:**

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `programs.id` | Needed to construct the enroll URL; exposed as opaque ID |
| `slug` | `programs.slug` | SEO URL key; unique per tenant |
| `title` | `programs.title` | |
| `domain` | `programs.domain` | Filter facet |
| `level` | `programs.level` | Filter facet |
| `mode` | `programs.mode` | `live\|recorded\|hybrid` |
| `duration_weeks` | `programs.duration_weeks` | |
| `card_summary` | `programs.card_summary` | Short marketing hook (≤ 160 chars) |
| `price_paise` | `programs.price_paise` | Raw price; client formats as ₹ |
| `emi_display` | `programs.emi` (derived display field only) | Only the human-readable EMI string, not the full `emi` JSON (which may contain internal plan ids) |
| `rating_avg` | `programs.rating_avg` | Nullable; omit if null |
| `rating_count` | `programs.rating_count` | Nullable; omit if null |
| `og_image_url` | Signed CDN URL derived from `programs.og_image_key` | Backend mints the CDN URL; the raw `og_image_key` (storage path) is NEVER exposed |

**FORBIDDEN on the list projection:**

- `status` (draft/internal)
- `is_public` (internal flag)
- `seo_title`, `seo_description` (used only on the detail page)
- Full `emi` JSON (may contain internal plan identifiers)
- `cost`, `margin`, `notes`, any internal admin annotation
- `tenant_id`
- `deleted_at`, `updated_at`, `created_at`
- `og_image_key` (raw storage path)
- Any module, lesson, video, or resource data
- Any PII (no user/faculty data on the list)

### Program detail projection (`GET /public/programs/:slug`)

**ALLOWED on the detail response:**

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `programs.id` | Needed for order creation |
| `slug` | `programs.slug` | |
| `title` | `programs.title` | |
| `domain`, `level`, `mode`, `duration_weeks` | `programs.*` | |
| `card_summary` | `programs.card_summary` | |
| `seo_title` | `programs.seo_title` | Page `<title>` |
| `seo_description` | `programs.seo_description` | Meta description |
| `og_image_url` | CDN URL minted from `programs.og_image_key` | Raw key NEVER exposed |
| `price_paise` | `programs.price_paise` | |
| `emi_display` | derived from `programs.emi` | Human-readable only; full JSON not exposed |
| `rating_avg`, `rating_count` | `programs.rating_avg`, `programs.rating_count` | |
| `outcomes` | `programs.outcomes` | Json array of outcome strings |
| **Curriculum outline** | `modules` + `lessons` (restricted) | Module titles, lesson titles, `is_preview` flag ONLY. Lesson `content`, `video.provider_asset_id`, `resources.storage_key` are FORBIDDEN. |
| `mentor_bios` | `faculty_profiles` (restricted) | Public bio fields only: `name`, `avatar_url` (CDN-minted, never `storage_key`), `expertise` (display list), `company`, `title`. `user_id`, `email`, `phone`, `branch_id`, `rating` (internal), and any other profile internals are FORBIDDEN. |
| `reviews_summary` | Aggregated from reviews/ratings | Count + avg + up to N most-helpful review excerpts (reviewer first name + college only; no email, no phone, no `student_id`) |
| FAQ entries | MDX content or DB FAQ rows | Question + answer text only |
| Related programs | List of up to 4 `id`+`slug`+`title`+`card_summary`+`price_paise` from other `is_public` programs | Same forbidden-field rules apply |

**FORBIDDEN on the detail projection:**

- `status`, `is_public` (internal flags)
- `og_image_key` (raw storage path)
- `emi` JSON in full (only `emi_display` string is safe)
- `cost`, `margin`, `notes`, any internal admin annotation
- `tenant_id`, `deleted_at`
- Lesson `content` field (full lesson body/video embed — behind enrollment wall in LMS)
- `lessons.video.provider_asset_id` (signed HLS keys — behind enrollment wall)
- `lessons.resources` any `storage_key` (download URLs — behind enrollment wall)
- `assessment_questions.answer_key` (always server-only, ADR-0030)
- Mentor `user_id`, `email`, `phone`, `branch_id`, internal `faculty_profiles.rating`
- Reviewer `email`, `phone`, `student_id`, `user_id`, full name (first name + college only)
- Any `orders`, `payments`, `enrollments`, `invoices`, or other commerce data
- `certificate_templates` or `certificates` data (the detail page shows a certificate *preview image* only — a static or public OG image; no `storage_key`)

### Coupon validate response

**ALLOWED:** `{original_paise, discount_paise, final_paise, type ('pct'|'flat'), display_code}`

**FORBIDDEN:** `id`, `max_uses`, `used`, `valid_from`, `valid_to`, `program_scope`, `status`, `tenant_id`, any internal identifier.

---

## Consent / DPDP capture requirement

### What must be recorded

Every public form submission (lead capture, booking, registration) MUST persist the
following consent object before the API responds 2xx:

```
{
  marketing_opt_in: boolean,   // explicit checkbox value from the form
  tos_version: string,         // current TOS_VERSION from env (e.g. "v1.0")
  timestamp: string,           // UTC ISO-8601, server-recorded at receipt time
  ip_hash: string              // SHA-256(client_ip) — hashed, not raw
}
```

### Where it is stored

- `leads.consent` — Json? column (additive migration, nullable/backward-compatible).
- `bookings.consent` — Json? column (additive migration, nullable/backward-compatible).
- For `POST /public/register` — the `consent` object is stored on the `users` row or
  a related profile column (db-architect confirms exact column; the data must be
  persisted before the `users` row is considered complete).

The raw IP address MUST NOT be stored anywhere; only `ip_hash` is persisted. This
satisfies DPDP PII-minimization.

### Visible UX rules

1. **Consent banner:** shown on first visit to any `apps/web` page. Contains two
   distinct actions: "Accept all" and "Decline / Essential only." Closing without acting
   is treated as declined. The banner must be keyboard-operable, have `role="dialog"`,
   and trap focus while open.
2. **Form consent checkboxes:** every lead form, booking form, and registration form
   MUST include:
   - A mandatory, pre-ticked "I agree to the Terms of Service and Privacy Policy"
     checkbox with a visible link to each document. The form MUST NOT submit if this
     is unchecked.
   - An optional, un-ticked "I consent to receive marketing communications via
     WhatsApp/email/SMS" checkbox. The form submits regardless of this value.
3. **Analytics gate:** the `AnalyticsProvider` client-side loader MUST NOT fire until
   the consent banner "Accept all" action is recorded in the visitor's browser state.
   This applies to GA4, Meta pixel, or any other analytics/marketing tag.
4. **TOS version pinning:** `TOS_VERSION` is an env var (e.g., `v1.0`). When the TOS
   is updated, the version string changes; all future form submissions record the new
   version. This allows the business to prove which version a user consented to.

---

## Data / permissions impact (entities, RBAC actions)

### New columns (additive migrations)

| Table | New columns | Nullable | Default | Notes |
|-------|-------------|----------|---------|-------|
| `programs` | `slug` (String, uniq per tenant), `seo_title` (String?), `seo_description` (String?), `og_image_key` (String?), `card_summary` (String?), `outcomes` (Json?), `rating_avg` (Int?), `rating_count` (Int?), `is_public` (Boolean) | All nullable except `is_public` | `is_public: false` | P1–P4 rows get `is_public: false` by default; `slug` backfilled from title for seeded rows |
| `leads` | `landing_url` (String?), `referrer` (String?), `gclid` (String?), `fbclid` (String?), `consent` (Json?) | All nullable | `null` | P1–P4 rows valid with nulls |
| `bookings` | `consent` (Json?) | Nullable | `null` | P1–P2 rows valid with null |

### No new tables in P5

Per Q6 locked decision, consent is stored as a Json column; no new `consents` table.
No `testimonials`, `partners`, `pages`, `posts`, `faq_entries`, or `blog_posts` tables
(MDX content).

### RBAC actions

No new CRM RBAC permissions. All new endpoints are either:
- **Fully anonymous** (public reads + lead/booking writes) — no auth required.
- **Self-service own-scoped** (`POST /public/register` issues a fresh student session;
  `POST /public/enroll/orders|checkout|verify` require that session and enforce
  `own`-scoped fail-closed: student can only act on their own order → IDOR = 404).

The `own` scope already exists in the RBAC model (role_permissions `scope` field).
The public funnel does not use the `role_permissions` table; instead the backend-builder
implements a direct service-layer ownership check: `order.studentId === req.user.id`.

---

## Dependencies (which agents / modules)

| Task # | Agent | Depends on this spec for |
|--------|-------|--------------------------|
| #1 | db-architect | Additive column list (§ "Data / permissions impact") + projection allowlist (fields that must exist to be projected) |
| #2 | api-designer | Public-projection allowlist (defines `PublicProgramSummary` and `PublicProgramDetail` DTO shapes) + consent object schema + funnel DTO shapes |
| #3 | integrations | Consent-gated analytics rule (AC-34–36) + captcha fail-closed rule (AC-44) |
| #4 | design-system | Lead form consent checkbox rules (§ "Consent / DPDP capture" UX rules) + multi-step funnel a11y requirements (AC-38–40) |
| #5 | backend-builder | Full public-projection allowlist (forbidden fields must never be SELECTed), all funnel acceptance criteria (AC-1 through AC-45), rate-limit + captcha + honeypot rules |
| #6, #7, #8 | frontend-builder | AC-28–33 (SEO / JSON-LD), AC-34–37 (consent UX), AC-38–40 (a11y), AC-41 (no secret in bundle), edge cases table |
| #9 | qa-engineer | Full AC list as the test assertion surface; edge cases as negative test cases |
| #10 | security-reviewer | Forbidden-field list (AC-26–27), AC-20–22 (payment integrity), AC-13 (enumeration), AC-41–45 (secret / headers / honeypot / rate-limit) |
| #11 | devops | AC-30 (Lighthouse CI gate ≥ 95), AC-45 (security headers), AC-31 (sitemap reachable in preview) |
