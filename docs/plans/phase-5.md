# Plan: Phase 5 — Marketing Website + registration/payment funnel ("P5")

> Scope boundary (`CLAUDE.md §6`): **"P5 Website: marketing pages, SEO, book-slot, payment +
> registration funnel."** This plan delivers exactly that, end-to-end (PM gate → public-API
> surface → contracts → backend public endpoints → integrations (captcha/analytics behind
> interfaces) → design-system marketing primitives → `apps/web` marketing pages + funnel →
> tests → security → docs) and **does not** plan ahead into P6 (notifications / WhatsApp /
> email *sending* / campaigns / gamification / forum — the website's lead/booking confirmations
> only **enqueue** the P6-owned events, they do not send) or P7 (analytics dashboards / A/B
> framework / perf hardening depth / load test).
>
> **The web app is overwhelmingly a CONSUMER of already-shipped APIs.** P1 shipped
> courses/programs + enrollments; P2 shipped leads, Razorpay commerce (orders/checkout/
> verify/webhook), coupons, invoices, the order→enrollment atomic path, and the public
> `POST /public/bookings` intake; P4 shipped the public `GET /verify/:certUid` page. The P5
> backend work is therefore **narrow and deliberate**: a small set of NEW *public, read-mostly,
> unauthenticated (or self-service-authenticated)* endpoints that expose the existing catalog +
> funnel to anonymous visitors WITHOUT widening the CRM-staff-scoped surface. Every write reuses
> the P2 engine (idempotency, `PaymentProvider`, order→enrollment atomicity, ledger) rather than
> reinventing it.
>
> Each task DoD references `CLAUDE.md §4` + the relevant `docs/01 §7.x`, `docs/04 §2.x`,
> `docs/06 §1/§2`, `docs/07`, and `docs/01 §22` acceptance criteria.

---

## P4 verification (done before planning — report gaps, no rework)

**P4 (Learning Depth) is GREEN and gates open to P5.** Confirmed from `docs/plans/phase-4.md`
and `docs/phase-4-followups.md`: **609 unit + 193 integration tests** (1 skipped), 12 suites;
CI runs `install → typecheck → lint → unit → integration → build → e2e`. Wave-7 security review
returned **Conditional GO → GO** after H-1 (submission storage-key IDOR) and M-1 (verify 429
`Retry-After`) fixes; **no Critical/High left open**. ADRs 0027–0033 recorded. The full
critical journey (login → submit → take → issue → download → verify → revoke) is proven at the
API-integration level.

**Current `apps/web` state (verified by Glob/Grep):** a bare **P0 shell** (`app/layout.tsx`,
`app/page.tsx` = "Phase 0 scaffold"), the `/account` page (`GET /me` demo), and the **P4 public
`app/verify/[certId]` page** with its `verify-panel`. **Nearly the entire marketing site is
unbuilt** — no homepage, no programs listing, no program detail, no pricing, no book-slot funnel,
no registration/pay funnel, no SEO system (no `sitemap.ts`/`robots.ts`/JSON-LD beyond the one
verify page), no header/footer/nav, no lead forms. P5 builds all of it.

**Backend public/consumable surface — verified (this is the crux of the reuse analysis):**
- **`POST /public/bookings`** — EXISTS (unauthenticated, `PublicBookingsController`, Redis
  fixed-window rate-limited per IP, CSRF-excluded, `.strict()` over-post stripping, server-resolved
  tenant, ADR-0019). **Reused as-is** for the Book-Free-Slot funnel intake.
- **`POST /commerce/payments/webhook`** — EXISTS (unauthenticated, HMAC-verified, idempotent,
  ADR-0013/0014). **Reused as-is**; the funnel relies on it for the async payment→enrollment path.
- **`GET /verify/:certUid`** — EXISTS (public, rate-limited, minimal payload; P4). Already consumed
  by the one existing `web` page; not re-touched here except to fold it into global nav/footer.
- **Courses/programs (`GET /crm/courses`, `/crm/courses/:id`, `/:id/curriculum`)** — EXIST but are
  **CRM-staff-scoped** (`JwtAuthGuard` + `courses.view`). **NOT publicly consumable.** → P5 needs a
  NEW **public catalog + program-detail read** surface (SEO-first, published-only, no draft leakage).
- **Commerce order/checkout/verify (`POST /commerce/orders`, `/orders/:id/pay`,
  `/payments/verify`, `/coupons/validate`)** — EXIST but are **CRM-staff-permissioned**
  (`orders.create`/`payments.create`/`coupons.view` — Finance/Owner/Admin). A public visitor
  **cannot** self-serve these. → P5 needs a NEW **public/self-service funnel write** surface that
  reuses the *same CommerceService engine* (idempotency, `PaymentProvider`, order→enrollment
  atomicity, coupon paise math, ledger) under a public-appropriate authz model.
- **Leads** — only `crm/leads` exists (authenticated). There is **NO public lead-capture
  endpoint** (public intake today = bookings only). → P5 needs a NEW **public lead-capture**
  endpoint (the site's inline/exit-intent/sticky lead forms feed the CRM pipeline via it).
- **Auth** — `login/refresh/logout/otp/request/otp/verify` EXIST; there is **NO public
  self-registration/signup**. Student accounts today are created CRM-side (P1) or via
  lead-conversion (P2). → P5 needs a NEW **public registration/account-creation** step for the
  enroll→pay flow (`docs/01 §7.8`: "Enroll → Auth (signup/login)").

**Carried follow-ups (from `docs/phase-4-followups.md` + earlier) that intersect P5 — fold in or keep tracked:**
- **Preview-deploy CI guards (`if: false`)** — carried from P0. The public site MUST deploy; P5's
  devops task turns on preview + production deploy for `apps/web` (Vercel/Cloudflare Pages — user
  decision) and is the natural home to resolve this guard.
- **JSON-LD `</script>` breakout escaping (P4 L-1)** — the P5 SEO/JSON-LD work touches many pages;
  fold the `replace(/<\/script>/gi, ...)` escaping into a shared JSON-LD helper so every page (incl.
  the existing verify page) is fixed once.
- **M-4 (P2): public `utm`/`name`/`source` stored unsanitized** — P5 massively widens public-input
  volume (lead forms, registration). Server-side input sanitization + no-raw-HTML-sink on the new
  public writes is in scope for the security wave; encode in any export path.
- **`auth.openapi.json` rename artifact / OpenAPI list-query-param gap** — cosmetic; do
  opportunistically in the W2 api-designer task if cheap, else leave tracked.
- **Playwright browser e2e still a no-op stub** — P5 introduces the site's headline conversion
  journey; this is the strongest candidate yet to stand up **real Playwright** (the funnel + a11y
  axe run). Flagged for the QA wave (see Risk).
- **Hardcoded `TENANT_SLUG` / cross-tenant harness (S1-3)** — single-tenant persists; every new
  public repo/read MUST tenant-scope (public reads resolve tenant server-side, never from client).

None of these block the P5 GO; they are folded into the relevant tasks below.

---

## 1. Scope statement + what is explicitly OUT of P5 (gate decisions — kept tight)

### In scope (the P5 headline)
1. **Global shell + IA** (`docs/01 §7.1/§10`): sticky header (logo, Programs mega-menu, For
   Colleges, About, Blog, Contact) with persistent **"Book Free Slot"** CTA + **WhatsApp
   click-to-chat** float; footer (program columns, company, legal, social, contact, cert-verify
   link, newsletter capture); breadcrumbs; DPDP consent/cookie banner; 404/500. Semantic
   landmarks, keyboard-operable menus, AA.
2. **Homepage** (`docs/01 §7.2`): hero + dual CTA + trust strip, stats band (count-up,
   reduced-motion aware), featured programs, why-us/outcomes, how-it-works, faculty, testimonials,
   partners/hiring logo wall, gallery (lazy), FAQ accordion, lead-form CTA band, blog teaser.
   Above-the-fold < 2s; SSG/ISR.
3. **Programs listing** (`docs/01 §7.3`): SSR/SSG filterable grid (domain, level, duration, mode,
   price band; sort popularity/price/newest), consuming the NEW public catalog read. SEO-indexable.
4. **Program (course) detail — the conversion workhorse** (`docs/01 §7.4`): hero (title, outcome,
   rating, duration/mode/level, price + EMI, dual CTA), sticky enroll/price card (desktop rail /
   mobile bottom bar), curriculum accordion, tools/skills, projects, mentors, certificate preview
   (+ verify note), outcomes, reviews, FAQ, related. **Schema.org `Course` + `Review` + `FAQ` +
   `Breadcrumb` JSON-LD.**
5. **Pricing** (`docs/01 §7.5`): per-program pricing, bundles/tracks (display), EMI explainer,
   refund-policy link, coupon field (validated against the public `coupons/validate`), comparison
   table.
6. **Trust & content pages** (`docs/01 §7.6`): About, Faculty index, Testimonials hub, Partners,
   Gallery, Career (roles + apply form → lead-capture), Contact/Support. Certificate **Verify** page
   already exists (P4) — folded into nav/footer.
7. **Book-Free-Slot funnel** (`docs/01 §7.7`): multi-step (program → date/time → details → confirm)
   → **reuses `POST /public/bookings`** (creates CRM lead-linked booking + UTM capture) +
   **enqueues** a confirmation event (the actual WhatsApp/email *send* is P6). Bot/spam protected.
8. **Lead-gen forms everywhere** (`docs/01 §7.7`): inline, sticky bar, exit-intent modal, footer
   newsletter, career-apply — all feed the NEW **public lead-capture** endpoint with UTM/source
   capture. Landing-page shell (minimal-nav, single-CTA, A/B-*ready* structure — the framework
   itself is P8).
9. **Payment + registration funnel** (`docs/01 §7.8`, `docs/06 §1/§2` — the phase's hardest edge):
   `Program → Enroll → Register/Login → Order (coupon + EMI) → Razorpay checkout → verify →
   enrollment created → welcome + LMS handoff`. **Reuses the P2 commerce engine** (idempotent order
   creation, `PaymentProvider`, signature verify, order→enrollment atomicity, ledger, webhook)
   behind a NEW **public/self-service funnel surface**; never a new direct Razorpay call.
10. **SEO system** (`docs/01 §7.9/§16`): SSR/SSG/ISR, per-page metadata + OG/Twitter cards,
    canonical, `sitemap.xml` (dynamic per program), `robots.txt`, structured data (Course, Review,
    FAQ, Breadcrumb, Organization), image optimization (AVIF/WebP), route-level code splitting,
    performance budgets (LCP<2s, initial JS<150KB). **This is the defining requirement.**

### Explicitly OUT of P5 (gate decisions — justified)
- **Full headless CMS.** `docs/01 §9` mentions "content managed from the CRM by marketing/content
  roles via a headless content API." **P5 does NOT build a CMS or CRM content-authoring UI.**
  Marketing copy, testimonials, partners, faculty bios, FAQ, gallery, career roles, and **blog
  articles** ship as **MDX / typed content modules co-located in `apps/web`** (Git-as-CMS,
  SEO-perfect, zero new infra, fully SSG-able). Programs/pricing/coupons are **live** from the
  existing DB (already CRM-managed). *Rationale:* a CMS is a large infra + auth surface that would
  blow the phase; MDX content is investor-grade for launch and the headless-content-API is a clean
  P6+/CMS-phase follow-up. **This is a decision requiring user sign-off (see §4).**
- **Blog *authoring* engine / editorial workflow.** Blog **articles render** (MDX, with author,
  categories, related posts, `Article`/`BlogPosting` JSON-LD) but there is **no admin authoring
  UI, comments, or CMS**. Article files live in the repo. *Default: MDX blog, no authoring UI.*
- **A/B testing framework, personalization-by-source, chatbot lead-qualifier** (`docs/01 §21`) —
  **P8**. P5 ships landing pages that are *A/B-ready in structure* (single CTA, isolated layout) but
  no experiment runtime.
- **Multi-language / i18n** (`docs/01 §21` Hindi + regional) — **P8**. Copy is English; the content
  layer is structured so i18n can be layered later, but no locale routing in P5.
- **Notification *sending*** — the book-slot/lead/registration confirmations **enqueue** the domain
  event/audit row; **email/WhatsApp/SMS fan-out is P6** (no MailProvider/WhatsAppProvider wired
  here — WhatsApp on the site is a **click-to-chat deep link**, not the Cloud API).
- **New commerce mechanics** — no new EMI/dunning, no new coupon types, no new payment provider.
  P5 **only exposes** the existing engine to the public funnel. Bundles/tracks **display** on
  pricing but resolve to existing per-program orders (a true bundle-order product is a later phase).
- **CRM content roles / marketing campaign tooling** — P6.
- **Real load test / perf-hardening depth** — P7 (P5 sets budgets + Lighthouse gates in CI; the
  full load test is P7).

---

## 2. New DB tables/columns + new public API endpoints (and what is reused)

### New DB tables/columns
**None strictly required for the core funnel** — the funnel reuses `orders`/`payments`/`invoices`/
`coupons`/`enrollments`/`leads`/`bookings` (P1/P2) and `programs`/`modules`/`lessons` (P1). The
db-architect's P5 work is therefore **small and additive**, only where the public read/funnel needs
data the schema doesn't yet carry:

| Change | Table | Why | Owner |
|--------|-------|-----|-------|
| **ADD (nullable, additive)** SEO/marketing columns | `programs` | Public program-detail + listing need SEO + marketing fields the CRM catalog didn't require: `slug` (uniq per tenant, for SEO URLs `/programs/:slug`), `seo_title`, `seo_description`, `og_image_key`, `card_summary`, `outcomes` Json?, `rating_avg` Int?/`rating_count` Int? (denormalized display), `is_public` Bool default false (a program must be *explicitly* public-listable — published ≠ marketable). Forward-only, nullable/defaulted so P1–P4 rows validate. | db-architect |
| **ADD (nullable)** UTM/source hardening | `leads` | Lead-capture from the site needs `landing_url`, `referrer`, `gclid`/`fbclid` (campaign attribution). `utm` Json already exists; extend capture, do not duplicate. Additive nullable. | db-architect |
| **CONFIRM / possibly ADD** consent record | `leads` (column) OR a tiny `consents` table | DPDP consent on public forms must be recorded (`docs/01 §8/§17`). *Default (kept tight):* a `consent` Json? column on `leads`/`bookings` capturing `{marketing_opt_in, tos_version, ts, ip_hash}` rather than a new table. Confirm with PM. | db-architect |
| **Reused as-is** | `orders`, `payments`, `invoices`, `coupons`, `enrollments`, `bookings`, `modules`, `lessons`, `certificates` | No change. Funnel + catalog read against existing rows. | — |

> Marketing *copy* (testimonials, partners, faculty, FAQ, gallery, blog) is **MDX content, not DB
> tables** (per the §1 CMS gate decision) — so **no `testimonials`/`partners`/`pages`/`posts` tables
> in P5.** If the user chooses a CMS/DB-content approach instead, those tables become a db-architect
> add — flagged as the pivotal §4 decision.

### New public API endpoints (all NEW, unauthenticated OR self-service-authenticated; each flagged with owner)
Every new public endpoint: **published/public-only projection (no drafts, no PII, no internal ids
beyond slugs/ids needed to transact)**, **rate-limited per IP (reuse the `PublicBookingRateLimiter`
Redis fixed-window pattern)**, **CSRF-excluded** (no session for anon reads/intake) via the
established separate-controller-no-guards pattern (ADR-0019), **tenant resolved server-side**,
**captcha-gated on writes** (see §4), **`.strict()` over-post stripping**, zod-validated.

| # | New endpoint | Auth model | Reuses | Owner |
|---|--------------|-----------|--------|-------|
| P-1 | `GET /public/programs` (SEO catalog list: filters domain/level/duration/mode/price, sort, pagination — **`is_public && published` only**, marketing projection with slug/price/rating/summary) | Anonymous | `CoursesService` read path (new public projection) | backend-builder |
| P-2 | `GET /public/programs/:slug` (program detail + curriculum outline + mentors + reviews summary — **public projection, no draft lessons/no internal keys**) | Anonymous | `CoursesService` + curriculum read | backend-builder |
| P-3 | `POST /public/leads` (lead-capture from site forms: name/phone/email/program-interest/UTM/source/consent → CRM `leads` pipeline) | Anonymous | `LeadsService` create path + `leads` pipeline | backend-builder |
| P-4 | `POST /public/bookings` | Anonymous | **REUSED AS-IS (P2)** — no new code | — |
| P-5 | `POST /public/coupons/validate` (public coupon check for the pricing/checkout coupon field — returns discounted paise, never leaks coupon internals) | Anonymous | `CommerceService.validateCoupon` (new public wrapper) | backend-builder |
| P-6 | `POST /public/register` (self-service account creation for the enroll flow: creates a `user` + `student_profile`, or links an existing account via login — argon2id, DPDP consent, verify-via-OTP reuse) | Anonymous → creates session | `AuthService` (new public-registration path; reuses OTP/`otp/verify`) | backend-builder + integrations |
| P-7 | `POST /public/enroll/orders` (self-service order create for the authed-just-now student: program + optional coupon + EMI choice → **idempotent** order) | Self (fresh student session) | **`CommerceService.createOrder`** engine — same idempotency/paise/coupon math | backend-builder |
| P-8 | `POST /public/enroll/checkout` (create Razorpay order for that order → returns Razorpay order id + public `keyId`) | Self | **`CommerceService.initiateRazorpayCheckout`** + `PaymentProvider` | backend-builder |
| P-9 | `POST /public/enroll/verify` (verify Razorpay signature → captured → order paid → **atomic enrollment** → LMS handoff) | Self | **`CommerceService.verifyPayment`** — same signature verify + order→enrollment atomicity (ADR-0014) | backend-builder |
| — | `POST /commerce/payments/webhook` | Razorpay HMAC | **REUSED AS-IS (P2)** — the async safety net for P-9 | — |

> **Design constraint (Risk #1):** P-6..P-9 must reuse the **exact CommerceService/PaymentProvider
> engine** — no duplicated money logic. They differ from the CRM endpoints ONLY in authz (a
> just-registered student acting on *their own* order, scoped to `own`) and in being funnel-shaped
> (register→order→checkout→verify as one guided flow). The self-service scope must be **fail-closed**:
> a student can only create/pay/verify an order **for themselves**, IDOR→404, never touch another's.
> This is the P5 security crux (see §5).

---

## 3. Task graph

| # | Task | Owner agent | Depends on | Wave | DoD (refs `CLAUDE.md §4` + docs) |
|---|------|-------------|------------|------|------|
| 0 | **PM gate — scope + funnel acceptance criteria.** Confirm the §1 OUT-of-scope gates against `docs/01 §22` acceptance criteria: **MDX-content vs CMS** (headline decision), MDX blog no-authoring-UI, no i18n/A-B/personalization (P8), confirmations *enqueue*-only (send=P6), WhatsApp=click-to-chat, bundles display-only. Produce the crisp **funnel acceptance checklist** the QA + security waves assert against: (a) any lead form → CRM lead with UTM+source in <2s + confirmation event enqueued; (b) a successful Razorpay payment → **exactly one** enrollment (idempotent) + receipt event; a failed/double-click never double-charges/double-enrolls; (c) program detail emits valid `Course`+`Review` structured data and targets Lighthouse SEO ≥95. Define the **public-projection contract** (what fields of a program are safe to expose anonymously) + the **consent/DPDP** capture requirement. | product-manager | — | **W1** (‖ #1) | §4: matches `docs/01 §22` acceptance criteria. Funnel checklist + public-projection allowlist + consent rule signed off; CMS gate decision recorded (pending user confirm §4). |
| 1 | **Schema + migration + seed.** Additive forward-only migration per §2: `programs` SEO/marketing columns (`slug` uniq-per-tenant, `seo_*`, `og_image_key`, `card_summary`, `outcomes`, `rating_avg/count`, `is_public`); `leads` attribution (`landing_url`, `referrer`, `gclid/fbclid`) + `consent` Json?; optional `bookings.consent` Json?. All nullable/defaulted (P1–P4 rows validate). Backfill `slug` for seeded programs; mark 1–2 sample programs `is_public=true`. Extend `seed.ts`: sample public programs + reviews-summary fixture + a public coupon so the site + funnel + tests render. Integration test: additive migration applies clean over existing DB; `programs.slug` uniq holds; **a public projection query does NOT select draft/internal columns**. | db-architect | 0 | **W1** | §4: additive forward-only migration; every touched table keeps tenant_id + soft-delete + audit; money stays paise. `docs/05 §3/§4/§10`. Migration + seed clean; slug uniq + public-projection column test green. |
| 2 | **Shared contracts + client.** In `@repo/types`: zod DTOs + types for the NEW public surface — `PublicProgramSummary` / `PublicProgramDetail` (marketing projection, **no draft/internal fields**), `ListPublicProgramsQuery` (filters/sort/paging), `PublicLeadCaptureDto` (name/phone/email/programInterest/utm/source/consent + **captcha token field**), `PublicValidateCouponDto`→discount, `PublicRegisterDto` (+ consent + captcha), `PublicCreateOrderDto` / `PublicCheckoutResponse` (Razorpay orderId + public keyId, **never the secret**) / `PublicVerifyPaymentDto`. **Reuse existing** booking + verify DTOs. Reuse `{data,meta,error}` envelope + `Paginated<T>` + RFC-7807. Register in OpenAPI; regenerate `@repo/api-client` (add a `public` API namespace). Opportunistically: `auth.openapi.json`→`api.openapi.json` rename + list-query-param gap if cheap. **Type-level assertion that `PublicProgramDetail` cannot carry `answerKey`-like/internal fields and that checkout DTOs never include a secret.** | api-designer | 1 | **W2** | §4: zod DTOs in `@repo/types` imported FE+BE; validation at every boundary; money paise; public DTOs are minimal. `docs/04 §2.5/§2.14`. Client compiles; `public` SDK methods exist; projection/secret type assertions pass. |
| 3 | **Public-funnel abuse-protection integrations (behind interfaces).** Two swappable provider seams following the established interface + DI-token + Noop + `useFactory` pattern (`CLAUDE.md §1 rule 7`, ADR-0006/0023/0027): **(a) `CaptchaProvider`** (`verify(token, ip)` → bool) with a **Noop (always-pass in dev/test)** + a real adapter for **hCaptcha OR Cloudflare Turnstile — user picks (see §4)**, env-validated, **fail-closed in prod** when unconfigured; used by the public write endpoints (#5). **(b) `AnalyticsProvider` / tag seam** — a thin, deferrable, consent-gated client-side analytics/pixel loader interface (GA4 / Meta pixel — user decision, §4), **loaded only after DPDP consent**, `defer`/post-hydration, behind a feature flag; Noop until keys. Both providers do NO business logic. Unit tests: captcha verify pass/fail + fail-closed-when-unconfigured; analytics loader is consent-gated + Noop-deterministic; **no secret in client bundle** (site key is public, secret key server-only). | integrations | 1, 2 | **W3** | §4 + rule 7: vendor SDK only behind interface; env-validated; secrets via env; **captcha secret server-only, analytics gated on consent**. Noop keeps P5 green; fail-closed when unconfigured; unit tests green. |
| 4 | **Marketing design-system primitives.** Add to `@repo/ui` ONLY what the marketing surface needs and P0–P4 lacks, per `docs/07 §5/§6/§12` (the `web` "warm, spacious" personality via the web Tailwind preset) + `docs/01 §19/§20`: **MarketingHeader/MegaMenu** (keyboard-operable, mobile→accordion, focus-trapped, AA), **Footer**, **HeroSplit** (60/40), **StatBand/CountUp** (reduced-motion aware), **ProgramCard** (icon/title/meta/price/rating/CTA per §20), **StickyBuyCard / MobileBuyBar**, **TestimonialCard**, **LogoWall**, **FaqAccordion** (reuses Accordion), **PricingTable**, **MultiStepForm** (book-slot + registration stepper — keyboard, progress, inline zod errors), **ConsentBanner**, **WhatsAppFab**, **LeadFormInline / ExitIntentModal / StickyLeadBar** (honeypot field + captcha slot), **Breadcrumbs**. All SSR-safe, keyboard-first, focus-managed, AA, reduced-motion, with loading/empty/error where async; unit + a11y test each. | design-system | — | **W2** (‖ #2) | §4: a11y pass (keyboard + SR labels); loading/empty/error; no color-only status; reduced-motion. `docs/07`, `docs/01 §14/§15/§19/§20`. Each primitive unit+a11y tested; SSR-render-safe (no client-only crash). |
| 5 | **Backend — public catalog + funnel endpoints.** NestJS `public` module (or public controllers alongside existing modules), controller→service, **reusing** `CoursesService`/`LeadsService`/`CommerceService`/`AuthService` engines — **no duplicated money/enrollment logic**. Ship P-1..P-3, P-5..P-9 per §2: public program list/detail (published+`is_public` projection, **draft/internal columns never selected**), public lead-capture (→ pipeline, UTM/consent, **enqueues** confirmation event — no send), public coupon-validate (paise, no internal leak), **public register** (argon2id, consent, OTP-verify reuse, creates `user`+`student_profile`, issues session), and the **self-service enroll trio** (`orders`→`checkout`→`verify`) that reuse `CommerceService` create/checkout/verify with **`own`-scoped fail-closed authz** (a fresh student acts only on their own order; IDOR→404) + **idempotency-key** + `PaymentProvider` + order→enrollment atomicity (ADR-0014). All public writes: **captcha-gated (#3), rate-limited per IP (reuse `PublicBookingRateLimiter`), CSRF-excluded, `.strict()` over-post, tenant server-resolved, honeypot honored, input sanitized** (resolves P2 M-4). Every mutation audited. | backend-builder | 1, 2, 3 | **W4** | §4: server-side validation + `own`-scope fail-closed on funnel writes; audit on mutation; **money mutations reuse P2 idempotent engine (no reinvent)**; money paise; IDOR→404. `docs/01 §7.3/§7.4/§7.7/§7.8/§17`, `docs/04 §2.6/§2.10`, `docs/06 §1/§2`. Anonymous can browse+lead+book+validate-coupon; a registered student can self-enroll+pay exactly once (idempotent); no draft/PII/secret leak; forged/replayed pay → no double-charge/enroll. |
| 6 | **`apps/web` — global shell, SEO system, content + trust pages.** Next.js 15 App Router (SSR/SSG/ISR): **root layout** with `MarketingHeader/MegaMenu` + `Footer` + `ConsentBanner` + `WhatsAppFab` + skip-link + semantic landmarks; **SEO system** — a shared metadata/OG helper (per-page title/description/canonical/OG/Twitter), dynamic **`app/sitemap.ts`** (static routes + per-program from public catalog) + **`app/robots.ts`**, a shared **JSON-LD helper** (`Organization` site-wide; **`</script>`-escaped** — resolves P4 L-1) with `Breadcrumb`/`FAQ`/`Article` builders; **404/500**; **MDX content layer** for About/Faculty/Testimonials/Partners/Gallery/Career/FAQ/**Blog** (typed frontmatter, `BlogPosting`/`Article` JSON-LD, categories/author/related). Image optimization (AVIF/WebP, responsive), route-level code splitting, defer third-party (analytics only post-consent), perf-budget-friendly. loading/empty/error; a11y AA. | frontend-builder | 4, 5, (3 for consent/analytics wiring) | **W5** | §4: loading/empty/error; a11y AA; **SSR/SSG SEO — sitemap/robots/JSON-LD/canonical/OG per page**; no business logic in components. `docs/01 §7.1/§7.6/§7.9/§9/§16`, `docs/07 §12`. sitemap.xml + robots.txt served; Organization + Breadcrumb JSON-LD valid + escaped; content pages SSG; consent-gated analytics. |
| 7 | **`apps/web` — homepage + programs + program detail + pricing (the SEO conversion pages).** Consuming P-1/P-2/P-5 via `@repo/api-client` public namespace: **Homepage** (all §7.2 sections, SSG/ISR, count-up, featured programs from live catalog); **Programs listing** (SSR/SSG filterable grid, `DataFilters`, sort/paging, indexable); **Program detail** (`/programs/[slug]`, hero + **StickyBuyCard/MobileBuyBar**, curriculum accordion, mentors, cert preview + verify link, reviews, FAQ, related, **`Course`+`Review`+`FAQ`+`Breadcrumb` JSON-LD** targeting SEO ≥95); **Pricing** (per-program + EMI explainer + **coupon field → P-5** + refund link + comparison). Sticky/mobile-bottom CTAs (≥44px), hover-lift, ISR revalidate. loading/empty/error on every async section; a11y AA; performance budget (LCP<2s, initial JS<150KB). | frontend-builder | 4, 5, 6 | **W5** (‖ #6, shares shell) | §4: loading/empty/error; a11y; SEO structured data on detail (`Course`+`Review`); performance budget; own-scope N/A (public). `docs/01 §7.2/§7.3/§7.4/§7.5/§16/§20/§22`. Program detail emits valid Course+Review JSON-LD; listing SSR-indexable; coupon field validates via public API. |
| 8 | **`apps/web` — Book-Slot funnel + lead forms + registration→payment funnel (the conversion funnel).** **Book-Free-Slot** multi-step (`MultiStepForm`: program→date/time→details→confirm → `POST /public/bookings`, UTM + consent + captcha + honeypot, success/confirmation state). **Lead forms** (inline/sticky/exit-intent/footer-newsletter/career-apply → `POST /public/leads`, UTM capture from URL, captcha, toast on submit). **Registration→payment funnel** (`docs/01 §7.8`, `docs/06 §2`): `Enroll` on a program → **register/login** step (`P-6`, consent) → **order** (`P-7`, coupon + EMI, idempotency-key generated client-side) → **Razorpay checkout** (`P-8`, load Razorpay checkout.js with the **public keyId only**) → **verify** (`P-9`) → success + **LMS handoff** (redirect/CTA). **Idempotent, double-click-safe UI** (disable + reuse idempotency key), full loading/empty/**error+retry** on every step, payment-failure retry path. a11y AA (keyboard stepper, focus mgmt, SR announcements). **No secret in the client; no money math in the client (server returns paise).** | frontend-builder | 4, 5, 6 | **W5** (‖ #6/#7) | §4: loading/empty/error+retry; a11y AA; **no secret/no money math client-side; idempotent double-click-safe**; validation at boundary. `docs/01 §7.7/§7.8/§17/§22`, `docs/06 §1/§2`. Lead form → CRM lead <2s + confirmation enqueued; successful pay → exactly one enrollment + LMS handoff; double-click/failed pay never double-charges/enrolls. |
| 9 | **Tests.** Unit (public-projection builders omit draft/internal/PII; lead-capture UTM/consent mapping; public coupon-validate paise; captcha fail-closed; register argon2id + consent; funnel own-scope guard; JSON-LD escaping; sitemap/robots generation). Integration (testcontainers PG/Redis + Noop captcha/analytics + **mocked PaymentProvider**): **the funnel headline** — anonymous browse (draft/unpublished/non-`is_public` **not** returned; no internal columns/PII in payload); public lead-capture → CRM lead with UTM+source (+ confirmation event enqueued); public book-slot → booking+lead; public coupon-validate; **register → order → checkout → verify → exactly-one enrollment (idempotent)**; **replayed verify / duplicate webhook / double-click order does NOT double-charge or double-enroll**; **funnel IDOR** (student A cannot create/pay/verify an order for student B → 404); **captcha-gated writes reject on fail**; rate-limit trips; **no secret leaked** (keyId public, secret never in any response/bundle). **e2e Playwright (the site's headline journey — strongest candidate to stand up real Playwright, resolving the carried no-op stub):** `land → browse programs → open detail → enroll → register → pay (mocked/test Razorpay) → success → LMS handoff`, plus a lead-form + book-slot happy path. **a11y (axe)** on homepage/detail/funnel/pricing + new primitives. **Lighthouse SEO/perf budget gate** on program detail (≥95 SEO target). Wire into CI. | qa-engineer | 5, 6, 7, 8 | **W6** | §4: unit + integration + e2e + a11y green; tests gate merge. `docs/01 §22`, `docs/06 §1/§2`. Funnel exactly-once + idempotency proven; projection/PII/secret leak-free; captcha/rate-limit enforced; SEO structured-data + budget asserted; e2e journey green. |
| 10 | **Security review.** **Public-surface abuse (crux):** spam/bot on lead/book/register/coupon forms — captcha **fail-closed**, rate-limit per IP (fail-closed on Redis error, `trust proxy` correct — carried P2 H-1), honeypots honored; **payment tampering reuse-check** — the public funnel cannot bypass the P2 signature-verify / idempotency / order→enrollment atomicity (no order marked paid without verified signature; replay/double-click/forged-`razorpay_order_id` → no double-charge/enroll; server-derived amounts, `.strict()` over-post); **funnel IDOR / self-service scope** — a registered student can transact ONLY on their own order (IDOR→404), cannot read/pay another's; **enumeration** — public program-detail + booking-availability + coupon-validate resist enumeration/scraping (no internal ids/PII/draft leak, rate-limited, generic errors); **PII in lead capture** — DPDP consent recorded, PII minimized, input sanitized (resolves P2 M-4), no PII in JSON-LD/OG/logs; **secret leakage** — Razorpay `keyId` public but `KEY_SECRET`/`WEBHOOK_SECRET`/captcha-secret NEVER in responses/logs/client bundle; **XSS** — MDX/content + any rendered lead/registration input sanitized, JSON-LD `</script>`-escaped (P4 L-1); **CSP/HSTS/headers** on the public site; **registration** — no account-enumeration on `/public/register`, argon2id, rate-limited. Report high/crit as fix tasks; re-verify. | security-reviewer | 9 | **W7** | §4 + `docs/04 §7` gate: server-side validation; no secret leakage; idempotent payments; audit. `docs/01 §17`, `docs/00 §7`. No high/crit open; bot/spam, payment-reuse, funnel-IDOR, enumeration, PII/consent, secret-leak, XSS/CSP verified. |
| 11 | **DevOps — public-site deploy + SEO/perf CI gates.** Stand up **`apps/web` preview + production deploy** (Vercel **or** Cloudflare Pages — user decision §4), resolving the carried **preview-deploy `if: false` guard** (P0 followup). Wire **ISR/edge cache** config, **CSP/HSTS/security headers** for the public site, **Lighthouse CI** (SEO ≥95 / perf budget) + **axe** as PR gates on `apps/web`, sitemap/robots reachable in the deployed preview, and the public-facing env wiring (public API base URL, Razorpay **public keyId**, captcha **site key**, analytics id — all *public* client vars; **no secrets to the frontend**). Confirm Razorpay TEST-vs-LIVE posture with the user before any live keys. | devops | 6, 7, 8 | **W7** (‖ #10) | §4: `turbo run build lint test` green; CI gates added. `docs/00 §7`, `docs/01 §16/§18`. `apps/web` deploys to preview; Lighthouse/axe PR gates active; headers/CSP set; no secret in client env. |
| 12 | **Docs sync.** Update `README.md` (the `web` app + how to run/build/deploy it; the public API surface + how the funnel reuses the P2 commerce engine; MDX-content approach + how to add a program/blog post; captcha/analytics env + Noop defaults; Razorpay public-keyId-only-on-client note). ADRs for P5 decisions (MDX-content-vs-CMS; public-catalog projection + `programs.is_public`/`slug`; public self-service funnel reusing CommerceService with `own`-scope fail-closed; CaptchaProvider interface + fail-closed; consent-gated AnalyticsProvider; sitemap/JSON-LD/SEO system; `web` deploy target). Update `docs/05 §10` (programs SEO columns + leads attribution/consent → Implemented P5). Create `docs/phase-5-followups.md` (headless CMS + CRM content roles → P6/CMS phase; A/B + i18n + personalization + chatbot → P8; bundle-order product; confirmation *sending* → P6; carried S1-x + P4 L-1/M-4 status). | docs-writer | 10, 11 | **W7** | §4: short summary of what changed + how to verify. P5 closeout; `docs/05 §10` + ADRs + `docs/phase-5-followups.md` synced. |

---

## 4. Execution order (waves)

- **Wave 1:** #0 (product-manager — scope/funnel-acceptance/CMS gate + public-projection allowlist)
  ‖ #1 (db-architect — additive `programs` SEO + `leads` attribution/consent migration + seed; #1
  consumes #0's projection allowlist but can start structural work immediately). Everything
  downstream depends on #1.
- **Wave 2 (parallel):** #2 (api-designer — public DTOs + SDK `public` namespace, needs #1) ‖ #4
  (design-system — marketing primitives, needs nothing).
- **Wave 3:** #3 (integrations — `CaptchaProvider` + consent-gated `AnalyticsProvider` seams; needs
  #1+#2). Hard dependency for the public write endpoints.
- **Wave 4:** #5 (backend-builder — public catalog + funnel endpoints reusing the P1/P2 engines;
  needs #1+#2+#3). This is the phase's narrow backend core.
- **Wave 5 (parallel — shared `apps/web`, separate route areas):** #6 (frontend — shell + SEO system
  + content/trust pages; needs #4+#5) ‖ #7 (frontend — homepage + programs + detail + pricing;
  needs #4+#5+#6's shell) ‖ #8 (frontend — book-slot + lead forms + registration→payment funnel;
  needs #4+#5+#6's shell). #7/#8 depend on #6's layout/SEO helpers — land #6's shell + SEO + client
  scaffolding first within the wave, then #7/#8 build pages on it (coordinate the shared layout).
- **Wave 6:** #9 (qa-engineer) — needs all backend + frontend landed.
- **Wave 7 (parallel then serial):** #10 (security-reviewer) ‖ #11 (devops — deploy + CI gates)
  → #12 (docs-writer).

---

## 5. SEO + funnel-abuse security surfaces (flagged for the security-review wave, #10)

- **Bot/spam on public forms** (lead-capture, book-slot, register, coupon-validate): captcha
  **fail-closed** when unconfigured in prod, rate-limit per IP **fail-closed on Redis error** +
  correct `trust proxy` (carried P2 H-1), honeypot fields honored, no unbounded resource creation.
- **Payment tampering / reuse-check** (the funnel must NOT weaken P2's guarantees): no order paid
  without a **verified Razorpay signature**; **idempotency** (idempotency-key + `provider_payment_id`
  uniq) makes replayed verify / duplicate webhook / double-click a no-op; server-derived amounts +
  `.strict()` over-post; forged/known `razorpay_order_id` cannot mint an enrollment.
- **Funnel IDOR / self-service scope**: a just-registered student can create/checkout/verify ONLY
  **their own** order — cross-student access → **404** (fail-closed, ADR-0018/0022 pattern); cannot
  read another's order/invoice.
- **Enumeration / scraping**: public program-detail, booking availability, and coupon-validate must
  not leak internal ids, draft/unpublished programs, other users' data, or coupon internals; generic
  errors; rate-limited to resist scraping/enumeration.
- **PII in lead capture** (DPDP): consent recorded + versioned, PII minimized, input **sanitized**
  (resolves P2 M-4), never rendered raw / never in JSON-LD/OG/logs.
- **Secret leakage**: Razorpay `keyId` and captcha **site key** are public; `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`, and the **captcha secret key** are server-only — never in any response,
  log, or client bundle.
- **XSS / content injection**: MDX content + any rendered lead/registration input sanitized;
  **JSON-LD `</script>`-escaped** across all pages (resolves P4 L-1); CSP/HSTS on the public site.
- **Registration abuse**: no account-enumeration on `/public/register`, argon2id, rate-limited,
  consent-gated.

---

## 6. Risks & open questions

1. **Reusing the P2 commerce engine for a PUBLIC self-service funnel (highest risk).** The CRM
   commerce endpoints are staff-permissioned (`orders.create` etc.). The funnel must NOT copy money
   logic. **Decision:** new **thin public/self-service controllers** call the **same
   `CommerceService`** methods (createOrder/initiateRazorpayCheckout/verifyPayment), differing only
   in an **`own`-scoped, fail-closed authz** (a fresh student session acting on its own order) and
   funnel shaping. Idempotency, signature-verify, order→enrollment atomicity, ledger, and the
   webhook are **inherited unchanged** (ADR-0013/0014/0017). QA (#9) + security (#10) explicitly
   prove no double-charge/enroll and no cross-student IDOR. Recorded as an ADR.
2. **MDX content vs headless CMS (the pivotal scope decision).** `docs/01 §9` implies a CRM-managed
   headless content API. Building that (schema + CRM authoring UI + auth) would blow the phase.
   **Decision (pending user confirm, §4 + task #0):** **MDX/typed-content in `apps/web`** for
   marketing/blog/trust copy; **live DB** for programs/pricing/coupons (already CRM-managed). The
   headless-content-API + CRM content roles are a clean **P6/CMS-phase** follow-up. If the user
   wants a CMS now, that becomes a db-architect + CRM-frontend expansion (re-plan).
3. **No public self-registration exists today.** Auth has login/OTP but no signup. **Decision:**
   add a **`POST /public/register`** path in `AuthService` (argon2id, consent, OTP-verify reuse)
   that creates `user`+`student_profile` and issues a session for the enroll flow — reusing the
   existing cookie/CSRF/refresh machinery (ADR-0002/0003). Enumeration-resistant. Recorded as an ADR.
4. **Captcha/analytics are new external surfaces.** Both go **behind provider interfaces** (rule 7)
   with Noop + fail-closed; **the vendor choice + keys are ASK-USER (§4)**. P5 is green on Noop.
   Analytics loads **only after DPDP consent**.
5. **SEO is the defining requirement and is testable.** Program detail must emit valid `Course`+
   `Review` JSON-LD and target Lighthouse SEO ≥95 (`docs/01 §22`). **Decision:** a shared
   metadata/JSON-LD helper (escaped, P4 L-1), dynamic sitemap/robots, SSG/ISR, and a **Lighthouse
   CI gate** in #11. Perf budget (LCP<2s, initial JS<150KB) enforced.
6. **`programs` needs marketing/SEO fields the CRM catalog lacks** (slug, seo_*, is_public, rating).
   **Decision:** additive nullable columns + `is_public` (published ≠ publicly listable, so a draft
   or internal program never leaks). Public projection **never selects** draft/internal columns
   (repo-level test).
7. **Playwright is still a no-op stub (carried P1–P4).** The funnel is the strongest case to stand
   up **real browser e2e**. **Decision:** #9 lands a real Playwright funnel journey (with a
   mocked/test Razorpay) + axe; if browser infra proves heavy in CI, the API-integration funnel test
   remains the authoritative gate and Playwright lands as a fast-follow (flag in followups).
8. **Web deploy target unresolved** (`CLAUDE.md §1` says Vercel/Cloudflare Pages). **Decision:** user
   picks in §4; #11 wires it and resolves the carried preview-deploy `if: false` guard.
9. **Consent modeling kept tight.** DPDP consent as a `consent` Json? column on `leads`/`bookings`
   (not a new table) unless the user/PM wants an auditable `consents` table. Default: column.

---

## 7. Secrets / dependencies the user must supply or approve

**Dependencies requiring explicit approval before install (standing rule — do NOT `pnpm add` without a yes):**
- **Captcha / bot-protection SDK — ASK USER, no default assumed.** Pick **hCaptcha** *or*
  **Cloudflare Turnstile** (Turnstile is free + privacy-friendly + pairs well if hosting on
  Cloudflare Pages; hCaptcha is a common alternative). The `CaptchaProvider` isolates the choice;
  **Noop keeps P5 green** until approved. Which + why is an ADR.
- **Analytics / marketing pixels — ASK USER.** GA4 / Google Tag Manager / Meta (Facebook) pixel /
  PostHog — user decides which (if any). Loaded **only after DPDP consent**, behind the
  `AnalyticsProvider` seam, Noop until keys.
- **MDX toolchain** (e.g. `@next/mdx` / `next-mdx-remote` / `contentlayer`) for the content+blog
  layer — **ASK USER before install** (needed only if the MDX-content gate decision is approved).
- **Playwright browser deps** — if standing up real e2e (Risk #7), confirm CI browser install is
  acceptable.

**Provider credentials — user-supplied (provider is Noop / fail-closed until set):**
- **Captcha:** `CAPTCHA_PROVIDER` (`hcaptcha`|`turnstile`|`noop`), `CAPTCHA_SITE_KEY` (**public**,
  client-safe), `CAPTCHA_SECRET_KEY` (**server-only**). Added to `.env.example` + zod env schema.
  **Fail-closed in prod when unconfigured.**
- **Analytics (optional):** `ANALYTICS_PROVIDER` + the relevant public measurement id (client-safe).
  Consent-gated; Noop until set.
- **Razorpay — CONFIRM TEST-vs-LIVE.** `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`
  already exist (TEST mode per P2). The public funnel exposes the **`keyId` (public) to the client
  ONLY** — the secret and webhook secret stay server-only. **Go-LIVE requires an explicit user
  decision after a full funnel validation** (do not flip to live keys unprompted).
- **Public site env (client-safe, NO secrets):** the public API base URL, Razorpay **public keyId**,
  captcha **site key**, analytics **measurement id** — all public client vars; the devops task
  (#11) wires them without leaking any secret to the frontend.

**Deploy/hosting decision (required for #11):** **Vercel** or **Cloudflare Pages** for `apps/web`
(and whether to co-locate captcha/analytics choice with the host). Resolves the carried
preview-deploy `if: false` guard.

**Product decisions (defaults chosen if no answer — confirmed in task #0):**
1. **Q1 (content approach — pivotal):** MDX/typed-content in `apps/web` for marketing/blog/trust;
   live DB for programs/pricing/coupons; headless CMS deferred to P6/CMS phase. *Default: MDX.*
2. **Q2 (blog):** MDX blog renders (author/categories/related/`Article` JSON-LD); no authoring UI.
   *Default: MDX blog, no CMS.*
3. **Q3 (i18n / A-B / personalization / chatbot):** OUT — P8. *Default: English, no experiment
   runtime (landing pages A/B-ready in structure only).*
4. **Q4 (confirmations):** book-slot/lead/registration confirmations **enqueue** the event; actual
   WhatsApp/email **send is P6**. Site WhatsApp = **click-to-chat deep link**. *Default: enqueue-only.*
5. **Q5 (registration):** self-service `POST /public/register` (argon2id + consent + OTP reuse) for
   the enroll flow. *Default: build it.*
6. **Q6 (consent modeling):** `consent` Json? column on `leads`/`bookings`. *Default: column, not a
   new table.*
7. **Q7 (bundles/tracks):** display-only on pricing; resolve to existing per-program orders; a true
   bundle-order product is a later phase. *Default: display-only.*

---

## 8. Definition of Done for the whole phase (gate to P6)

- [ ] Additive forward-only migration adds `programs` SEO/marketing columns (`slug` uniq-per-tenant,
      `seo_*`, `og_image_key`, `card_summary`, `outcomes`, `rating_avg/count`, `is_public`) +
      `leads` attribution (`landing_url`/`referrer`/`gclid`/`fbclid`) + consent capture; nullable/
      defaulted so P1–P4 rows validate; seed marks sample public programs + a public coupon; the
      public projection **never selects draft/internal columns** (repo test).
- [ ] zod DTOs for the public catalog + funnel in `@repo/types`, imported FE+BE; `@repo/api-client`
      gains a `public` namespace; public DTOs are **minimal** (no draft/internal/PII/secret; checkout
      DTO carries the public keyId only, never a secret).
- [ ] `CaptchaProvider` + consent-gated `AnalyticsProvider` behind interfaces + DI tokens + Noop
      (`useFactory`), env zod-validated, **fail-closed in prod when unconfigured**; captcha secret +
      Razorpay secrets never in the client bundle.
- [ ] Backend public surface: `GET /public/programs`(+`/:slug`) (published+`is_public` projection),
      `POST /public/leads` (→ pipeline, UTM/consent, confirmation **enqueued** not sent),
      `POST /public/coupons/validate`, `POST /public/register`, and the self-service enroll trio
      (`orders`→`checkout`→`verify`) **reusing the P2 `CommerceService`/`PaymentProvider` engine**
      with **`own`-scoped fail-closed authz + idempotency + order→enrollment atomicity**; all writes
      captcha-gated + rate-limited + CSRF-excluded + `.strict()` + sanitized + audited; the existing
      `POST /public/bookings` + `POST /commerce/payments/webhook` reused unchanged.
- [ ] `apps/web`: global shell (header/mega-menu/footer/consent/WhatsApp-fab/breadcrumbs), full SEO
      system (per-page metadata/OG/canonical, dynamic `sitemap.ts` + `robots.ts`, escaped JSON-LD
      helper with Organization/Breadcrumb/FAQ/Course/Review/Article), 404/500, MDX content + blog,
      homepage, programs listing, program detail (with `Course`+`Review`+`FAQ`+`Breadcrumb` JSON-LD),
      pricing (+ coupon field), trust/content pages — SSR/SSG/ISR, loading/empty/error, a11y AA,
      performance budget.
- [ ] `apps/web` funnels: **Book-Free-Slot** multi-step (→ `public/bookings`), **lead forms**
      (inline/sticky/exit-intent/newsletter/career → `public/leads`, UTM capture), and the
      **registration→payment funnel** (`Enroll → register/login → order → Razorpay checkout →
      verify → enrollment → LMS handoff`) — **idempotent, double-click-safe, no secret/no money math
      client-side**, full error+retry, captcha + honeypot, a11y AA.
- [ ] **`docs/01 §22` acceptance proven:** (a) any lead form → CRM lead with UTM+source in <2s +
      confirmation event enqueued; (b) a successful Razorpay payment → **exactly one** enrollment
      (idempotent) + receipt event, and a failed/double-clicked payment never double-charges or
      double-enrolls (integration + e2e); (c) program detail emits valid `Course`+`Review` structured
      data and hits the Lighthouse SEO ≥95 gate.
- [ ] **Funnel security proven:** captcha + rate-limit fail-closed; **funnel IDOR→404** (student
      cannot transact on another's order); no draft/PII/internal/secret leak on public reads;
      enumeration-resistant; DPDP consent recorded; JSON-LD escaped (P4 L-1); CSP/HSTS set;
      registration enumeration-resistant.
- [ ] Unit + integration + **real Playwright funnel e2e** + a11y (axe) + Lighthouse SEO/perf gate
      green; `turbo run build lint test` + `test:integration` green.
- [ ] a11y AA pass on new `@repo/ui` marketing primitives (header/mega-menu/hero/cards/multi-step/
      consent/etc.) and the new `web` pages (keyboard menus + stepper, focus mgmt, SR labels,
      reduced-motion, no color-only status).
- [ ] `apps/web` **deploys to preview + production** (Vercel/Cloudflare — chosen), preview-deploy
      `if: false` guard resolved; Lighthouse + axe PR gates active; headers/CSP set; **no secret in
      the client env**.
- [ ] security-reviewer sign-off: no high/critical open on bot/spam, payment-reuse, funnel-IDOR,
      enumeration, PII/consent, secret-leakage, XSS/CSP, registration abuse.
- [ ] README + ADRs + `docs/phase-5-followups.md` synced; `docs/05 §10` reflects the P5 `programs`/
      `leads` additive columns as Implemented (P5); headless CMS / CRM content roles / A-B / i18n /
      personalization / bundle-order product / confirmation-sending tracked as follow-ups.
