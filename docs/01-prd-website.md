# 01 — PRD: Marketing Website (`web`)

*Public, SEO-first conversion engine. Turns strangers into paid, registered students.*

---

## 1. Purpose
Generate qualified leads and enrollments by communicating program value, building trust,
and removing every friction between "curious" and "paid + registered."

## 2. Business goals
- Maximize **lead → enrollment** conversion at the lowest CAC.
- Rank organically for high-intent queries (`python internship for students`, etc.).
- Power paid-campaign landing pages with fast, measurable funnels.
- Build brand trust (faculty, outcomes, partners, certificates).

## 3. User goals
- Quickly understand "what program, for whom, what outcome, what cost."
- Trust the company (proof, reviews, partners, verifiable certs).
- Book a slot / talk to a counsellor / pay — with minimal effort, on mobile.

## 4. Personas (see `00`): **Aarav** (prospect), **Priya** (mobile-first), parents (payers).

## 5. Pain points addressed
Uncertainty about legitimacy, unclear pricing/outcomes, heavy slow pages on mobile,
no easy way to talk to a human, fear of scams. Responses: proof-dense pages, transparent
pricing, sub-2s loads, WhatsApp/book-slot CTAs, certificate verification.

## 6. Success metrics
| Metric | Target |
|--------|--------|
| Lead conversion (visit→lead) | ≥ 6% |
| Lead→paid | ≥ 15% |
| LCP / INP / CLS | <2.0s / <200ms / <0.1 |
| Lighthouse SEO / Perf | ≥95 / ≥90 |
| Organic traffic growth | +20% QoQ |

---

## 7. Functional requirements (page by page)

### 7.1 Global
- Sticky **header**: logo, Programs (mega-menu), For Colleges, About, Blog, Contact,
  persistent **"Book Free Slot"** CTA + **WhatsApp** float button.
- **Footer**: program columns, company, legal (privacy/terms/refund), social, contact,
  certificate-verification link, newsletter capture.
- **Global search** (programs + blog) with filters (domain, duration, level, mode).
- Cookie/consent banner (DPDP-aligned), 404/500, breadcrumb on deep pages.

### 7.2 Homepage
1. **Hero** — one-line value prop, sub-line, dual CTA ("Explore Programs" + "Book Free
   Slot"), trust strip (students trained, ratings, partner logos). Above-the-fold, < 2s.
2. **Stats band** — animated counters (students, programs, placement %, cities).
3. **Featured programs** — cards (icon, title, duration, level, "from ₹X", rating, CTA).
4. **Why us / outcomes** — project-based, mentor-led, verifiable certificate, placement.
5. **How it works** — 4-step visual (Enroll → Learn live + recorded → Build projects →
   Get certified/placed).
6. **Faculty** — mentor cards (photo, role, company/experience).
7. **Testimonials** — student stories (video + quote), college names.
8. **College partners / hiring partners** — logo wall.
9. **Gallery** — sessions, certificates, events (lazy-loaded).
10. **FAQ** — accordion.
11. **Lead form / CTA band** — "Talk to a counsellor."
12. **Blog teaser** + **footer**.

### 7.3 Programs listing
Filterable grid: domain (Python, Java, Full Stack, React, Node, Data Science, AI, ML,
UI/UX, Cloud, DevOps, Cyber Security, Digital Marketing, Embedded, IoT…), level, duration,
mode (live/recorded/hybrid), price band. Sort by popularity/price/newest. SSR for SEO.

### 7.4 Program (course) detail page — the conversion workhorse
- Hero: title, outcome promise, rating, duration, mode, level, **price + EMI**, CTAs
  ("Book Free Slot", "Enroll Now").
- Sticky **enroll/price card** (desktop right rail, mobile bottom bar).
- Curriculum (modules, accordion), tools/skills covered, projects you'll build.
- Mentors, certificate preview (with verification note), outcomes/placement.
- Reviews, FAQ, related programs. **Schema.org Course + Review markup** for SEO.

### 7.5 Pricing
Per-program pricing, bundles/tracks, EMI explainer, refund policy link, coupon field,
comparison table. Transparent, no dark patterns.

### 7.6 Trust & content
About Us (story, mission, team), Faculty index, Testimonials hub, Partners,
Gallery, **Blog** (SEO articles, categories, author, related posts, schema), Career page
(open roles + apply form), Certificate **Verification** page (enter ID → validity).

### 7.7 Lead generation & funnels
- **Book Free Slot**: multi-step (program → date/time → details → confirm) → creates CRM
  lead + calendar event + WhatsApp/email confirmation.
- **Lead forms** everywhere (exit-intent modal, sticky bar, inline) → CRM lead with UTM
  capture.
- **Landing pages** (campaign-specific, minimal nav, single CTA, A/B-ready).
- **WhatsApp integration**: click-to-chat with prefilled message + program context.

### 7.8 Payment & registration flow
`Program → Enroll → Auth (signup/login) → Order (Razorpay, apply coupon, choose EMI) →
Payment → Webhook verify → Enrollment created → Welcome + LMS credentials → redirect to LMS`.
Idempotent order creation; server verifies payment signature; receipt emailed.

### 7.9 SEO system
SSR/SSG, per-page meta + OG, canonical, sitemap.xml, robots.txt, structured data
(Course, Review, FAQ, Breadcrumb, Organization), fast Core Web Vitals, programmatic SEO
pages per program × city, blog content engine.

---

## 8. Non-functional requirements
Performance budget (LCP<2s, JS<150KB initial), image optimization (AVIF/WebP, responsive),
edge caching/CDN, 99.9% uptime, GDPR/DPDP consent, bot/spam protection on forms
(rate-limit + captcha), graceful degradation without JS for core content.

## 9. Roles & permissions
Public site = mostly anonymous. Content (blog, programs, testimonials, partners, pages,
landing pages, coupons) is **managed from the CRM** by `marketing`/`content` roles via a
headless content API. No login on the website except the enroll/registration step.
**Exception (P10):** the 6 structural marketing pages composed via the CRM page builder
(see §23) and sitewide nav/footer/SEO/contact/stat settings are **super_admin-only** —
narrower than the `marketing`/`content_editor` grant used for blog/testimonials/partners/
faculty-bio/generic-page content (ADR-0062).

| Action | Anonymous | Lead (form submitted) | Marketing (CRM) |
|--------|-----------|----------------------|-----------------|
| Browse, search | ✅ | ✅ | ✅ |
| Submit lead / book slot | ✅ | ✅ | — |
| Enroll + pay | ✅ (creates account) | ✅ | — |
| Edit pages/blog/coupons | — | — | ✅ |

## 10. Navigation & information architecture
```
Home
├─ Programs ▸ (mega-menu by domain) ▸ Program detail ▸ Enroll
├─ For Colleges (B2B)
├─ About ▸ Faculty ▸ Gallery
├─ Outcomes ▸ Testimonials ▸ Partners ▸ Verify Certificate
├─ Blog ▸ Article
├─ Pricing
├─ Career ▸ Job
└─ Contact / Support  (+ persistent Book Slot & WhatsApp)
```

## 11. UX strategy
Clarity-first, proof-dense, one primary CTA per view, progressive disclosure (accordions),
mobile-thumb-reachable CTAs, social proof near every decision point, friction-free forms
(minimal fields, smart defaults, inline validation), trust signals above the fold.

## 12. UI strategy
Confident, modern, trustworthy. Strong type scale, generous whitespace, brand color for
CTAs only (high contrast), consistent card system, subtle motion. Hero imagery real
(students/sessions), not generic stock. Dark mode optional for blog.

## 13. Dashboard/layout note
No user dashboard on `web`; the "layout" is the page system above. Post-enroll users go to
the **LMS**.

## 14. Mobile responsiveness
Mobile-first; sticky bottom CTA bar on program pages; mega-menu collapses to accordion;
images responsive; tap targets ≥44px; test on low-end Android + slow 4G.

## 15. Accessibility
WCAG 2.2 AA: semantic landmarks, alt text, focus order, labelled forms, contrast ≥4.5:1,
reduced-motion support, keyboard-operable menus and modals.

## 16. Performance strategy
SSG for static pages, ISR for programs/blog, CDN + edge cache, image CDN, route-level code
splitting, prefetch on hover, defer third-party scripts, skeleton loaders.

## 17. Security
Form rate-limiting + captcha, server-side validation, payment signature verification,
HTTPS/HSTS, CSP, no secrets in client, honeypots, audit of coupon usage.

## 18. Scalability
Stateless frontends on CDN/edge; content via cached headless API; spike-tolerant (campaign
traffic); decoupled from LMS/CRM load.

## 19. Animations & micro-interactions
Count-up stats, hover lift on cards, smooth accordion, sticky CTA reveal on scroll, button
press feedback, toast on form submit, lazy fade-in sections (respect reduced-motion).

## 20. Wireframe cues (for design-system agent)
Hero = 60/40 split (copy/visual) desktop, stacked mobile. Program card = icon top-left,
title, meta row, price + rating, CTA bottom. Detail page = 2-col (content + sticky buy
card) desktop, single col + bottom bar mobile.

## 21. Future expansion
College B2B portal entry, multi-language (Hindi + regional), A/B testing framework,
personalization by source, chatbot lead-qualifier, scholarship/coupon campaigns.

## 22. Acceptance criteria (samples)
- Submitting any lead form creates a CRM lead with UTM + source within 2s and triggers a
  WhatsApp/email confirmation.
- A successful Razorpay payment creates exactly one enrollment (idempotent) and emails a
  receipt; a failed/again-clicked payment never double-charges or double-enrolls.
- Program detail pages emit valid Course + Review structured data and score ≥95 SEO.

## 23. Implementation status (as of Phase 9 — `docs/plans/phase-9-completion.md`)

Full functional-requirement coverage was reached this phase. Notable closures:

- **§7.6 Trust & content** — blog/testimonials/partners/faculty-bio content is now
  served from a CRM-managed headless content API (draft/publish workflow) rather than
  hardcoded/MDX, superseding the P5 MDX/Git-as-CMS decision for these content types
  (ADR-0059, supersedes ADR-0035).
- **§7.7 Lead generation & funnels** — the three previously-dead lead-capture
  components (exit-intent, sticky bar, lead form) are now mounted on real pages; footer
  newsletter, career-apply, and contact forms added; CRM-authored landing pages with
  A/B variant rendering and a configurable lead-form builder are live.
- **§7.9 SEO system** — per-city SEO pages, bundle/track pricing pages, and the public
  `/verify` certificate-lookup page (previously a 404) are live; site-wide search over
  programs + blog is client-composed from existing public read endpoints (server-side
  ranked search was out of scope this phase — see `docs/phase-9-followups.md` P9-4).
- Payments remain on Razorpay **TEST** mode (see `docs/go-live-checklist.md` B7) — the
  registration/payment funnel is functionally complete but not yet verified against live
  Razorpay keys.
- WhatsApp per-program context and bundle/track pricing surfaces are live.

Remaining gaps are tracked in `docs/go-live-checklist.md` (credential provisioning:
Cloudflare token rotation, Razorpay live keys) and `docs/phase-9-followups.md`
(client-composed search). Multi-tenancy (`TENANT_SLUG` hardcoded) remains out of scope
until a second tenant is imminent.

## 24. Implementation status (Phase 10 — Page Builder, `docs/specs/phase-10-page-builder.md`)

`/`, `/about`, `/scholarship`, `/for-colleges`, `/gallery`, and `/careers` are now
`ContentPage`-driven (composed from the 11-block page-builder registry, editable
super_admin-only from the CRM) — each keeps its dedicated Next.js route file as a thin
server-component wrapper that fetches its `ContentPage` by a fixed slug and falls back to
the exact pre-migration hardcoded page (`*Fallback` components) on any API failure,
unpublished row, or non-builder-managed row, so the marketing site can never white-screen
because the CMS is down. A new catch-all route (`/pages/[...slug]`) serves any
**additional** page a super_admin creates in the builder beyond those 6 (ISR
`revalidate = 3600`, same as the 6 migrated pages). `/faq` (still MDX, ADR-0035) was
**deliberately not migrated** this phase — see `docs/phase-10-followups.md`. Sitewide
nav/footer/SEO-default/contact/WhatsApp/homepage-stat primitives are now editable via the
new `SiteSetting` model (`GET /public/site-settings`, anonymous/cacheable). See
ADR-0062 for the save-is-live / version-history / dedicated-settings-model rationale and
`docs/05-database-design.md` for the schema.
